import { C, S, type PatternDef } from "./dsl";

/**
 * ⚠️ THESE ARE HYPOTHESES, NOT EDGES. ⚠️
 *
 * Every pattern here is drawn from the public technical literature. None is
 * known to be profitable — least of all on these instruments, with real spreads
 * and slippage, in current conditions. Most published patterns do not survive
 * contact with costs.
 *
 * They exist to be MEASURED. Every one seeds as `incubating`, which routes it
 * to backtesting, then the demo books, and only to live capital once it has
 * earned promotion against thresholds Peter sets and approves.
 *
 * Treating any of these as a reason to trade before it has passed that pipeline
 * would be using the tool exactly backwards.
 *
 * All triggers are fully mechanical — every condition is computable, so each
 * can be backtested objectively and compared on equal terms. Discretionary
 * judgement lives in `contextNotes`, which code never evaluates.
 */

/* -------------------------------------------------------------------------- */
/* SCALP — seconds to minutes, M5                                             */
/* -------------------------------------------------------------------------- */

const scalp: PatternDef[] = [
  {
    slug: "scalp-vwap-reversion",
    name: "VWAP Reversion",
    summary:
      "Price stretches well below the day's VWAP with momentum washed out, and reverts toward it.",
    family: "indicator",
    horizon: "scalp",
    direction: "long",
    timeframe: "M5",
    instrumentClasses: ["fx", "index"],
    trigger: C.all(
      C.session("london", "newyork"),
      C.lt(S.close, S.sub(S.vwap("day"), S.mul(S.atr(14), S.n(1.5)))),
      C.lt(S.rsi(14), S.n(30)),
      // Require an up-close, so we're not catching a knife mid-fall.
      C.gt(S.close, S.open),
    ),
    invalidation: "A close a further 0.5 ATR below the entry bar's low.",
    stop: { kind: "atr", multiple: 1.0 },
    targets: [{ kind: "series", at: S.vwap("day") }, { kind: "timeStop", bars: 24 }],
    management: { breakevenAtR: 0.8, flattenAtHour: 21 },
    contextNotes: [
      "VWAP here is TICK-derived — FX has no centralised volume. It is a real reference many traders watch, but it is not the volume-weighted price an equities trader means.",
      "Expect this to degrade badly in strong trends, where 'extended' keeps getting more extended.",
      "Skip around high-impact releases; mean reversion and news are a poor combination.",
    ],
  },
  {
    slug: "scalp-sweep-reclaim",
    name: "Swing Low Sweep & Reclaim",
    summary:
      "Price takes out the most recent confirmed swing low, then closes back above it — trapping breakout sellers.",
    family: "liquidity",
    horizon: "scalp",
    direction: "long",
    timeframe: "M5",
    instrumentClasses: ["fx", "index", "commodity"],
    trigger: C.all(
      C.session("london", "newyork"),
      C.sweepReclaim(S.swingLow(3), "below", 3),
      C.gt(S.close, S.open),
    ),
    invalidation: "A close below the sweep low.",
    invalidationRule: C.lt(S.close, S.swingLow(3)),
    stop: { kind: "series", at: S.low, bufferAtr: 0.25 },
    targets: [{ kind: "rMultiple", r: 1.5 }, { kind: "timeStop", bars: 20 }],
    management: { breakevenAtR: 1.0, scaleOutFraction: 0.5, flattenAtHour: 21 },
    contextNotes: [
      "The premise is trapped traders, so it wants a level obvious enough that others were positioned against it.",
      "Weakest when the swing low is only a few bars old and barely visible.",
    ],
  },
  {
    slug: "scalp-open-pullback",
    name: "London Open Pullback",
    summary:
      "After the London open establishes direction above VWAP, take the first pullback into the 20 EMA.",
    family: "session",
    horizon: "scalp",
    direction: "long",
    timeframe: "M5",
    instrumentClasses: ["fx", "index"],
    trigger: C.all(
      C.timeOfDay(8, 11),
      C.gt(S.close, S.vwap("day")),
      C.gt(S.ema(20), S.ema(50)),
      // Pulled back to touch the EMA, then closed back above it.
      C.lte(S.low, S.ema(20)),
      C.gt(S.close, S.ema(20)),
    ),
    invalidation: "A close below the 50 EMA.",
    invalidationRule: C.lt(S.close, S.ema(50)),
    stop: { kind: "series", at: S.ema(50), bufferAtr: 0.2 },
    targets: [{ kind: "rMultiple", r: 2 }, { kind: "timeStop", bars: 36 }],
    management: { breakevenAtR: 1.0, flattenAtHour: 16 },
    contextNotes: [
      "Only the FIRST pullback of the session is the intended trade; later ones are a different, weaker pattern.",
      "The 08:00–11:00 window is where London participation is heaviest.",
    ],
  },
  {
    slug: "scalp-bb-fade",
    name: "Bollinger Band Fade",
    summary:
      "A close outside the upper band followed by a close back inside — an exhausted push.",
    family: "indicator",
    horizon: "scalp",
    direction: "short",
    timeframe: "M5",
    instrumentClasses: ["fx", "index"],
    trigger: C.all(
      C.session("london", "newyork"),
      C.recently(C.gt(S.close, S.bb("upper", 20, 2)), 3),
      C.lt(S.close, S.bb("upper", 20, 2)),
      // Range regime only — this is a poor idea in a strong trend.
      C.lt(S.adx("adx", 14), S.n(25)),
    ),
    invalidation: "A close back above the upper band.",
    stop: { kind: "atr", multiple: 1.2 },
    targets: [{ kind: "series", at: S.bb("mid", 20, 2) }, { kind: "timeStop", bars: 20 }],
    management: { breakevenAtR: 0.8, flattenAtHour: 21 },
    contextNotes: [
      "The ADX filter is doing most of the work here. Without it this is a systematic way to short strength.",
    ],
  },
  {
    slug: "scalp-micro-range-break",
    name: "Micro Range Break",
    summary: "Break of the prior 20-bar high while trend strength is expanding.",
    family: "price-action",
    horizon: "scalp",
    direction: "long",
    timeframe: "M5",
    instrumentClasses: ["index", "commodity", "fx"],
    trigger: C.all(
      C.session("london", "newyork"),
      C.gt(S.close, S.priorHigh(20)),
      C.gt(S.adx("adx", 14), S.n(20)),
      C.gt(S.adx("adx", 14), S.ago(S.adx("adx", 14), 3)),
    ),
    invalidation: "A close back below the broken high.",
    invalidationRule: C.lt(S.close, S.ago(S.priorHigh(20), 1)),
    stop: { kind: "atr", multiple: 1.0 },
    targets: [{ kind: "rMultiple", r: 1.5 }, { kind: "timeStop", bars: 24 }],
    management: { breakevenAtR: 1.0, flattenAtHour: 21 },
    contextNotes: [
      "Breakout patterns are the most spread-sensitive family here — on a 1-pip spread this may not clear costs at scalp targets.",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* INTRADAY — flat by the close, M15                                          */
/* -------------------------------------------------------------------------- */

const intraday: PatternDef[] = [
  {
    slug: "intraday-asian-sweep-reversal",
    name: "Asian Range Sweep Reversal",
    summary:
      "London takes out the completed Asian range high, fails, and closes back inside — trapping breakout buyers.",
    family: "session",
    horizon: "intraday",
    direction: "short",
    timeframe: "M15",
    instrumentClasses: ["fx", "index"],
    trigger: C.all(
      C.timeOfDay(8, 13),
      C.sweepReclaim(S.sessionHigh("tokyo", "completed"), "above", 4),
      C.lt(S.close, S.open),
    ),
    invalidation: "A 15-minute close back above the swept high.",
    invalidationRule: C.gt(S.close, S.sessionHigh("tokyo", "completed")),
    stop: { kind: "series", at: S.high, bufferAtr: 0.25 },
    targets: [
      { kind: "series", at: S.sessionLow("tokyo", "completed") },
      { kind: "timeStop", bars: 32 },
    ],
    management: { breakevenAtR: 1.0, scaleOutFraction: 0.5, flattenAtHour: 21 },
    contextNotes: [
      "Uses the COMPLETED Asian range, so the level is fixed before London opens — no reading a range that is still forming.",
      "Wants a reasonably wide Asian range; a compressed one gives a level nobody was watching.",
      "Historically documented on FX majors; treat index behaviour as a separate question.",
    ],
  },
  {
    slug: "intraday-london-range-break",
    name: "London Range Break",
    summary: "Clean break and hold above the completed Asian range after the London open.",
    family: "session",
    horizon: "intraday",
    direction: "long",
    timeframe: "M15",
    instrumentClasses: ["fx", "index"],
    trigger: C.all(
      C.timeOfDay(8, 12),
      C.gt(S.close, S.sessionHigh("tokyo", "completed")),
      C.lte(S.ago(S.close, 1), S.sessionHigh("tokyo", "completed")),
      C.gt(S.close, S.vwap("day")),
    ),
    invalidation: "A close back inside the Asian range.",
    invalidationRule: C.lt(S.close, S.sessionHigh("tokyo", "completed")),
    stop: { kind: "series", at: S.sessionLow("tokyo", "completed") },
    targets: [{ kind: "rMultiple", r: 2 }, { kind: "timeStop", bars: 40 }],
    management: { breakevenAtR: 1.0, scaleOutFraction: 0.5, flattenAtHour: 21 },
    contextNotes: [
      "The direct opposite of the sweep-reversal pattern above. Running both measures which regime you're actually in — they should not both work at once.",
      "Stop at the far side of the range makes for a wide stop and therefore small size.",
    ],
  },
  {
    slug: "intraday-pdh-sweep-fade",
    name: "Prior Day High Sweep",
    summary: "Prior day's high is taken and rejected within the session.",
    family: "liquidity",
    horizon: "intraday",
    direction: "short",
    timeframe: "M15",
    instrumentClasses: ["fx", "index", "commodity"],
    trigger: C.all(
      C.session("london", "newyork"),
      C.sweepReclaim(S.dayHigh("previous"), "above", 4),
      C.lt(S.close, S.open),
    ),
    invalidation: "A 15-minute close above the prior day's high.",
    invalidationRule: C.gt(S.close, S.dayHigh("previous")),
    stop: { kind: "series", at: S.high, bufferAtr: 0.3 },
    targets: [{ kind: "rMultiple", r: 2 }, { kind: "timeStop", bars: 32 }],
    management: { breakevenAtR: 1.0, flattenAtHour: 21 },
    contextNotes: [
      "The prior day high is among the most-watched levels on any chart, which is the whole premise — and also why it is often cleanly broken rather than rejected.",
    ],
  },
  {
    slug: "intraday-ema-pullback",
    name: "Trend Pullback to 20 EMA",
    summary:
      "In a confirmed uptrend, price pulls back to the 20 EMA and closes back above it.",
    family: "indicator",
    horizon: "intraday",
    direction: "long",
    timeframe: "M15",
    instrumentClasses: ["fx", "index", "commodity"],
    trigger: C.all(
      C.session("london", "newyork"),
      C.gt(S.ema(20), S.ema(50)),
      C.gt(S.adx("adx", 14), S.n(20)),
      C.gt(S.adx("plusDI", 14), S.adx("minusDI", 14)),
      C.lte(S.low, S.ema(20)),
      C.gt(S.close, S.ema(20)),
    ),
    invalidation: "A close below the 50 EMA.",
    invalidationRule: C.lt(S.close, S.ema(50)),
    stop: { kind: "series", at: S.ema(50), bufferAtr: 0.25 },
    targets: [{ kind: "rMultiple", r: 2 }, { kind: "timeStop", bars: 48 }],
    management: { breakevenAtR: 1.0, scaleOutFraction: 0.5, flattenAtHour: 21 },
    contextNotes: [
      "The most conventional pattern in this set, which cuts both ways — well studied, and heavily traded.",
    ],
  },
  {
    slug: "intraday-double-bottom-break",
    name: "Double Bottom Break",
    summary:
      "Two lows at a similar level within ATR tolerance, then a break above the intervening swing high.",
    family: "price-action",
    horizon: "intraday",
    direction: "long",
    timeframe: "M15",
    instrumentClasses: ["fx", "index"],
    trigger: C.all(
      C.session("london", "newyork"),
      // Two comparable lows: the current confirmed swing low sits within
      // 0.4 ATR of where it was 10 bars ago.
      C.near(S.swingLow(3), S.ago(S.swingLow(3), 10), S.mul(S.atr(14), S.n(0.4))),
      C.gt(S.close, S.swingHigh(3)),
    ),
    invalidation: "A close below the lower of the two bottoms.",
    invalidationRule: C.lt(S.close, S.swingLow(3)),
    stop: { kind: "series", at: S.swingLow(3), bufferAtr: 0.25 },
    targets: [{ kind: "rMultiple", r: 2 }, { kind: "timeStop", bars: 48 }],
    management: { breakevenAtR: 1.0, flattenAtHour: 21 },
    contextNotes: [
      "The ATR tolerance is what makes 'similar level' mechanical. Widening it turns this into a generic higher-low pattern.",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* SWING — days to weeks, H4                                                  */
/* -------------------------------------------------------------------------- */

const swing: PatternDef[] = [
  {
    slug: "swing-bos-retest",
    name: "Break of Structure Retest",
    summary:
      "Price breaks the last confirmed swing high, then returns to test it from above.",
    family: "liquidity",
    horizon: "swing",
    direction: "long",
    timeframe: "H4",
    instrumentClasses: ["fx", "index", "commodity"],
    trigger: C.all(
      C.recently(C.gt(S.close, S.swingHigh(3)), 8),
      C.near(S.low, S.swingHigh(3), S.mul(S.atr(14), S.n(0.5))),
      C.gt(S.close, S.swingHigh(3)),
      C.gt(S.close, S.ema(50)),
    ),
    invalidation: "A 4-hour close back below the broken structure.",
    invalidationRule: C.lt(S.close, S.swingHigh(3)),
    stop: { kind: "series", at: S.swingLow(3), bufferAtr: 0.3 },
    targets: [{ kind: "rMultiple", r: 3 }, { kind: "timeStop", bars: 60 }],
    management: { breakevenAtR: 1.0, scaleOutFraction: 0.5, trailOn: S.ema(20) },
    contextNotes: [
      "Requires the break to have happened recently — an old break retested weeks later is a different situation.",
      "Carries overnight financing; on a multi-day hold that is a real cost against the R calculation.",
    ],
  },
  {
    slug: "swing-macd-trend-cross",
    name: "MACD Cross in Trend",
    summary: "MACD crosses above its signal line while price holds above the 200 EMA.",
    family: "indicator",
    horizon: "swing",
    direction: "long",
    timeframe: "H4",
    instrumentClasses: ["fx", "index", "commodity"],
    trigger: C.all(
      C.crossAbove(S.macd("line"), S.macd("signal")),
      C.gt(S.close, S.ema(200)),
      C.lt(S.macd("line"), S.n(0)),
    ),
    invalidation: "MACD crosses back below its signal line.",
    invalidationRule: C.crossBelow(S.macd("line"), S.macd("signal")),
    stop: { kind: "atr", multiple: 2.0 },
    targets: [{ kind: "rMultiple", r: 3 }, { kind: "timeStop", bars: 90 }],
    management: { breakevenAtR: 1.5, scaleOutFraction: 0.5, trailOn: S.ema(50) },
    contextNotes: [
      "Requiring the cross to occur BELOW zero targets pullbacks within an uptrend rather than late-stage momentum.",
      "MACD crosses are frequent; expect a low win rate carried by a few large winners, if it works at all.",
    ],
  },
  {
    slug: "swing-range-low-sweep",
    name: "Multi-Day Low Sweep",
    summary:
      "Price sweeps the 30-bar low and closes back above it, with a bullish momentum divergence present.",
    family: "liquidity",
    horizon: "swing",
    direction: "long",
    timeframe: "H4",
    instrumentClasses: ["fx", "commodity", "index"],
    trigger: C.all(
      C.sweepReclaim(S.priorLow(30), "below", 4),
      C.divergence("bullish", S.rsi(14), { swingLookback: 3, validForBars: 6 }),
    ),
    invalidation: "A close below the sweep low.",
    stop: { kind: "series", at: S.low, bufferAtr: 0.4 },
    targets: [{ kind: "rMultiple", r: 3 }, { kind: "timeStop", bars: 90 }],
    management: { breakevenAtR: 1.5, scaleOutFraction: 0.5, trailOn: S.ema(20) },
    contextNotes: [
      "Divergence necessarily lags — both swings must be confirmed. If it looks tradeable in real time you have probably spotted it late.",
      "Combining two conditions cuts the signal count sharply. Watch the sample size before drawing conclusions.",
    ],
  },
  {
    slug: "swing-squeeze-expansion",
    name: "Volatility Squeeze Expansion",
    summary:
      "Bollinger Bands contract inside the Keltner Channels, then price closes above the upper band.",
    family: "price-action",
    horizon: "swing",
    direction: "long",
    timeframe: "H4",
    instrumentClasses: ["index", "commodity", "fx"],
    trigger: C.all(
      C.recently(
        C.all(
          C.lt(S.bb("upper", 20, 2), { s: "keltner", band: "upper", period: 20, mult: 1.5 }),
          C.gt(S.bb("lower", 20, 2), { s: "keltner", band: "lower", period: 20, mult: 1.5 }),
        ),
        6,
      ),
      C.gt(S.close, S.bb("upper", 20, 2)),
    ),
    invalidation: "A close back inside the bands.",
    invalidationRule: C.lt(S.close, S.bb("upper", 20, 2)),
    stop: { kind: "series", at: S.bb("mid", 20, 2) },
    targets: [{ kind: "rMultiple", r: 3 }, { kind: "timeStop", bars: 60 }],
    management: { breakevenAtR: 1.0, scaleOutFraction: 0.5, trailOn: S.ema(20) },
    contextNotes: [
      "The squeeze identifies compression; it says nothing about which way the expansion goes. This definition only takes the upside — the short mirror is a separate pattern worth testing alongside.",
    ],
  },
  {
    slug: "swing-rsi-divergence",
    name: "RSI Divergence Reversal",
    summary: "Bullish RSI divergence with price reclaiming the 50 EMA.",
    family: "indicator",
    horizon: "swing",
    direction: "long",
    timeframe: "H4",
    instrumentClasses: ["fx", "index", "commodity"],
    trigger: C.all(
      C.divergence("bullish", S.rsi(14), { swingLookback: 3, validForBars: 8 }),
      C.crossAbove(S.close, S.ema(50)),
    ),
    invalidation: "A close below the divergence low.",
    stop: { kind: "atr", multiple: 2.0 },
    targets: [{ kind: "rMultiple", r: 2.5 }, { kind: "timeStop", bars: 90 }],
    management: { breakevenAtR: 1.2, trailOn: S.ema(20) },
    contextNotes: [
      "Divergence is among the most over-claimed signals in technical analysis. This is exactly the sort of pattern the backtester exists to be sceptical about.",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* POSITION — weeks to months, D                                              */
/* -------------------------------------------------------------------------- */

const position: PatternDef[] = [
  {
    slug: "position-ma-regime-shift",
    name: "Moving Average Regime Shift",
    summary: "The 50 EMA crosses above the 200 EMA with trend strength confirming.",
    family: "indicator",
    horizon: "position",
    direction: "long",
    timeframe: "D",
    instrumentClasses: ["index", "commodity", "fx"],
    trigger: C.all(
      C.crossAbove(S.ema(50), S.ema(200)),
      C.gt(S.adx("adx", 14), S.n(20)),
    ),
    invalidation: "The 50 EMA crosses back below the 200 EMA.",
    invalidationRule: C.crossBelow(S.ema(50), S.ema(200)),
    stop: { kind: "atr", multiple: 3.0 },
    targets: [{ kind: "rMultiple", r: 4 }, { kind: "timeStop", bars: 120 }],
    management: { breakevenAtR: 2.0, scaleOutFraction: 0.33, trailOn: S.ema(50) },
    contextNotes: [
      "Signals are rare — expect only a handful per instrument per decade, so a meaningful sample needs many instruments.",
      "Financing costs over a multi-month hold are material and must be in the R calculation, not ignored.",
    ],
  },
  {
    slug: "position-donchian-breakout",
    name: "55-Day Breakout",
    summary: "Close above the highest high of the prior 55 days.",
    family: "price-action",
    horizon: "position",
    direction: "long",
    timeframe: "D",
    instrumentClasses: ["commodity", "index", "fx"],
    trigger: C.all(
      C.gt(S.close, S.priorHigh(55)),
      C.gt(S.close, S.ema(200)),
    ),
    invalidation: "Close below the 20-day low.",
    invalidationRule: C.lt(S.close, S.priorLow(20)),
    stop: { kind: "atr", multiple: 2.5 },
    targets: [{ kind: "rMultiple", r: 4 }, { kind: "timeStop", bars: 120 }],
    management: { breakevenAtR: 2.0, trailOn: S.priorLow(20) },
    contextNotes: [
      "The classic trend-following breakout. Very widely known and traded, which may or may not have arbitraged it away — that is a measurable question, not a rhetorical one.",
      "Expect a low win rate with a long right tail. Judging this one on win rate rather than expectancy would be a mistake.",
    ],
  },
  {
    slug: "position-week-open-drive",
    name: "Monday Continuation",
    summary:
      "A Monday close above the prior day's high while the longer-term trend is up.",
    family: "session",
    horizon: "position",
    direction: "long",
    timeframe: "D",
    instrumentClasses: ["index", "fx"],
    trigger: C.all(
      C.dayOfWeek(1),
      C.gt(S.close, S.dayHigh("previous")),
      C.gt(S.close, S.ema(50)),
      C.gt(S.ema(50), S.ema(200)),
    ),
    invalidation: "Close below the 50 EMA.",
    invalidationRule: C.lt(S.close, S.ema(50)),
    stop: { kind: "atr", multiple: 2.5 },
    targets: [{ kind: "rMultiple", r: 3 }, { kind: "timeStop", bars: 60 }],
    management: { breakevenAtR: 1.5, trailOn: S.ema(20) },
    contextNotes: [
      "Day-of-week effects are the classic home of data mining. With five weekdays to choose from, one will look good by chance — treat any result here with particular suspicion.",
    ],
  },
  {
    slug: "position-long-term-sweep",
    name: "Quarterly Low Sweep",
    summary: "Price sweeps the 60-day low and reclaims it on a daily close.",
    family: "liquidity",
    horizon: "position",
    direction: "long",
    timeframe: "D",
    instrumentClasses: ["commodity", "index", "fx"],
    trigger: C.all(
      C.sweepReclaim(S.priorLow(60), "below", 3),
      C.gt(S.close, S.open),
    ),
    invalidation: "A daily close below the sweep low.",
    stop: { kind: "series", at: S.low, bufferAtr: 0.5 },
    targets: [{ kind: "rMultiple", r: 4 }, { kind: "timeStop", bars: 120 }],
    management: { breakevenAtR: 2.0, scaleOutFraction: 0.5, trailOn: S.ema(50) },
    contextNotes: [
      "Catching a falling market on a reclaim is a genuinely dangerous premise. The stop placement matters more here than anywhere else in this set.",
    ],
  },
  {
    slug: "position-vol-contraction",
    name: "Volatility Contraction Breakout",
    summary:
      "ATR compresses to a multi-week low, then price breaks the 20-day high as volatility expands.",
    family: "price-action",
    horizon: "position",
    direction: "long",
    timeframe: "D",
    instrumentClasses: ["index", "commodity", "fx"],
    trigger: C.all(
      C.recently(C.lt(S.atr(14), S.mul(S.ago(S.atr(14), 20), S.n(0.7))), 10),
      C.gt(S.close, S.priorHigh(20)),
      C.gt(S.atr(14), S.ago(S.atr(14), 3)),
      C.gt(S.close, S.ema(200)),
    ),
    invalidation: "Close back below the 20-day high.",
    stop: { kind: "atr", multiple: 2.0 },
    targets: [{ kind: "rMultiple", r: 4 }, { kind: "timeStop", bars: 90 }],
    management: { breakevenAtR: 1.5, scaleOutFraction: 0.5, trailOn: S.priorLow(20) },
    contextNotes: [
      "Volatility clusters, so contraction genuinely does tend to precede expansion. Direction, however, is a separate claim and this pattern assumes it.",
    ],
  },
];

export const SEED_PATTERNS: PatternDef[] = [...scalp, ...intraday, ...swing, ...position];

export const SEED_BY_SLUG = new Map(SEED_PATTERNS.map((p) => [p.slug, p]));
