import "server-only";
import { getHistory } from "@/lib/candles/backfill";
import type { Granularity } from "@/lib/oanda/types";
import { SEED_PATTERNS } from "@/lib/patterns/seed";
import type { PatternDef } from "@/lib/patterns/dsl";
import type { Bar } from "@/lib/indicators";
import { screen, type GateCriteria, type ScreenResult } from "./gate";

/**
 * Running the gate as a project feature rather than a test-suite capability.
 *
 * The one rule that makes the numbers mean anything: EVERY candidate goes
 * through a SINGLE `screen()` call. Screening in batches and pooling the
 * winners silently restores the multiple-comparisons problem the gate exists to
 * control, because each batch's threshold would be adjusted for its own size
 * instead of the true total. The UI therefore has no "screen just this one"
 * button that pools with earlier runs — a run is a run, with its own N.
 */

/**
 * Process-lifetime bar cache.
 *
 * A screening session runs many patterns over the same instrument and
 * granularity. Cached only for the life of the process: this is a read-through
 * convenience, never a store of record.
 */
const cache = new Map<string, Bar[]>();

/**
 * Bars for a screen — read from the backfilled `candles` table, never fetched.
 *
 * ⚠️ This deliberately does NOT call OANDA. An earlier version paged the API
 * live on each process, which meant the same screen could return different
 * numbers depending on when it ran and what the process had already cached —
 * and could not be reproduced offline or after the fact. A backtest whose
 * inputs move is not a backtest.
 *
 * The consequence is that missing history is an ERROR rather than something
 * silently papered over by a network call. Backfill it (`backfillUniverse`) and
 * know that you did.
 */
export async function fetchBars(
  instrument: string,
  granularity: string,
): Promise<Bar[]> {
  const key = `${instrument}:${granularity}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const bars = await getHistory({
    instrument,
    granularity: granularity as Granularity,
  });

  cache.set(key, bars);
  return bars;
}

export type ScreenRequest = {
  instruments: string[];
  /** Slugs to include. Empty means every seed pattern. */
  slugs?: string[];
  criteria?: Partial<GateCriteria>;
};

export type ScreenRun = {
  result: ScreenResult;
  /** Bars actually obtained per instrument, so a thin history is visible. */
  history: Array<{ instrument: string; granularity: string; bars: number; from: string | null }>;
  ranAt: string;
  durationMs: number;
  errors: string[];
};

export async function runScreen(req: ScreenRequest): Promise<ScreenRun> {
  const started = Date.now();
  const errors: string[] = [];

  const wanted: PatternDef[] = req.slugs?.length
    ? SEED_PATTERNS.filter((p) => req.slugs!.includes(p.slug))
    : SEED_PATTERNS;

  const history: ScreenRun["history"] = [];
  const candidates: Array<{ pattern: PatternDef; bars: Bar[]; instrument: string }> = [];

  for (const instrument of req.instruments) {
    // Group by timeframe so each instrument/granularity pair is fetched once.
    const timeframes = [...new Set(wanted.map((p) => p.timeframe))];

    for (const tf of timeframes) {
      let bars: Bar[];
      try {
        bars = await fetchBars(instrument, tf);
      } catch (e) {
        errors.push(`${instrument} ${tf}: ${(e as Error).message}`);
        continue;
      }

      history.push({
        instrument,
        granularity: tf,
        bars: bars.length,
        from: bars.length ? new Date(bars[0].time).toISOString() : null,
      });

      // Too little history to segment into windows at all. Skipping is the
      // honest outcome — a six-window split of 400 bars measures nothing.
      if (bars.length < 1_000) {
        errors.push(
          bars.length === 0
            ? `${instrument} ${tf}: no history stored — backfill this instrument and granularity`
            : `${instrument} ${tf}: only ${bars.length} bars — too little to segment`,
        );
        continue;
      }

      for (const pattern of wanted.filter((p) => p.timeframe === tf)) {
        candidates.push({ pattern, bars, instrument });
      }
    }
  }

  const result = screen(candidates, req.criteria);

  return {
    result,
    history,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    errors,
  };
}

/** The seed library, for the picker. */
export function seedPatterns(): Array<{
  slug: string;
  name: string;
  horizon: string;
  family: string;
  timeframe: string;
  instrumentClasses: string[];
}> {
  return SEED_PATTERNS.map((p) => ({
    slug: p.slug,
    name: p.name,
    horizon: p.horizon,
    family: p.family,
    timeframe: p.timeframe,
    instrumentClasses: p.instrumentClasses,
  }));
}
