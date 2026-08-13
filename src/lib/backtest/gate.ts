import type { Bar } from "@/lib/indicators";
import type { PatternDef } from "@/lib/patterns/dsl";
import { backtest, computeStats, type BacktestTrade, type Costs, type Stats } from "./engine";

/**
 * Screening gate — what stands between a harvested candidate and real money.
 *
 * `engine.ts` answers "how did this pattern do?". This module answers the only
 * question that matters once there are HUNDREDS of candidates: "is this result
 * distinguishable from luck, given how many things we tried?"
 *
 * ── Why the existing IS/OOS split is not enough at volume ───────────────────
 *
 * A single train/test split is a fair guard for 20 hand-written patterns
 * (decision #63). It is not a guard at all for 300 harvested ones. Test 300
 * strategies against one history and dozens will clear any fixed out-of-sample
 * threshold on chance alone — and they then carry the specific false authority
 * of having "passed out-of-sample". Selecting the best of many IS the bias;
 * measuring each one more carefully does not remove it.
 *
 * Two independent defences are applied here, because they catch different
 * failures:
 *
 *   1. CONSISTENCY ACROSS WINDOWS (`runSegmented`). A pattern that made all its
 *      money in one window and bled in the other five is one lucky regime, not
 *      an edge. Aggregate performance hides this; per-window results cannot.
 *
 *   2. MULTIPLICITY CONTROL (`screen`). The pass threshold is adjusted for how
 *      many candidates were tested, so testing more does not mechanically
 *      produce more winners. The tested-count is recorded in the result and is
 *      not optional — a screen whose N is unknown is uninterpretable.
 *
 * ── An honest naming note ──────────────────────────────────────────────────
 *
 * This is NOT classic walk-forward optimisation. That fits parameters in each
 * in-sample window and tests them out-of-sample; a `PatternDef` has fixed
 * parameters and nothing is fitted per window. What `runSegmented` does is
 * contiguous out-of-sample segmentation — every window is out-of-sample,
 * because no window was ever used to choose anything.
 *
 * That distinction matters: the overfitting risk here does not come from tuning
 * a pattern's parameters, it comes from CHOOSING among many patterns. So the
 * multiplicity control in `screen` is doing the heavy lifting, and the windows
 * are there to catch regime-dependence.
 */

/* ==========================================================================
   DETERMINISTIC RNG
   ========================================================================== */

/**
 * mulberry32 — small, fast, and crucially SEEDED.
 *
 * A bootstrap that used Math.random would give a different p-value on every
 * run, so the same pattern could pass or fail the gate depending on the day.
 * Screening decisions have to be reproducible.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ==========================================================================
   SEGMENTATION
   ========================================================================== */

export type WindowResult = {
  index: number;
  startTime: number;
  endTime: number;
  bars: number;
  stats: Stats;
};

export type SegmentedResult = {
  slug: string;
  instrument: string;
  windows: WindowResult[];
  /** Windows that produced at least one trade. Windows with none say nothing. */
  windowsWithTrades: number;
  /** Of those, how many finished positive in R. */
  windowsPositive: number;
  /**
   * windowsPositive / windowsWithTrades, or 0 when nothing traded.
   *
   * This is the number to look at first. A pattern at 0.9 total R spread evenly
   * across six windows is far more interesting than one at 3.0 R earned
   * entirely in window two.
   */
  consistency: number;
  /** All trades from all windows, pooled. */
  pooled: Stats;
  /** The pooled trades themselves, so significance need not re-run the backtest. */
  trades: BacktestTrade[];
};

/**
 * Split bars into `windows` contiguous segments and backtest each separately.
 *
 * Trades are attributed to the window containing their ENTRY, and each window
 * is simulated over its own bars only, so a trade cannot straddle a boundary
 * and be counted twice. The cost of that choice: a trade still open at a
 * window's end exits as "end-of-data" rather than running to its real
 * conclusion. With six windows over several years that affects a handful of
 * trades and biases nothing systematically in either direction.
 */
export function runSegmented(
  pattern: PatternDef,
  bars: Bar[],
  instrument: string,
  opts: { windows?: number; costs?: Costs } = {},
): SegmentedResult {
  const count = Math.max(1, opts.windows ?? 6);
  const results: WindowResult[] = [];
  const allTrades: BacktestTrade[] = [];

  const size = Math.floor(bars.length / count);

  for (let w = 0; w < count; w++) {
    const from = w * size;
    // The final window absorbs the remainder so no bars are silently dropped.
    const to = w === count - 1 ? bars.length : (w + 1) * size;
    const slice = bars.slice(from, to);

    if (slice.length < 2) {
      results.push({
        index: w,
        startTime: slice[0]?.time ?? 0,
        endTime: slice[slice.length - 1]?.time ?? 0,
        bars: slice.length,
        stats: computeStats([]),
      });
      continue;
    }

    // outOfSampleFraction 0 — the split inside the engine is meaningless here,
    // because the whole window is already out-of-sample.
    const r = backtest(pattern, slice, instrument, {
      costs: opts.costs,
      outOfSampleFraction: 0,
    });

    allTrades.push(...r.trades);
    results.push({
      index: w,
      startTime: slice[0].time,
      endTime: slice[slice.length - 1].time,
      bars: slice.length,
      stats: r.stats,
    });
  }

  const withTrades = results.filter((r) => r.stats.trades > 0);
  const positive = withTrades.filter((r) => r.stats.totalR > 0);

  return {
    slug: pattern.slug,
    instrument,
    windows: results,
    windowsWithTrades: withTrades.length,
    windowsPositive: positive.length,
    consistency: withTrades.length > 0 ? positive.length / withTrades.length : 0,
    pooled: computeStats(allTrades),
    trades: allTrades,
  };
}

/* ==========================================================================
   SIGNIFICANCE
   ========================================================================== */

export type Significance = {
  trades: number;
  meanR: number;
  /** One-sided: P(mean R this good or better | the pattern has no edge). */
  pValue: number;
  iterations: number;
};

/**
 * Bootstrap test that mean R > 0.
 *
 * The sample is CENTRED first — the observed mean is subtracted so the
 * resampled population has a true mean of zero. Resampling then simulates "what
 * would a pattern with no edge but this exact trade-shape produce?", and the
 * p-value is the fraction of those null runs that matched or beat what we
 * actually saw.
 *
 * Centring is the whole test. Resampling the uncentred sample would just
 * rediscover the observed mean and always return p ≈ 0.5.
 *
 * Why bootstrap rather than a t-test: R distributions are severely non-normal.
 * A pattern with a 2R target and a hard stop produces a two-spike distribution,
 * and small samples of it break the t-test's assumptions in the direction that
 * flatters the strategy.
 */
export function bootstrapPValue(
  trades: BacktestTrade[],
  opts: { iterations?: number; seed?: number } = {},
): Significance {
  const iterations = opts.iterations ?? 10_000;
  const rs = trades.map((t) => t.r);
  const n = rs.length;

  if (n === 0) return { trades: 0, meanR: 0, pValue: 1, iterations: 0 };

  const mean = rs.reduce((s, r) => s + r, 0) / n;
  if (mean <= 0) return { trades: n, meanR: mean, pValue: 1, iterations: 0 };

  const centred = rs.map((r) => r - mean);
  const next = rng(opts.seed ?? 1);

  let atLeastAsGood = 0;
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += centred[(next() * n) | 0];
    if (sum / n >= mean) atLeastAsGood++;
  }

  // (x+1)/(N+1) rather than x/N: a bootstrap can never justify p = 0, and an
  // exact zero would sail through any threshold unchallenged.
  return {
    trades: n,
    meanR: mean,
    pValue: (atLeastAsGood + 1) / (iterations + 1),
    iterations,
  };
}

/* ==========================================================================
   MULTIPLICITY CONTROL
   ========================================================================== */

/**
 * Benjamini–Hochberg step-up q-values.
 *
 * Controls the false discovery rate: with q = 0.10, roughly 10% of whatever
 * passes is expected to be noise. Bonferroni would control the stricter
 * family-wise error rate, but at 300 candidates it is so conservative that a
 * genuine edge would never clear it — and a screen that can only ever return
 * nothing is not a screen.
 *
 * Returned q-values are monotone: enforced by the running minimum in the
 * reverse pass, without which a candidate could show a q lower than a
 * better-ranked one.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];

  const order = pValues
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p - b.p);

  const q = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    const raw = (order[k].p * m) / (k + 1);
    running = Math.min(running, raw);
    q[order[k].i] = Math.min(1, running);
  }
  return q;
}

/* ==========================================================================
   THE GATE
   ========================================================================== */

export type Candidate = {
  pattern: PatternDef;
  bars: Bar[];
  instrument: string;
};

export type Verdict = {
  slug: string;
  instrument: string;
  segmented: SegmentedResult;
  significance: Significance;
  /** BH-adjusted, accounting for every candidate in the same screen. */
  qValue: number;
  passed: boolean;
  /** Why it failed, or why it passed. Always populated. */
  reason: string;
};

export type GateCriteria = {
  /** Minimum pooled trades. Below this nothing is measurable. */
  minTrades: number;
  /** Minimum fraction of trading windows that must be positive. */
  minConsistency: number;
  /** Minimum windows that must have produced trades at all. */
  minWindowsWithTrades: number;
  /** BH false discovery rate. */
  fdr: number;
  windows: number;
  iterations: number;
  seed: number;
};

export const DEFAULT_CRITERIA: GateCriteria = {
  // 30 trades is not a lot; it is the point below which the bootstrap itself
  // stops being informative. It is a floor, not a target.
  minTrades: 30,
  // Better than two-thirds of windows positive. Deliberately blunt — the
  // purpose is to reject one-regime wonders, not to rank survivors.
  minConsistency: 0.66,
  minWindowsWithTrades: 4,
  fdr: 0.1,
  windows: 6,
  iterations: 10_000,
  seed: 1,
};

export type ScreenResult = {
  /**
   * How many candidates were tested. Recorded because the pass threshold
   * depends on it — a verdict quoted without its N is not interpretable.
   */
  testedCount: number;
  criteria: GateCriteria;
  passed: Verdict[];
  rejected: Verdict[];
  /**
   * Roughly how many of the passes are expected to be noise (fdr × passes).
   * Printed alongside the survivors so a "3 winners!" result is read as
   * "3 winners, of which ~0.3 are expected to be luck".
   */
  expectedFalsePositives: number;
};

/**
 * Screen a batch of candidates.
 *
 * Every candidate must be screened in ONE call. Screening in batches and
 * pooling the winners silently restores the multiple-comparisons problem this
 * function exists to control, because each batch's threshold would be adjusted
 * for its own size rather than the true total.
 *
 * Expect this to return an empty list most of the time. That is the function
 * working, not failing.
 */
export function screen(
  candidates: Candidate[],
  criteria: Partial<GateCriteria> = {},
): ScreenResult {
  const crit: GateCriteria = { ...DEFAULT_CRITERIA, ...criteria };

  const rows = candidates.map((c) => {
    const segmented = runSegmented(c.pattern, c.bars, c.instrument, {
      windows: crit.windows,
    });
    // Pooled trades drive significance; the windows drive consistency.
    const significance = bootstrapPValue(segmented.trades, {
      iterations: crit.iterations,
      seed: crit.seed,
    });
    return { c, segmented, significance };
  });

  const qs = benjaminiHochberg(rows.map((r) => r.significance.pValue));

  const verdicts: Verdict[] = rows.map((row, i) => {
    const { segmented, significance } = row;
    const qValue = qs[i];

    const failures: string[] = [];
    if (segmented.pooled.trades < crit.minTrades) {
      failures.push(`${segmented.pooled.trades} trades < ${crit.minTrades} minimum`);
    }
    if (segmented.windowsWithTrades < crit.minWindowsWithTrades) {
      failures.push(
        `traded in only ${segmented.windowsWithTrades}/${crit.windows} windows`,
      );
    }
    if (segmented.consistency < crit.minConsistency) {
      failures.push(
        `consistency ${segmented.consistency.toFixed(2)} < ${crit.minConsistency}`,
      );
    }
    if (qValue > crit.fdr) {
      failures.push(
        `q=${qValue.toFixed(3)} > ${crit.fdr} across ${candidates.length} tested`,
      );
    }

    return {
      slug: row.c.pattern.slug,
      instrument: row.c.instrument,
      segmented,
      significance,
      qValue,
      passed: failures.length === 0,
      reason: failures.length === 0
        ? `${segmented.pooled.trades} trades, ${segmented.windowsPositive}/${segmented.windowsWithTrades} windows positive, q=${qValue.toFixed(3)}`
        : failures.join("; "),
    };
  });

  const passed = verdicts.filter((v) => v.passed);

  return {
    testedCount: candidates.length,
    criteria: crit,
    passed,
    rejected: verdicts.filter((v) => !v.passed),
    expectedFalsePositives: passed.length * crit.fdr,
  };
}
