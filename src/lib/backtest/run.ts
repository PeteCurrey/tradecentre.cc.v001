import "server-only";
import { oanda } from "@/lib/oanda/client";
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

/** Bars per timeframe. OANDA caps a single request at 5,000. */
const DEPTH: Record<string, number> = {
  M5: 25_000,
  M15: 25_000,
  H1: 30_000,
  H4: 8_000,
  D: 4_000,
};

/**
 * Process-lifetime bar cache.
 *
 * Paging 30,000 H1 bars takes six round trips, and a screening session runs
 * many patterns over the same instrument. Cached only for the life of the
 * process: this is a read-through convenience, never a store of record.
 */
const cache = new Map<string, Bar[]>();

export async function fetchBars(
  instrument: string,
  granularity: string,
): Promise<Bar[]> {
  const key = `${instrument}:${granularity}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const want = DEPTH[granularity] ?? 5_000;
  const client = oanda("practice");
  const out: Bar[] = [];
  let to: string | undefined;

  // Page backwards from now until there is enough history.
  while (out.length < want) {
    const count = Math.min(5_000, want - out.length);
    const res = await client.candles(instrument, {
      granularity: granularity as never,
      count,
      to,
      price: "M",
    });

    const page = (res.candles ?? [])
      .filter((c) => c.complete && c.mid)
      .map((c) => ({
        time: Date.parse(c.time),
        o: Number(c.mid!.o),
        h: Number(c.mid!.h),
        l: Number(c.mid!.l),
        c: Number(c.mid!.c),
        v: c.volume,
      }));

    if (page.length === 0) break;
    out.unshift(...page);
    to = new Date(page[0].time).toISOString();
    // OANDA returned less than asked for: history is exhausted.
    if (page.length < count) break;
  }

  cache.set(key, out);
  return out;
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
          `${instrument} ${tf}: only ${bars.length} bars — too little to segment`,
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
