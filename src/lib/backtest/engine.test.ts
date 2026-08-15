import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bar } from "@/lib/indicators";
import { C, S, type PatternDef } from "@/lib/patterns/dsl";
import { backtest, computeStats, type BacktestTrade } from "./engine";

const START = Date.UTC(2024, 0, 8, 0, 0, 0); // a Monday, London = UTC in January

function bars(rows: Array<[number, number, number, number]>): Bar[] {
  return rows.map(([o, h, l, c], i) => ({
    time: START + i * 3_600_000,
    o, h, l, c,
    v: 100,
  }));
}

/** Fires whenever close > 100. Stop 10 below entry, target +2R. */
function pattern(over: Partial<PatternDef> = {}): PatternDef {
  return {
    slug: "test",
    name: "Test",
    summary: "",
    family: "price-action",
    horizon: "intraday",
    direction: "long",
    timeframe: "H1",
    instrumentClasses: ["fx"],
    trigger: C.gt(S.close, S.n(100)),
    invalidation: "",
    stop: { kind: "series", at: S.n(90) },
    targets: [{ kind: "rMultiple", r: 2 }],
    contextNotes: [],
    ...over,
  };
}

const NO_COSTS = { spread: 0, slippage: 0 };

describe("entry timing — the classic lookahead bug", () => {
  it("enters on the NEXT bar's open, never the signal bar's close", () => {
    const b = bars([
      [100, 100, 100, 101], // signal fires here (close 101 > 100)
      [105, 106, 104, 105], // entry must be at this bar's OPEN, 105
      [105, 130, 104, 129],
      [129, 130, 128, 129],
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades.length, 1);
    assert.equal(r.trades[0].entryIndex, 1);
    assert.equal(r.trades[0].entryPrice, 105, "must be bar 1's open, not bar 0's close");
  });

  it("does not open a trade when the signal is on the final bar", () => {
    const b = bars([
      [100, 100, 100, 99],
      [100, 100, 100, 101], // fires, but there is no next bar to fill on
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades.length, 0);
  });
});

describe("stop-versus-target ambiguity", () => {
  it("takes the STOP when a single bar touches both", () => {
    // Entry 100, stop 90, target 120. Bar 2 spans 85–125: both are touched.
    // Bar data cannot say which came first, so the pessimistic read wins.
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 125, 85, 100],
      [100, 100, 100, 100],
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades[0].reason, "stop");
    assert.equal(r.trades[0].r, -1);
  });

  it("takes the target when only the target is touched", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 125, 99, 120],
      [100, 100, 100, 100],
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades[0].reason, "target");
    assert.ok(Math.abs(r.trades[0].r - 2) < 1e-9);
  });
});

describe("signal exit", () => {
  // Exits when close drops below 95. Target is far away so it never interferes.
  const withExit = () =>
    pattern({
      targets: [{ kind: "rMultiple", r: 50 }],
      exitRule: C.lt(S.close, S.n(95)),
    });

  it("closes at the bar's CLOSE when the exit condition fires", () => {
    const b = bars([
      [100, 100, 100, 101], // signal
      [100, 101, 99, 100], // entry at 100
      [100, 101, 94, 94], // closes below 95 → exit here, at 94
      [94, 95, 93, 94],
    ]);
    const r = backtest(withExit(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades.length, 1);
    assert.equal(r.trades[0].reason, "signal");
    assert.equal(r.trades[0].exitPrice, 94, "fills at the close, not the low");
    assert.equal(r.trades[0].exitIndex, 2);
  });

  it("does not fire while the condition is false", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 96, 99], // dips to 96 but closes 99 — no exit
      [99, 100, 98, 99],
    ]);
    const r = backtest(withExit(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades[0].reason, "end-of-data");
  });

  it("lets the STOP win when both would trigger on the same bar", () => {
    // Stop is 90. A bar that trades to 85 and closes at 88 satisfies the exit
    // rule too, but the stop was hit intrabar and must take precedence.
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 100, 85, 88],
      [88, 89, 87, 88],
    ]);
    const r = backtest(withExit(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades[0].reason, "stop");
    assert.equal(r.trades[0].r, -1);
  });

  it("charges the spread on a signal exit", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 94, 94],
      [94, 95, 93, 94],
    ]);
    const r = backtest(withExit(), b, "EUR_USD", {
      costs: { spread: 2, slippage: 0 },
    });
    // Entry 100 + 1 (half spread), exit 94 − 1.
    assert.equal(r.trades[0].entryPrice, 101);
    assert.equal(r.trades[0].exitPrice, 93);
  });

  it("is inert for patterns that declare no exitRule", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 94, 94],
      [94, 95, 93, 94],
    ]);
    const r = backtest(pattern({ targets: [{ kind: "rMultiple", r: 50 }] }), b, "EUR_USD", {
      costs: NO_COSTS,
    });
    assert.notEqual(r.trades[0].reason, "signal");
  });
});

describe("costs", () => {
  it("charges half the spread on entry and worsens the fill", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 125, 99, 120],
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: { spread: 2, slippage: 0 } });
    assert.equal(r.trades[0].entryPrice, 101, "long pays the ask: open 100 + half of 2");
  });

  it("applies slippage to stop exits but not to target exits", () => {
    const stopped = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 85, 90],
    ]);
    const withSlip = backtest(pattern(), stopped, "EUR_USD", {
      costs: { spread: 0, slippage: 1 },
    });
    assert.equal(withSlip.trades[0].exitPrice, 89, "stop 90 filled 1 worse");

    const hitTarget = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 125, 99, 120],
    ]);
    const t = backtest(pattern(), hitTarget, "EUR_USD", {
      costs: { spread: 0, slippage: 1 },
    });
    assert.equal(t.trades[0].exitPrice, 120, "limit orders fill at their price or not at all");
  });

  it("costs make an otherwise breakeven trade a loser", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 85, 90],
    ]);
    const free = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    const paid = backtest(pattern(), b, "EUR_USD", { costs: { spread: 2, slippage: 1 } });
    assert.ok(paid.trades[0].r < free.trades[0].r, "costs must reduce R");
  });
});

describe("position handling", () => {
  it("never holds overlapping positions from repeated signals", () => {
    // Fires on every bar, but only one trade may be open at a time.
    const b = bars(
      Array.from({ length: 20 }, () => [101, 102, 100.5, 101] as [number, number, number, number]),
    );
    const r = backtest(pattern({ targets: [{ kind: "timeStop", bars: 5 }] }), b, "EUR_USD", {
      costs: NO_COSTS,
    });
    for (let i = 1; i < r.trades.length; i++) {
      assert.ok(
        r.trades[i].entryIndex >= r.trades[i - 1].exitIndex,
        "a trade opened before the previous one closed",
      );
    }
    assert.ok(r.signals > r.trades.length, "signals should exceed taken trades");
  });

  it("rejects a stop on the wrong side of entry", () => {
    const b = bars([
      [100, 100, 100, 101],
      [50, 51, 49, 50], // entry 50, but the rule puts the stop at 90 — above it
      [50, 51, 49, 50],
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    assert.equal(r.trades.length, 0, "an upside 'stop' on a long is not a stop");
  });
});

describe("management", () => {
  it("moves the stop to breakeven once far enough in profit", () => {
    // Entry 100, risk 10. Bar 2 reaches +1R (110), arming breakeven.
    // Bar 3 then trades back to 95 — with breakeven armed that is a scratch,
    // not a full stop-out.
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 112, 99, 111],
      [111, 111, 95, 96],
      [96, 96, 96, 96],
    ]);
    const r = backtest(
      pattern({ management: { breakevenAtR: 1 }, targets: [{ kind: "rMultiple", r: 5 }] }),
      b, "EUR_USD", { costs: NO_COSTS },
    );
    assert.equal(r.trades[0].reason, "stop");
    assert.equal(r.trades[0].r, 0, "stopped at entry, not at −1R");
  });

  it("never trails the stop onto the winning side of the market", () => {
    /**
     * Regression test for a bug that inflated every trailing pattern.
     *
     * A trailing series can sit ABOVE price for a long. Adopting it blindly put
     * the stop above the market, so the next bar "stopped out" at a price
     * better than the market ever traded — turning losers into large winners.
     * Real results went from +151R to negative once this was fixed.
     *
     * Here the trail series is a constant 200, far above a market at ~100.
     */
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 85, 86], // genuine stop-out at 90
      [86, 86, 86, 86],
    ]);
    const r = backtest(
      pattern({
        management: { trailOn: S.n(200) },
        targets: [{ kind: "rMultiple", r: 5 }],
      }),
      b, "EUR_USD", { costs: NO_COSTS },
    );
    assert.equal(r.trades.length, 1);
    assert.ok(
      r.trades[0].exitPrice <= 100,
      `exit ${r.trades[0].exitPrice} is above entry — the stop was trailed above the market`,
    );
    assert.ok(r.trades[0].r < 0, "this trade lost; it must not be recorded as a winner");
  });

  it("does trail a stop upward when the series sits below price", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 120, 99, 119], // runs up; trail at 110 is valid, being below close
      [119, 119, 105, 106],
      [106, 106, 106, 106],
    ]);
    const r = backtest(
      pattern({ management: { trailOn: S.n(110) }, targets: [{ kind: "rMultiple", r: 9 }] }),
      b, "EUR_USD", { costs: NO_COSTS },
    );
    assert.equal(r.trades[0].reason, "stop");
    assert.equal(r.trades[0].exitPrice, 110, "should exit at the trailed stop");
    assert.ok(r.trades[0].r > 0, "trailing locked in a profit");
  });

  it("exits on a time stop at the bar's close", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 104],
      [104, 105, 103, 104],
    ]);
    const r = backtest(pattern({ targets: [{ kind: "timeStop", bars: 2 }] }), b, "EUR_USD", {
      costs: NO_COSTS,
    });
    assert.equal(r.trades[0].reason, "time");
    assert.equal(r.trades[0].exitPrice, 104);
  });
});

describe("excursions", () => {
  it("records MAE and MFE in R", () => {
    const b = bars([
      [100, 100, 100, 101],
      [100, 105, 95, 100], // +0.5R favourable, −0.5R adverse against a risk of 10
      [100, 101, 99, 100],
      [100, 125, 99, 120],
    ]);
    const r = backtest(pattern(), b, "EUR_USD", { costs: NO_COSTS });
    assert.ok(r.trades[0].maeR >= 0.5 - 1e-9);
    assert.ok(r.trades[0].mfeR >= 2 - 1e-9, "should capture the run to target");
  });
});

describe("statistics", () => {
  const mk = (r: number): BacktestTrade => ({
    entryIndex: 0, exitIndex: 1, entryTime: 0, exitTime: 1,
    direction: "long", entryPrice: 1, exitPrice: 1, stop: 0, target: null,
    r, reason: "target", barsHeld: 1, maeR: 0, mfeR: 0,
  });

  it("computes win rate, expectancy and profit factor", () => {
    const s = computeStats([mk(2), mk(-1), mk(2), mk(-1)]);
    assert.equal(s.trades, 4);
    assert.equal(s.wins, 2);
    assert.equal(s.winRate, 0.5);
    assert.equal(s.totalR, 2);
    assert.equal(s.profitFactor, 2);
    assert.equal(s.expectancy, 0.5);
  });

  it("measures max drawdown on the R equity curve", () => {
    // +3 then −1, −1, −1 → peak 3, trough 0, drawdown 3.
    const s = computeStats([mk(3), mk(-1), mk(-1), mk(-1)]);
    assert.equal(s.maxDrawdownR, 3);
    assert.equal(s.longestLosingStreak, 3);
  });

  it("returns zeroed stats rather than NaN for no trades", () => {
    const s = computeStats([]);
    assert.equal(s.trades, 0);
    assert.equal(s.avgR, 0);
    assert.ok(!Number.isNaN(s.winRate));
  });
});

describe("out-of-sample split", () => {
  it("splits trades by entry position and never overlaps", () => {
    const b = bars(
      Array.from({ length: 100 }, () => [101, 102, 100.5, 101] as [number, number, number, number]),
    );
    const r = backtest(pattern({ targets: [{ kind: "timeStop", bars: 3 }] }), b, "EUR_USD", {
      costs: NO_COSTS,
      outOfSampleFraction: 0.3,
    });
    assert.equal(r.inSample.trades + r.outOfSample.trades, r.stats.trades);
    assert.ok(r.outOfSample.trades > 0, "expected some out-of-sample trades");
  });
});
