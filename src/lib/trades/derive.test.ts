import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transaction } from "@/lib/oanda/types";
import { deriveTrades } from "./derive";

/**
 * Fixtures mirror the real shapes observed in Peter's OANDA ledger, including
 * `lossQuoteHomeConversionFactor`, which is how quote-currency risk becomes
 * account-currency risk.
 */

const CONV = 0.75; // GBP account, USD-quoted instrument

function fill(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    accountID: "test",
    time: "2026-08-03T10:00:00.000000000Z",
    type: "ORDER_FILL",
    instrument: "XAU_USD",
    lossQuoteHomeConversionFactor: String(CONV),
    gainQuoteHomeConversionFactor: String(CONV),
    financing: "0",
    commission: "0",
    ...over,
  } as Transaction;
}

function openFill(id: string, tradeId: string, units: number, price: number) {
  return fill({
    id,
    units: String(units),
    price: String(price),
    tradeOpened: {
      tradeID: tradeId,
      units: String(units),
      price: String(price),
      halfSpreadCost: "0.25",
    },
  } as never);
}

function closeFill(
  id: string,
  tradeId: string,
  units: number,
  price: number,
  pl: number,
  time = "2026-08-03T11:00:00.000000000Z",
) {
  return fill({
    id,
    time,
    price: String(price),
    pl: String(pl),
    tradesClosed: [
      {
        tradeID: tradeId,
        units: String(units),
        price: String(price),
        realizedPL: String(pl),
        financing: "0",
        halfSpreadCost: "0.25",
      },
    ],
  } as never);
}

function stopOrder(id: string, tradeId: string, price: number): Transaction {
  return {
    id,
    accountID: "test",
    time: "2026-08-03T10:00:01.000000000Z",
    type: "STOP_LOSS_ORDER",
    tradeID: tradeId,
    price: String(price),
    reason: "ON_FILL",
  } as Transaction;
}

describe("trade derivation", () => {
  it("builds a closed long with planned risk and R", () => {
    const txs = [
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30),
    ];
    const [t] = deriveTrades(txs);

    assert.equal(t.oandaTradeId, "1");
    assert.equal(t.direction, "long");
    assert.equal(t.state, "closed");
    assert.equal(t.entryPrice, 4000);
    assert.equal(t.exitPrice, 4020);
    assert.equal(t.plannedStop, 3990);

    // |4000 − 3990| × 2 units × 0.75 = 15
    assert.equal(t.initialRisk, 15);
    assert.equal(t.rMultiple, 30 / 15);
  });

  it("handles shorts, where the stop sits above entry", () => {
    const txs = [
      openFill("1", "1", -2, 4000),
      stopOrder("2", "1", 4010),
      closeFill("3", "1", 2, 3980, 30),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.direction, "short");
    assert.equal(t.initialRisk, 15);
    assert.equal(t.rMultiple, 2);
  });

  it("keeps the FIRST stop as planned risk, ignoring later modifications", () => {
    // Moving a stop to breakeven must not retroactively claim the trade was
    // taken with zero risk — that would make R meaningless.
    const txs = [
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      stopOrder("3", "1", 4000), // moved to breakeven later
      closeFill("4", "1", -2, 4020, 30),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.plannedStop, 3990, "planned risk must come from the initial stop");
    assert.equal(t.initialRisk, 15);
  });

  it("treats a partial close as still open", () => {
    const txs = [
      openFill("1", "1", 4, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.state, "open", "half the position is still on");
    assert.equal(t.rMultiple, null, "R is only meaningful once fully closed");
  });

  it("volume-weights the exit across partial closes", () => {
    const txs = [
      openFill("1", "1", 4, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4010, 15),
      closeFill("4", "1", -2, 4030, 45, "2026-08-03T12:00:00.000000000Z"),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.state, "closed");
    assert.equal(t.exitPrice, 4020, "equal-size closes at 4010 and 4030 average to 4020");
    assert.equal(t.realizedPl, 60);
    assert.equal(t.exitTime, "2026-08-03T12:00:00.000000000Z", "last close wins");
  });

  it("derives a stop from a trailing order and flags it as approximate", () => {
    const txs = [
      openFill("1", "1", 2, 4000),
      {
        id: "2",
        accountID: "test",
        time: "2026-08-03T10:00:01.000000000Z",
        type: "TRAILING_STOP_LOSS_ORDER",
        tradeID: "1",
        distance: "8",
      } as Transaction,
      closeFill("3", "1", -2, 4020, 30),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.plannedStop, 3992, "entry 4000 less an 8-point trail");
    assert.equal(t.stopFromTrailing, true, "must be flagged as derived, not certain");
  });

  it("accumulates spread cost across entry and exit", () => {
    const txs = [
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.spreadCost, 0.5, "0.25 in and 0.25 out");
  });

  it("leaves R null when no stop was ever attached", () => {
    const txs = [openFill("1", "1", 2, 4000), closeFill("2", "1", -2, 4020, 30)];
    const [t] = deriveTrades(txs);
    assert.equal(t.plannedStop, null);
    assert.equal(t.initialRisk, null);
    assert.equal(t.rMultiple, null, "R without known risk would be invented");
    assert.equal(t.realizedPl, 30, "but P&L is still real and must be kept");
  });

  it("ignores closes for trades opened before the sync window", () => {
    // Deriving a trade from a close alone would invent an entry price.
    const txs = [closeFill("1", "999", -2, 4020, 30)];
    assert.deepEqual(deriveTrades(txs), []);
  });

  it("is order-independent — ledger order comes from ids", () => {
    const txs = [
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30),
    ];
    const forward = deriveTrades(txs);
    const reversed = deriveTrades([...txs].reverse());
    assert.deepEqual(reversed, forward);
  });

  it("classifies horizon from the actual hold time", () => {
    // Entry 10:00. Close at 10:05 → 5 minutes → scalp.
    const scalp = deriveTrades([
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30, "2026-08-03T10:05:00.000000000Z"),
    ]);
    assert.equal(scalp[0].horizon, "scalp");
    assert.equal(scalp[0].holdMs, 5 * 60_000);

    // 4 hours → intraday.
    const intraday = deriveTrades([
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30, "2026-08-03T14:00:00.000000000Z"),
    ]);
    assert.equal(intraday[0].horizon, "intraday");

    // 3 days → swing.
    const swing = deriveTrades([
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30, "2026-08-06T10:00:00.000000000Z"),
    ]);
    assert.equal(swing[0].horizon, "swing");

    // 60 days → position.
    const position = deriveTrades([
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 30, "2026-10-02T10:00:00.000000000Z"),
    ]);
    assert.equal(position[0].horizon, "position");
  });

  it("respects custom horizon boundaries", () => {
    // With a 1-minute scalp bound, a 5-minute hold is intraday, not a scalp.
    const [t] = deriveTrades(
      [
        openFill("1", "1", 2, 4000),
        stopOrder("2", "1", 3990),
        closeFill("3", "1", -2, 4020, 30, "2026-08-03T10:05:00.000000000Z"),
      ],
      { scalpMaxMinutes: 1, intradayMaxMinutes: 480, swingMaxMinutes: 30240 },
    );
    assert.equal(t.horizon, "intraday");
  });

  it("leaves horizon null while a trade is still open", () => {
    // An open trade's hold time is still growing, so classifying it would be
    // guessing — and it would flip category as the trade ran.
    const [t] = deriveTrades([
      openFill("1", "1", 4, 4000),
      stopOrder("2", "1", 3990),
      closeFill("3", "1", -2, 4020, 15), // half closed only
    ]);
    assert.equal(t.state, "open");
    assert.equal(t.horizon, null);
    assert.equal(t.holdMs, null);
  });

  it("attributes daily financing to the trade it was charged against", () => {
    const txs = [
      openFill("1", "1", 2, 4000),
      stopOrder("2", "1", 3990),
      {
        id: "3",
        accountID: "test",
        time: "2026-08-03T21:00:00.000000000Z",
        type: "DAILY_FINANCING",
        positionFinancings: [
          {
            instrument: "XAU_USD",
            openTradeFinancings: [{ tradeID: "1", financing: "-1.25" }],
          },
        ],
      } as Transaction,
      closeFill("4", "1", -2, 4020, 30, "2026-08-04T11:00:00.000000000Z"),
    ];
    const [t] = deriveTrades(txs);
    assert.equal(t.financing, -1.25);
  });
});
