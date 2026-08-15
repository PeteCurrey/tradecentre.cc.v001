import { C, S, type PatternDef } from "./dsl";

/**
 * Patterns translated from public TradingView Pine Script.
 *
 * ⚠️ SAME STATUS AS EVERYTHING ELSE IN THE LIBRARY: hypotheses, not edges.
 * A script's popularity on TradingView is a discovery signal and nothing more
 * (decision #70). Its performance there is not evidence: much of that library
 * repaints, and none of it is costed at Peter's spreads.
 *
 * ── Rules for anything added here ──────────────────────────────────────────
 *
 * 1. ATTRIBUTION. Source URL, author and licence in the header. TradingView's
 *    open scripts default to MPL-2.0; the authors retain copyright.
 * 2. NO APPROXIMATION (decision #69). If the DSL cannot express a condition,
 *    the strategy is REJECTED, not simplified. A strategy quietly stripped of
 *    a filter is a different strategy wearing the same name.
 * 3. DEVIATIONS DECLARED. Anything not in the original — most often a disaster
 *    stop, since this app denominates everything in R — is written down here
 *    and its effect measured, not assumed negligible.
 */

/* ==========================================================================
   RSI Mean Reversion — kparicharak92615
   https://www.tradingview.com/script/JFIZkwZR-RSI-Mean-Reversion/
   MPL-2.0. Published on H4. 519 likes.
   ==========================================================================

   Original Pine, in full:
     rsi         = ta.rsi(close, 3)
     longSignal  = ta.crossover(rsi, 40)
     shortSignal = ta.crossunder(rsi, 70)
     on longSignal:  close Short, enter Long
     on shortSignal: close Long,  enter Short

   A stop-and-reverse system: always in the market, no stop, no target. Exit is
   solely the opposite signal, which `exitRule` now expresses.

   ⚠️ THE AUTHOR DECLARES IT CURVE-FITTED. The header reads "Optimized for
   Natural Gas Mini (MCX) on 4H timeframe / Best configs from optimization:
   RSI 3, Oversold 34-40, Overbought 70". RSI(3) with a 40/70 pair is a tuned
   combination on one instrument, so the prior that it generalises to FX,
   indices or metals is low. That is a reason to measure it, not to skip it —
   but it should surprise nobody if it fails.

   DEVIATION FROM THE ORIGINAL: a 10×ATR(14) disaster stop, because R is
   undefined without risk at entry and every figure in this app is in R. It is
   deliberately far enough away to rarely bind. VERIFY THAT: compare
   `exits.stop` against `exits.signal` in the result. If the stop is taking a
   meaningful share of exits it is not a disaster stop, it is a material change,
   and this translation must be rejected.

   Split into long and short because PatternDef carries a single direction.
*/

const RSI_MR_BASE = {
  summary:
    "RSI(3) crosses back out of an extreme; exits on the opposite extreme. Stop-and-reverse, no target.",
  family: "indicator" as const,
  horizon: "swing" as const,
  timeframe: "H4",
  instrumentClasses: ["fx", "index", "commodity"],
  stop: { kind: "atr" as const, multiple: 10 },
  targets: [],
  contextNotes: [
    "Translated from TradingView, author kparicharak92615, MPL-2.0.",
    "Author states it was optimised for Natural Gas Mini (MCX) on 4H — treat the parameters as fitted to another instrument.",
    "The 10×ATR stop is NOT in the original. Check exits.stop is a small share of exits, or reject this translation.",
    "RSI(3) is extremely fast; expect a high trade count and heavy sensitivity to spread.",
  ],
};

export const RSI_MEAN_REVERSION_LONG: PatternDef = {
  ...RSI_MR_BASE,
  slug: "tv-rsi-mean-reversion-long",
  name: "RSI Mean Reversion (long)",
  direction: "long",
  trigger: C.crossAbove(S.rsi(3), S.n(40)),
  invalidation: "RSI(3) crosses below 70, which is the short signal and closes this position.",
  exitRule: C.crossBelow(S.rsi(3), S.n(70)),
};

export const RSI_MEAN_REVERSION_SHORT: PatternDef = {
  ...RSI_MR_BASE,
  slug: "tv-rsi-mean-reversion-short",
  name: "RSI Mean Reversion (short)",
  direction: "short",
  trigger: C.crossBelow(S.rsi(3), S.n(70)),
  invalidation: "RSI(3) crosses above 40, which is the long signal and closes this position.",
  exitRule: C.crossAbove(S.rsi(3), S.n(40)),
};

/* ==========================================================================
   REJECTED — Price and Volume Breakout Buy Strategy [TradeDots]
   https://www.tradingview.com/script/jc2hs2qK-Price-and-Volume-Breakout-Buy-Strategy-TradeDots/
   MPL-2.0. Published on H4. 5,170 likes — the most popular H4 candidate found.
   ==========================================================================

   Entry required all three:
     close > ta.highest(high, 60)[1]      → expressible: S.priorHigh(60)
     close > ta.sma(close, 200)           → expressible: S.sma(200)
     volume > ta.highest(volume, 60)[1]   → NOT EXPRESSIBLE, and worse than that

   Rejected on two independent grounds, either sufficient.

   1. NOT EXPRESSIBLE. The DSL has no rolling maximum over an arbitrary series;
      `priorHigh` works on bar highs only. Dropping the volume filter would
      leave a plain 60-bar breakout with a trend filter — a different strategy
      that happens to share a name, which is exactly what decision #69 forbids.

   2. THE PREMISE DOES NOT SURVIVE THE INSTRUMENT. OANDA's candle `volume` is
      TICK COUNT, not traded volume — FX and CFDs have no centralised volume.
      "Volume exceeds its 60-bar maximum" would become "tick count exceeded its
      60-bar maximum", which measures quote activity, not participation. The
      strategy's central claim is that volume confirms a breakout; on Peter's
      instruments that claim cannot be tested at all.

   Adding a generic rolling-max series to the DSL would fix (1). It would not
   fix (2), so it would not make this strategy testable here. Revisit only if
   equities arrive with real volume (decision #75).
*/

/* ==========================================================================
   Donchian Channel Strategy Idea — QuantCT
   https://www.tradingview.com/script/KA6ZtxT8-Donchian-Channel-Strategy-Idea/
   MPL-2.0. Published on D. 267 likes.
   ==========================================================================

   Original Pine (v4), logic in full:
     highest_high = highest(high, 10)          // INCLUDES the current bar
     lowest_low   = lowest(low, 10)
     base_line    = (highest_high + lowest_low) / 2
     enter_long   = close > highest_high[1]
     exit_long    = close < base_line
     enter_short  = close < lowest_low[1]
     exit_short   = close > base_line

   The canonical Donchian/Turtle construct: break the 10-bar extreme, exit back
   through the channel midline. Chosen deliberately as the antithesis of what
   keeps failing here — daily bars and few trades, rather than thousands of
   round trips paying spread each time.

   ⚠️ THE OFF-BY-ONE THAT MATTERS. Entry compares against `highest_high[1]`,
   which is exactly `priorHigh(10)`. But `base_line` uses the CURRENT bar's
   `highest(high, 10)`, which includes the bar being evaluated. On an entry bar
   — by definition a new 10-bar high — that inclusion pulls the midline up
   immediately. Substituting the previous-10 midline would understate it on
   precisely the bars that matter most, so `S.highestHigh(10)` was added to the
   DSL to express the inclusive form exactly rather than approximate it.

   DEVIATION: the original defaults `use_sl = false`, so there is no stop. A
   10xATR disaster stop is added for R, and its bind rate is measured.
*/

const DONCHIAN_BASE = {
  summary:
    "Break the 10-bar extreme, exit back through the channel midline. Classic Donchian trend following.",
  family: "price-action" as const,
  horizon: "position" as const,
  timeframe: "D",
  instrumentClasses: ["fx", "index", "commodity"],
  stop: { kind: "atr" as const, multiple: 10 },
  targets: [],
  contextNotes: [
    "Translated from TradingView, author QuantCT, MPL-2.0.",
    "The 10×ATR stop is NOT in the original (use_sl defaults false). Check exits.stop is a small share, or reject.",
    "Midline uses the INCLUSIVE 10-bar extremes, matching Pine's ta.highest/ta.lowest.",
    "Low frequency by design — on daily bars this should trade a handful of times a year per instrument.",
  ],
};

/** Midline: (highest(high,10) + lowest(low,10)) / 2, both inclusive of this bar. */
const DONCHIAN_MID = S.div(
  S.add(S.highestHigh(10), S.lowestLow(10)),
  S.n(2),
);

export const DONCHIAN_LONG: PatternDef = {
  ...DONCHIAN_BASE,
  slug: "tv-donchian-long",
  name: "Donchian Channel (long)",
  direction: "long",
  trigger: C.gt(S.close, S.priorHigh(10)),
  invalidation: "Close back below the channel midline.",
  exitRule: C.lt(S.close, DONCHIAN_MID),
};

export const DONCHIAN_SHORT: PatternDef = {
  ...DONCHIAN_BASE,
  slug: "tv-donchian-short",
  name: "Donchian Channel (short)",
  direction: "short",
  trigger: C.lt(S.close, S.priorLow(10)),
  invalidation: "Close back above the channel midline.",
  exitRule: C.gt(S.close, DONCHIAN_MID),
};

/* ==========================================================================
   8 Day Run — Momentum Strategy — Marcn5_
   https://www.tradingview.com/script/fXvKVs5J-8-Day-Run-Momentum-Strategy/
   MPL-2.0. Published on D. 231 likes. Credits Linda Bradford Raschke.
   ==========================================================================

   Original Pine (v5):
     SMA        = ta.sma(close, 5)
     TriggerBuy = ta.barssince(close < SMA) >= 8
     Buy        = TriggerBuy[1] and close <= SMA
     exit       = close > SMA

   Buy the first pullback to the 5-SMA after an eight-bar run above it.

   TRANSLATION NOTE. `barssince(close < SMA) >= 8` means close held at or above
   the SMA for the eight bars ending here. `TriggerBuy[1]` needs that run
   measured to the PREVIOUS bar, and the DSL can offset series but not
   conditions — so the run is written out as eight explicit offset comparisons,
   bars 1 through 8 back. Verbose, but exact rather than approximate.

   DEVIATION: no stop in the original. 10xATR disaster stop, bind rate measured.
*/

const SMA5 = S.sma(5);

/** close >= SMA(5) on each of bars 1..8 back — i.e. TriggerBuy as of last bar. */
const EIGHT_BAR_RUN = C.all(
  ...Array.from({ length: 8 }, (_, k) =>
    C.gte(S.ago(S.close, k + 1), S.ago(SMA5, k + 1)),
  ),
);

export const EIGHT_DAY_RUN: PatternDef = {
  slug: "tv-8day-run",
  name: "8 Day Run",
  summary:
    "After eight consecutive closes above the 5-SMA, buy the first close back to or below it.",
  family: "price-action",
  horizon: "swing",
  timeframe: "D",
  instrumentClasses: ["fx", "index", "commodity"],
  direction: "long",
  trigger: C.all(EIGHT_BAR_RUN, C.lte(S.close, SMA5)),
  invalidation: "Close back above the 5-SMA, which is also the exit.",
  exitRule: C.gt(S.close, SMA5),
  stop: { kind: "atr", multiple: 10 },
  targets: [],
  contextNotes: [
    "Translated from TradingView, author Marcn5_, MPL-2.0. Credits Linda Bradford Raschke.",
    "The 10×ATR stop is NOT in the original. Check exits.stop is a small share, or reject.",
    "The eight-bar run is written as explicit offset comparisons because the DSL offsets series, not conditions.",
    "Published for futures; being tested on FX, indices and metals, which is outside its stated context.",
  ],
};

export const HARVESTED_PATTERNS: PatternDef[] = [
  RSI_MEAN_REVERSION_LONG,
  RSI_MEAN_REVERSION_SHORT,
  DONCHIAN_LONG,
  DONCHIAN_SHORT,
  EIGHT_DAY_RUN,
];
