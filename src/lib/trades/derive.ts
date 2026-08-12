import type { Transaction } from "@/lib/oanda/types";
import {
  DEFAULT_HORIZON_THRESHOLDS,
  inferHorizon,
  type HorizonId,
  type HorizonThresholds,
} from "@/lib/books";

/**
 * Trade derivation.
 *
 * Trades are DERIVED from the raw ledger and never hand-edited. That means a
 * bug here is fixed by correcting this function and replaying, not by patching
 * rows — and re-deriving must always produce identical output.
 *
 * The core is a pure function over transactions so it can be tested without a
 * database, and so the same logic serves backfill and incremental sync.
 *
 * ── Why R-multiples come out automatically ──────────────────────────────────
 * Peter always attaches hard stops, so OANDA emits a STOP_LOSS_ORDER carrying
 * the trade id right after the fill. That gives planned risk directly from
 * broker data, with no manual entry — which is what makes R the app's primary
 * unit rather than an optional extra.
 */

export type TradeClose = {
  time: string;
  price: number;
  units: number;
  realizedPL: number;
  financing: number;
  halfSpreadCost: number;
};

export type DerivedTrade = {
  oandaTradeId: string;
  instrument: string;
  direction: "long" | "short";
  state: "open" | "closed";

  units: number;
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;

  plannedStop: number | null;
  plannedTarget: number | null;
  /** Planned risk in ACCOUNT currency — the denominator of every R figure. */
  initialRisk: number | null;

  realizedPl: number;
  financing: number;
  commission: number;
  spreadCost: number;
  rMultiple: number | null;

  /** True when the stop came from a trailing order's distance rather than a
   *  fixed price — planned risk is then an approximation, not a certainty. */
  stopFromTrailing: boolean;

  /**
   * Hold time in ms, and the horizon inferred from it.
   *
   * Horizon is a per-trade TAG, not an account: Peter's books are instrument
   * classes and he trades all four horizons within each. Null while the trade
   * is open, since the hold time isn't final. An explicit override lives in
   * trade_annotations so a re-derive cannot discard it.
   */
  holdMs: number | null;
  horizon: HorizonId | null;
};

type Builder = {
  t: DerivedTrade;
  closedUnits: number;
  /** OANDA's own conversion of a quote-currency loss into account currency. */
  lossConversion: number;
  closes: TradeClose[];
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function deriveTrades(
  transactions: Transaction[],
  thresholds: HorizonThresholds = DEFAULT_HORIZON_THRESHOLDS,
): DerivedTrade[] {
  // Ledger order is authoritative; ids are numeric strings.
  const ordered = [...transactions].sort((a, b) => Number(a.id) - Number(b.id));
  const builders = new Map<string, Builder>();

  for (const tx of ordered) {
    switch (tx.type) {
      case "ORDER_FILL":
        handleFill(tx, builders);
        break;

      case "STOP_LOSS_ORDER": {
        const b = builders.get(String(tx.tradeID ?? ""));
        // FIRST stop only. Later ones are modifications — using them would
        // silently redefine the risk a trade was actually taken with.
        if (b && b.t.plannedStop === null && tx.price !== undefined) {
          b.t.plannedStop = num(tx.price);
        }
        break;
      }

      case "TRAILING_STOP_LOSS_ORDER": {
        const b = builders.get(String(tx.tradeID ?? ""));
        if (b && b.t.plannedStop === null && tx.distance !== undefined) {
          const d = num(tx.distance);
          b.t.plannedStop =
            b.t.direction === "long" ? b.t.entryPrice - d : b.t.entryPrice + d;
          b.t.stopFromTrailing = true;
        }
        break;
      }

      case "TAKE_PROFIT_ORDER": {
        const b = builders.get(String(tx.tradeID ?? ""));
        if (b && b.t.plannedTarget === null && tx.price !== undefined) {
          b.t.plannedTarget = num(tx.price);
        }
        break;
      }

      case "DAILY_FINANCING": {
        // Attribute overnight financing to the trades it was charged against.
        const perTrade = (tx.positionFinancings ?? []) as Array<{
          instrument?: string;
          openTradeFinancings?: Array<{ tradeID: string; financing: string }>;
        }>;
        for (const pos of perTrade) {
          for (const f of pos.openTradeFinancings ?? []) {
            const b = builders.get(String(f.tradeID));
            if (b) b.t.financing += num(f.financing);
          }
        }
        break;
      }
    }
  }

  return [...builders.values()].map((b) => finalise(b, thresholds));
}

function handleFill(tx: Transaction, builders: Map<string, Builder>) {
  const lossConversion = num(tx.lossQuoteHomeConversionFactor) || 1;

  // --- Opening ---
  const opened = tx.tradeOpened as
    | { tradeID: string; units: string; price: string; halfSpreadCost?: string }
    | undefined;

  if (opened) {
    const units = num(opened.units);
    builders.set(String(opened.tradeID), {
      lossConversion,
      closedUnits: 0,
      closes: [],
      t: {
        oandaTradeId: String(opened.tradeID),
        instrument: String(tx.instrument),
        direction: units >= 0 ? "long" : "short",
        state: "open",
        units,
        entryTime: String(tx.time),
        entryPrice: num(opened.price ?? tx.price),
        exitTime: null,
        exitPrice: null,
        plannedStop: null,
        plannedTarget: null,
        initialRisk: null,
        realizedPl: 0,
        financing: num(tx.financing),
        commission: num(tx.commission),
        spreadCost: num(opened.halfSpreadCost ?? tx.halfSpreadCost),
        rMultiple: null,
        stopFromTrailing: false,
        holdMs: null,
        horizon: null,
      },
    });
  }

  // --- Closing (full or partial) ---
  const closed = (tx.tradesClosed ?? []) as Array<{
    tradeID: string;
    units: string;
    price: string;
    realizedPL: string;
    financing?: string;
    halfSpreadCost?: string;
  }>;

  const reduced = tx.tradeReduced as
    | {
        tradeID: string;
        units: string;
        price: string;
        realizedPL: string;
        financing?: string;
        halfSpreadCost?: string;
      }
    | undefined;

  for (const c of [...closed, ...(reduced ? [reduced] : [])]) {
    const b = builders.get(String(c.tradeID));
    if (!b) continue; // opened before our sync window — skip rather than invent
    const close: TradeClose = {
      time: String(tx.time),
      price: num(c.price ?? tx.price),
      units: num(c.units),
      realizedPL: num(c.realizedPL),
      financing: num(c.financing),
      halfSpreadCost: num(c.halfSpreadCost),
    };
    b.closes.push(close);
    b.closedUnits += Math.abs(close.units);
    b.t.realizedPl += close.realizedPL;
    b.t.financing += close.financing;
    b.t.spreadCost += close.halfSpreadCost;
    b.t.commission += num(tx.commission);
  }
}

function finalise(b: Builder, thresholds: HorizonThresholds): DerivedTrade {
  const t = b.t;

  if (b.closes.length > 0) {
    // Volume-weighted exit, so partial closes at different prices are honest.
    const totalUnits = b.closes.reduce((s, c) => s + Math.abs(c.units), 0);
    t.exitPrice =
      totalUnits > 0
        ? b.closes.reduce((s, c) => s + c.price * Math.abs(c.units), 0) / totalUnits
        : null;
    t.exitTime = b.closes[b.closes.length - 1].time;
  }

  // Fully closed only when the whole position is out; a partial close leaves
  // the trade open, which matters for the swing and position books.
  const openUnits = Math.abs(t.units) - b.closedUnits;
  t.state = openUnits <= 1e-9 ? "closed" : "open";

  // Horizon only once the trade is finished — an open trade's hold time is
  // still growing, so classifying it now would be guessing.
  if (t.state === "closed" && t.exitTime !== null) {
    t.holdMs = Date.parse(t.exitTime) - Date.parse(t.entryTime);
    t.horizon = inferHorizon(t.holdMs, thresholds);
  }

  if (t.plannedStop !== null) {
    // Risk in quote currency, converted to account currency using OANDA's own
    // loss factor — the same number the broker would use.
    const riskQuote = Math.abs(t.entryPrice - t.plannedStop) * Math.abs(t.units);
    const risk = riskQuote * b.lossConversion;
    t.initialRisk = risk > 0 ? risk : null;

    if (t.initialRisk && t.state === "closed") {
      // Financing and spread are already inside realizedPl as OANDA reports it.
      t.rMultiple = t.realizedPl / t.initialRisk;
    }
  }

  return t;
}

/* -------------------------------------------------------------------------- */
/* Summary helpers                                                            */
/* -------------------------------------------------------------------------- */

export type DerivationStats = {
  total: number;
  closed: number;
  open: number;
  withPlannedStop: number;
  withRMultiple: number;
  trailingStops: number;
  instruments: number;
};

export function summarise(trades: DerivedTrade[]): DerivationStats {
  return {
    total: trades.length,
    closed: trades.filter((t) => t.state === "closed").length,
    open: trades.filter((t) => t.state === "open").length,
    withPlannedStop: trades.filter((t) => t.plannedStop !== null).length,
    withRMultiple: trades.filter((t) => t.rMultiple !== null).length,
    trailingStops: trades.filter((t) => t.stopFromTrailing).length,
    instruments: new Set(trades.map((t) => t.instrument)).size,
  };
}
