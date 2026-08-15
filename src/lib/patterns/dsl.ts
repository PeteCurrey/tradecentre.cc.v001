import type { SessionId } from "@/lib/time";

/**
 * Pattern rule DSL.
 *
 * Patterns are stored as JSON in `patterns.trigger_rules`, not as code. One
 * definition therefore drives the live scanner AND the backtester, so a pattern
 * cannot silently behave differently in testing than in production — which is
 * the usual way backtest results stop meaning anything.
 *
 * Everything here is deliberately mechanical. Discretionary reads belong in
 * `contextFilters` as prose for the AI layer and for Peter to judge.
 */

/* ==========================================================================
   SERIES — evaluate to a number at each bar
   ========================================================================== */

export type SeriesRef =
  | { s: "const"; value: number }
  | { s: "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "tickVolume" }
  | { s: "sma" | "ema" | "rsi" | "atr" | "cci"; period: number }
  | {
      s: "macd";
      line: "line" | "signal" | "hist";
      fast?: number;
      slow?: number;
      signal?: number;
    }
  | { s: "bb"; band: "upper" | "mid" | "lower"; period?: number; mult?: number }
  | { s: "keltner"; band: "upper" | "mid" | "lower"; period?: number; mult?: number }
  | { s: "adx"; line: "adx" | "plusDI" | "minusDI"; period?: number }
  | { s: "stoch"; line: "k" | "d"; kPeriod?: number; dPeriod?: number; smooth?: number }
  | { s: "swingHigh" | "swingLow"; lookback?: number }
  | { s: "priorHigh" | "priorLow"; period: number }
  /** Rolling day extremes, London day. `previous` is the completed prior day. */
  | { s: "dayHigh" | "dayLow"; which: "current" | "previous" }
  /**
   * Session extremes. `completed` is the most recent session instance that has
   * fully ended — the correct reference for range-break patterns, and the one
   * that avoids reading a range that is still forming.
   */
  | { s: "sessionHigh" | "sessionLow"; session: SessionId; which: "current" | "completed" }
  | { s: "vwap"; anchor: "session" | "day" }
  /** Arithmetic, so "0.5 × ATR(14)" is expressible. */
  | { s: "add" | "sub" | "mul" | "div"; a: SeriesRef; b: SeriesRef }
  /**
   * Pairwise max/min of two series.
   *
   * Needed because `priorHigh(n)` deliberately EXCLUDES the current bar, while
   * Pine's `ta.highest(high, n)` includes it. The inclusive form is
   * `max(priorHigh(n-1), high)`, so without this a Donchian channel — the
   * canonical trend-following construct — cannot be translated faithfully.
   */
  | { s: "max" | "min"; a: SeriesRef; b: SeriesRef }
  | { s: "abs"; a: SeriesRef }
  /** Shift a series back N bars. */
  | { s: "offset"; a: SeriesRef; bars: number };

/* ==========================================================================
   CONDITIONS — evaluate to a boolean at each bar
   ========================================================================== */

export type Condition =
  | { c: "cmp"; left: SeriesRef; op: ">" | ">=" | "<" | "<=" ; right: SeriesRef }
  | { c: "cross"; left: SeriesRef; right: SeriesRef; dir: "above" | "below" }
  | { c: "session"; sessions: SessionId[] }
  /** London-hour window, [after, before). */
  | { c: "timeOfDay"; afterHour: number; beforeHour: number }
  /** 0 = Sunday … 6 = Saturday, in London time. */
  | { c: "dayOfWeek"; days: number[] }
  /** |a − b| ≤ tolerance. Tolerance is itself a series, so ATR-relative works. */
  | { c: "within"; a: SeriesRef; b: SeriesRef; tolerance: SeriesRef }
  /**
   * Liquidity sweep and reclaim: price traded through `level` within the last
   * `withinBars`, and has now closed back on the original side.
   *
   * dir "above" = swept the level to the upside, then reclaimed below it.
   */
  | { c: "sweepReclaim"; level: SeriesRef; dir: "above" | "below"; withinBars: number }
  /**
   * Regular divergence between price and an oscillator.
   *
   * bullish: price makes a lower confirmed swing low while the indicator makes
   * a higher one. bearish: price a higher swing high, indicator a lower one.
   *
   * Both swings must be CONFIRMED, so this necessarily lags — which is honest.
   * A divergence you can act on in real time is one you spotted late.
   */
  | {
      c: "divergence";
      kind: "bullish" | "bearish";
      indicator: SeriesRef;
      /** Fractal width for swing confirmation. */
      swingLookback?: number;
      /** Signal stays live this many bars after the second swing confirms. */
      validForBars?: number;
      /** Ignore swing pairs further apart than this. */
      maxSpanBars?: number;
    }
  /** Sub-condition true on every one of the last N bars, inclusive. */
  | { c: "consecutive"; of: Condition; bars: number }
  /** Sub-condition true on at least one of the last N bars, inclusive. */
  | { c: "withinBars"; of: Condition; bars: number }
  | { c: "all"; of: Condition[] }
  | { c: "any"; of: Condition[] }
  | { c: "not"; of: Condition };

/* ==========================================================================
   PATTERN DEFINITION
   ========================================================================== */

export type Direction = "long" | "short";

export type StopRule =
  /** Stop at a price series (e.g. the swept swing high) plus an ATR buffer. */
  | { kind: "series"; at: SeriesRef; bufferAtr?: number }
  /** Stop N × ATR from entry. */
  | { kind: "atr"; multiple: number };

export type TargetRule =
  | { kind: "rMultiple"; r: number }
  | { kind: "series"; at: SeriesRef }
  /** Exit after N bars regardless — the honest way to bound a hold time. */
  | { kind: "timeStop"; bars: number };

export type ManagementRule = {
  /** Move stop to entry once this many R in profit. */
  breakevenAtR?: number;
  /** Take this fraction off at the first target. 0–1. */
  scaleOutFraction?: number;
  /** Trail the remainder on a series once the first target is hit. */
  trailOn?: SeriesRef;
  /** Hard exit if still open at this London hour (for intraday books). */
  flattenAtHour?: number;
};

export type PatternDef = {
  slug: string;
  name: string;
  summary: string;
  family: "liquidity" | "price-action" | "indicator" | "session";
  horizon: "scalp" | "intraday" | "swing" | "position";
  direction: Direction;
  /** Candle granularity the trigger is evaluated on. */
  timeframe: string;
  instrumentClasses: string[];

  /** Machine-checkable arming conditions. All must hold on the signal bar. */
  trigger: Condition;
  /** What kills the setup once armed. Prose plus, where possible, a condition. */
  invalidation: string;
  invalidationRule?: Condition;

  /**
   * Close an OPEN position when this holds on a bar's close.
   *
   * Distinct from `invalidationRule`, which kills a setup before entry. This is
   * an exit for a live position, and it exists because a large family of
   * published strategies — most trend-following, every stop-and-reverse system
   * — has no protective stop at all and exits purely on a signal. Without this
   * the DSL cannot express them, and translating one by bolting on a stop would
   * be testing a different strategy (decision #69).
   *
   * `stop` remains REQUIRED even when a pattern uses this, because R is defined
   * by risk at entry and every figure in this app is denominated in R. For a
   * strategy with no stop of its own, use a deliberately wide ATR stop as a
   * disaster stop and CHECK HOW OFTEN IT BINDS — `Stats.exits.stop` against
   * `exits.signal`. If it binds often it is not a disaster stop, it is a
   * material change to the strategy, and the translation should be rejected.
   */
  exitRule?: Condition;

  stop: StopRule;
  targets: TargetRule[];
  management?: ManagementRule;

  /** Prose. Evaluated by the AI context layer and by Peter — not by code. */
  contextNotes: string[];
};

/* ==========================================================================
   HELPERS — keep pattern definitions readable
   ========================================================================== */

export const S = {
  close: { s: "close" } as SeriesRef,
  open: { s: "open" } as SeriesRef,
  high: { s: "high" } as SeriesRef,
  low: { s: "low" } as SeriesRef,
  n: (value: number): SeriesRef => ({ s: "const", value }),
  ema: (period: number): SeriesRef => ({ s: "ema", period }),
  sma: (period: number): SeriesRef => ({ s: "sma", period }),
  rsi: (period = 14): SeriesRef => ({ s: "rsi", period }),
  atr: (period = 14): SeriesRef => ({ s: "atr", period }),
  adx: (line: "adx" | "plusDI" | "minusDI" = "adx", period = 14): SeriesRef => ({
    s: "adx",
    line,
    period,
  }),
  macd: (line: "line" | "signal" | "hist" = "line"): SeriesRef => ({ s: "macd", line }),
  bb: (band: "upper" | "mid" | "lower", period = 20, mult = 2): SeriesRef => ({
    s: "bb",
    band,
    period,
    mult,
  }),
  stoch: (line: "k" | "d" = "k"): SeriesRef => ({ s: "stoch", line }),
  swingHigh: (lookback = 2): SeriesRef => ({ s: "swingHigh", lookback }),
  swingLow: (lookback = 2): SeriesRef => ({ s: "swingLow", lookback }),
  priorHigh: (period: number): SeriesRef => ({ s: "priorHigh", period }),
  priorLow: (period: number): SeriesRef => ({ s: "priorLow", period }),
  dayHigh: (which: "current" | "previous" = "previous"): SeriesRef => ({
    s: "dayHigh",
    which,
  }),
  dayLow: (which: "current" | "previous" = "previous"): SeriesRef => ({
    s: "dayLow",
    which,
  }),
  sessionHigh: (session: SessionId, which: "current" | "completed" = "completed"): SeriesRef => ({
    s: "sessionHigh",
    session,
    which,
  }),
  sessionLow: (session: SessionId, which: "current" | "completed" = "completed"): SeriesRef => ({
    s: "sessionLow",
    session,
    which,
  }),
  vwap: (anchor: "session" | "day" = "day"): SeriesRef => ({ s: "vwap", anchor }),
  mul: (a: SeriesRef, b: SeriesRef): SeriesRef => ({ s: "mul", a, b }),
  add: (a: SeriesRef, b: SeriesRef): SeriesRef => ({ s: "add", a, b }),
  sub: (a: SeriesRef, b: SeriesRef): SeriesRef => ({ s: "sub", a, b }),
  div: (a: SeriesRef, b: SeriesRef): SeriesRef => ({ s: "div", a, b }),
  max: (a: SeriesRef, b: SeriesRef): SeriesRef => ({ s: "max", a, b }),
  min: (a: SeriesRef, b: SeriesRef): SeriesRef => ({ s: "min", a, b }),
  /** Pine's `ta.highest(high, n)` — inclusive of the current bar. */
  highestHigh: (period: number): SeriesRef => ({
    s: "max",
    a: { s: "priorHigh", period: period - 1 },
    b: { s: "high" },
  }),
  /** Pine's `ta.lowest(low, n)` — inclusive of the current bar. */
  lowestLow: (period: number): SeriesRef => ({
    s: "min",
    a: { s: "priorLow", period: period - 1 },
    b: { s: "low" },
  }),
  abs: (a: SeriesRef): SeriesRef => ({ s: "abs", a }),
  ago: (a: SeriesRef, bars: number): SeriesRef => ({ s: "offset", a, bars }),
};

export const C = {
  gt: (left: SeriesRef, right: SeriesRef): Condition => ({ c: "cmp", left, op: ">", right }),
  gte: (left: SeriesRef, right: SeriesRef): Condition => ({ c: "cmp", left, op: ">=", right }),
  lt: (left: SeriesRef, right: SeriesRef): Condition => ({ c: "cmp", left, op: "<", right }),
  lte: (left: SeriesRef, right: SeriesRef): Condition => ({ c: "cmp", left, op: "<=", right }),
  crossAbove: (left: SeriesRef, right: SeriesRef): Condition => ({
    c: "cross",
    left,
    right,
    dir: "above",
  }),
  crossBelow: (left: SeriesRef, right: SeriesRef): Condition => ({
    c: "cross",
    left,
    right,
    dir: "below",
  }),
  session: (...sessions: SessionId[]): Condition => ({ c: "session", sessions }),
  timeOfDay: (afterHour: number, beforeHour: number): Condition => ({
    c: "timeOfDay",
    afterHour,
    beforeHour,
  }),
  dayOfWeek: (...days: number[]): Condition => ({ c: "dayOfWeek", days }),
  near: (a: SeriesRef, b: SeriesRef, tolerance: SeriesRef): Condition => ({
    c: "within",
    a,
    b,
    tolerance,
  }),
  sweepReclaim: (
    level: SeriesRef,
    dir: "above" | "below",
    withinBars: number,
  ): Condition => ({ c: "sweepReclaim", level, dir, withinBars }),
  divergence: (
    kind: "bullish" | "bearish",
    indicator: SeriesRef,
    opts: { swingLookback?: number; validForBars?: number; maxSpanBars?: number } = {},
  ): Condition => ({ c: "divergence", kind, indicator, ...opts }),
  consecutive: (of: Condition, bars: number): Condition => ({ c: "consecutive", of, bars }),
  recently: (of: Condition, bars: number): Condition => ({ c: "withinBars", of, bars }),
  all: (...of: Condition[]): Condition => ({ c: "all", of }),
  any: (...of: Condition[]): Condition => ({ c: "any", of }),
  not: (of: Condition): Condition => ({ c: "not", of }),
};
