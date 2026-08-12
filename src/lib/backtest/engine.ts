import type { Bar } from "@/lib/indicators";
import { BarContext } from "@/lib/patterns/evaluate";
import type { ManagementRule, PatternDef, SeriesRef, StopRule, TargetRule } from "@/lib/patterns/dsl";

/**
 * Backtest engine.
 *
 * Runs a PatternDef over historical bars using the SAME evaluator the live
 * scanner uses, so a pattern cannot behave differently in testing than in
 * production.
 *
 * ── The assumptions that decide whether results mean anything ──────────────
 *
 * 1. ENTRY IS THE NEXT BAR'S OPEN. A trigger is evaluated on bar close, so you
 *    cannot have been filled on that bar. Entering at the signal bar's close is
 *    the single most common way a backtest quietly reads the future.
 *
 * 2. WHEN STOP AND TARGET ARE BOTH TOUCHED IN ONE BAR, THE STOP WINS. Bar data
 *    cannot tell us which came first. Assuming the target inflates every
 *    result; assuming the stop is pessimistic but never flattering.
 *
 * 3. COSTS ARE CHARGED BOTH WAYS. Peter's own ledger shows spread was ~76% of
 *    his net loss, so a backtest that ignores it is worse than useless.
 *
 * 4. STOPS SLIP, TARGETS DO NOT. Limit exits fill at their price or not at all;
 *    stop exits are market orders and fill worse.
 *
 * ── Not modelled ───────────────────────────────────────────────────────────
 * `ManagementRule.scaleOutFraction` is currently IGNORED: every trade is
 * all-or-nothing. Partial exits would change results in both directions —
 * lower average R, higher win rate — so patterns declaring a scale-out are
 * being tested on a simplification, not on their stated rules.
 */

export type Costs = {
  /** Full spread in PRICE terms (not pips). Half is charged on each side. */
  spread: number;
  /** Extra adverse price paid on stop exits only, in price terms. */
  slippage: number;
};

/**
 * Per-instrument costs, MEASURED from the live OANDA feed rather than guessed.
 *
 * Recorded during the London session on 12 Aug 2026, top of book:
 *   EUR_USD 0.00008 · GBP_USD 0.00013 · USD_JPY 0.016
 *   XAU_USD 0.74 · SPX500 0.50 · NAS100 3.0 · WTICO 0.040
 *
 * ⚠️ These were guesses first, and two were badly wrong — XAU was assumed at
 * 0.35 against an actual 0.74, and NAS100 at 1.2 against an actual 3.0. Both
 * understatements flattered patterns on exactly the instruments that looked
 * most promising. Spreads also widen outside the London/NY overlap and around
 * releases, so these remain optimistic for anything traded at the edges of the
 * session.
 *
 * Slippage is assumed at roughly half the spread on stop exits, since a stop is
 * a market order and fills into whatever is there.
 */
export function defaultCosts(instrument: string): Costs {
  if (/^XAU/.test(instrument)) return { spread: 0.74, slippage: 0.35 };
  if (/^XAG/.test(instrument)) return { spread: 0.025, slippage: 0.012 };
  if (/NAS100/.test(instrument)) return { spread: 3.0, slippage: 1.5 };
  if (/SPX500/.test(instrument)) return { spread: 0.5, slippage: 0.25 };
  if (/US30|DE30|DE40|UK100|JP225/.test(instrument))
    return { spread: 2.4, slippage: 1.2 };
  if (/WTICO|BCO/.test(instrument)) return { spread: 0.04, slippage: 0.02 };
  if (/NATGAS/.test(instrument)) return { spread: 0.006, slippage: 0.003 };
  if (/_JPY$/.test(instrument)) return { spread: 0.016, slippage: 0.008 };
  return { spread: 0.0001, slippage: 0.00005 }; // FX majors, ~1 pip
}

export type BacktestTrade = {
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  stop: number;
  target: number | null;
  /** Result in R, net of costs. */
  r: number;
  reason: "stop" | "target" | "time" | "flatten" | "end-of-data";
  barsHeld: number;
  maeR: number;
  mfeR: number;
};

export type BacktestResult = {
  slug: string;
  instrument: string;
  timeframe: string;
  bars: number;
  signals: number;
  trades: BacktestTrade[];
  stats: Stats;
  /** Held-out tail of the data, never used to choose anything. */
  outOfSample: Stats;
  inSample: Stats;
};

export type Stats = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  medianR: number;
  expectancy: number;
  profitFactor: number;
  totalR: number;
  maxDrawdownR: number;
  longestLosingStreak: number;
  avgBarsHeld: number;
  exits: Record<string, number>;
};

const EMPTY_STATS: Stats = {
  trades: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, medianR: 0,
  expectancy: 0, profitFactor: 0, totalR: 0, maxDrawdownR: 0,
  longestLosingStreak: 0, avgBarsHeld: 0, exits: {},
};

export function backtest(
  pattern: PatternDef,
  bars: Bar[],
  instrument: string,
  opts: { costs?: Costs; outOfSampleFraction?: number } = {},
): BacktestResult {
  const costs = opts.costs ?? defaultCosts(instrument);
  const oosFraction = opts.outOfSampleFraction ?? 0.3;

  const ctx = new BarContext(bars);
  const fired = ctx.evaluate(pattern.trigger);
  const long = pattern.direction === "long";

  const trades: BacktestTrade[] = [];
  let signals = 0;
  let blockedUntil = -1;

  for (let i = 0; i < bars.length - 1; i++) {
    if (!fired[i]) continue;
    signals++;
    // One position at a time — overlapping entries would compound the same
    // signal and flatter the results.
    if (i < blockedUntil) continue;

    const t = simulate(pattern, ctx, bars, i, long, costs);
    if (t) {
      trades.push(t);
      blockedUntil = t.exitIndex;
    }
  }

  const splitIndex = Math.floor(bars.length * (1 - oosFraction));
  const inS = trades.filter((t) => t.entryIndex < splitIndex);
  const outS = trades.filter((t) => t.entryIndex >= splitIndex);

  return {
    slug: pattern.slug,
    instrument,
    timeframe: pattern.timeframe,
    bars: bars.length,
    signals,
    trades,
    stats: computeStats(trades),
    inSample: computeStats(inS),
    outOfSample: computeStats(outS),
  };
}

function seriesValueAt(ctx: BarContext, ref: SeriesRef, i: number): number {
  return ctx.series(ref)[i];
}

function resolveStop(
  rule: StopRule,
  ctx: BarContext,
  entryIndex: number,
  entryPrice: number,
  long: boolean,
): number | null {
  const atrRef: SeriesRef = { s: "atr", period: 14 };
  const atrHere = ctx.series(atrRef)[entryIndex];

  if (rule.kind === "atr") {
    if (!Number.isFinite(atrHere)) return null;
    return long ? entryPrice - rule.multiple * atrHere : entryPrice + rule.multiple * atrHere;
  }

  const base = seriesValueAt(ctx, rule.at, entryIndex);
  if (!Number.isFinite(base)) return null;
  const buffer = (rule.bufferAtr ?? 0) * (Number.isFinite(atrHere) ? atrHere : 0);
  const stop = long ? base - buffer : base + buffer;

  // A stop on the wrong side of entry is not a stop.
  if (long && stop >= entryPrice) return null;
  if (!long && stop <= entryPrice) return null;
  return stop;
}

function resolveTarget(
  targets: TargetRule[],
  ctx: BarContext,
  entryIndex: number,
  entryPrice: number,
  risk: number,
  long: boolean,
): { price: number | null; timeStopBars: number | null } {
  let price: number | null = null;
  let timeStopBars: number | null = null;

  for (const t of targets) {
    if (t.kind === "rMultiple" && price === null) {
      price = long ? entryPrice + t.r * risk : entryPrice - t.r * risk;
    } else if (t.kind === "series" && price === null) {
      const v = seriesValueAt(ctx, t.at, entryIndex);
      if (Number.isFinite(v)) {
        // Ignore a target that is already behind us.
        if ((long && v > entryPrice) || (!long && v < entryPrice)) price = v;
      }
    } else if (t.kind === "timeStop") {
      timeStopBars = t.bars;
    }
  }
  return { price, timeStopBars };
}

function simulate(
  pattern: PatternDef,
  ctx: BarContext,
  bars: Bar[],
  signalIndex: number,
  long: boolean,
  costs: Costs,
): BacktestTrade | null {
  const entryIndex = signalIndex + 1; // next bar's open — never the signal bar
  if (entryIndex >= bars.length) return null;

  const half = costs.spread / 2;
  const rawEntry = bars[entryIndex].o;
  const entryPrice = long ? rawEntry + half : rawEntry - half;

  // Stop is derived from the SIGNAL bar's state, which is what was knowable.
  const resolved = resolveStop(pattern.stop, ctx, signalIndex, entryPrice, long);
  if (resolved === null) return null;
  // Re-bound after the null check: narrowing does not carry into the hoisted
  // close() below, and the initial stop is what defines R for this trade.
  const stop: number = resolved;

  const risk = Math.abs(entryPrice - stop);
  if (risk <= 0) return null;

  const { price: target, timeStopBars } = resolveTarget(
    pattern.targets, ctx, signalIndex, entryPrice, risk, long,
  );

  const mgmt: ManagementRule = pattern.management ?? {};
  let workingStop = stop;
  let mae = 0;
  let mfe = 0;

  for (let i = entryIndex; i < bars.length; i++) {
    const bar = bars[i];

    const favourable = long ? bar.h - entryPrice : entryPrice - bar.l;
    const adverse = long ? entryPrice - bar.l : bar.h - entryPrice;
    mfe = Math.max(mfe, favourable / risk);
    mae = Math.max(mae, adverse / risk);

    const stopHit = long ? bar.l <= workingStop : bar.h >= workingStop;
    const targetHit =
      target !== null && (long ? bar.h >= target : bar.l <= target);

    // Assumption 2: when both are touched in one bar, the stop wins.
    if (stopHit) {
      const fill = long ? workingStop - costs.slippage : workingStop + costs.slippage;
      return close(i, fill, "stop");
    }
    if (targetHit) {
      return close(i, target!, "target");
    }

    // Move to breakeven once far enough in profit.
    if (mgmt.breakevenAtR && favourable / risk >= mgmt.breakevenAtR) {
      workingStop = long
        ? Math.max(workingStop, entryPrice)
        : Math.min(workingStop, entryPrice);
    }

    // Trail, never loosening — and never onto the winning side of the market.
    //
    // A trailing series (an EMA, a prior low) can sit ABOVE price for a long.
    // Adopting it blindly would place the stop above the market, so the next
    // bar "stops out" at a better price than the market ever traded — a pure
    // fabrication that turns losers into winners. The clamp below is what
    // keeps a trailing stop an actual stop.
    if (mgmt.trailOn) {
      const v = ctx.series(mgmt.trailOn)[i];
      if (Number.isFinite(v)) {
        if (long && v < bar.c) workingStop = Math.max(workingStop, v);
        if (!long && v > bar.c) workingStop = Math.min(workingStop, v);
      }
    }

    if (mgmt.flattenAtHour !== undefined && ctx.hour[i] >= mgmt.flattenAtHour) {
      return close(i, long ? bar.c - half : bar.c + half, "flatten");
    }

    if (timeStopBars !== null && i - entryIndex >= timeStopBars) {
      return close(i, long ? bar.c - half : bar.c + half, "time");
    }
  }

  const lastIndex = bars.length - 1;
  const lastBar = bars[lastIndex];
  return close(lastIndex, long ? lastBar.c - half : lastBar.c + half, "end-of-data");

  function close(i: number, exitPrice: number, reason: BacktestTrade["reason"]): BacktestTrade {
    const gross = long ? exitPrice - entryPrice : entryPrice - exitPrice;
    return {
      entryIndex,
      exitIndex: i,
      entryTime: bars[entryIndex].time,
      exitTime: bars[i].time,
      direction: long ? "long" : "short",
      entryPrice,
      exitPrice,
      stop,
      target,
      r: gross / risk,
      reason,
      barsHeld: i - entryIndex,
      maeR: mae,
      mfeR: mfe,
    };
  }
}

export function computeStats(trades: BacktestTrade[]): Stats {
  if (trades.length === 0) return { ...EMPTY_STATS, exits: {} };

  const rs = trades.map((t) => t.r);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const sorted = [...rs].sort((a, b) => a - b);

  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));

  // Drawdown measured on the R equity curve.
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  let streak = 0;
  let longestStreak = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (r <= 0) {
      streak++;
      longestStreak = Math.max(longestStreak, streak);
    } else streak = 0;
  }

  const exits: Record<string, number> = {};
  for (const t of trades) exits[t.reason] = (exits[t.reason] ?? 0) + 1;

  const winRate = wins.length / trades.length;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgR: rs.reduce((s, r) => s + r, 0) / trades.length,
    medianR: sorted[Math.floor(sorted.length / 2)],
    expectancy: winRate * avgWin - (1 - winRate) * avgLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    totalR: rs.reduce((s, r) => s + r, 0),
    maxDrawdownR: maxDd,
    longestLosingStreak: longestStreak,
    avgBarsHeld: trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length,
    exits,
  };
}
