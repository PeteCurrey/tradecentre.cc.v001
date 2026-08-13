"use server";

import { requireSession } from "@/lib/auth/guard";
import { getHistory } from "@/lib/candles/backfill";
import { screen, type Candidate } from "@/lib/backtest/gate";
import { SEED_PATTERNS } from "@/lib/patterns/seed";
import type { Granularity } from "@/lib/oanda/types";

/**
 * Run the whole pattern library for one instrument through the screening gate.
 *
 * Everything is screened in a SINGLE `screen()` call, deliberately. Screening in
 * batches and pooling the winners would adjust each batch's threshold for its
 * own size rather than the true total, which quietly restores the
 * multiple-comparisons problem the gate exists to control.
 */

export type ScreenRow = {
  slug: string;
  name: string;
  timeframe: string;
  direction: string;
  passed: boolean;
  reason: string;
  trades: number;
  totalR: number;
  avgR: number;
  winRate: number;
  maxDrawdownR: number;
  windowsPositive: number;
  windowsWithTrades: number;
  pValue: number;
  qValue: number;
  windows: Array<{ index: number; trades: number; totalR: number }>;
};

export type ScreenState = {
  ok: boolean;
  message: string;
  instrument?: string;
  granularity?: string;
  bars?: number;
  from?: string;
  to?: string;
  testedCount?: number;
  expectedFalsePositives?: number;
  rows?: ScreenRow[];
};

export async function runScreenAction(
  _prev: ScreenState,
  formData: FormData,
): Promise<ScreenState> {
  await requireSession();

  const instrument = String(formData.get("instrument") ?? "");
  const granularity = String(formData.get("granularity") ?? "H1") as Granularity;

  if (!instrument) return { ok: false, message: "Choose an instrument." };

  const bars = await getHistory({ instrument, granularity });

  // No fabrication: if the history isn't stored, say so rather than screening
  // a handful of bars and presenting the result as if it meant something.
  if (bars.length < 500) {
    return {
      ok: false,
      message:
        `Only ${bars.length} ${granularity} bars stored for ${instrument}. ` +
        `Backfill this instrument and granularity before screening.`,
    };
  }

  // A pattern declares the granularity its trigger is defined on. Running an M5
  // pattern against H1 bars would silently evaluate a different strategy.
  const applicable = SEED_PATTERNS.filter((p) => p.timeframe === granularity);
  if (applicable.length === 0) {
    return {
      ok: false,
      message:
        `No patterns in the library are defined on ${granularity}. ` +
        `Library timeframes: ${[...new Set(SEED_PATTERNS.map((p) => p.timeframe))].sort().join(", ")}.`,
    };
  }

  const candidates: Candidate[] = applicable.map((pattern) => ({
    pattern,
    bars,
    instrument,
  }));

  const result = screen(candidates);

  const rows: ScreenRow[] = [...result.passed, ...result.rejected]
    .map((v) => {
      const def = applicable.find((p) => p.slug === v.slug)!;
      return {
        slug: v.slug,
        name: def.name,
        timeframe: def.timeframe,
        direction: def.direction,
        passed: v.passed,
        reason: v.reason,
        trades: v.segmented.pooled.trades,
        totalR: v.segmented.pooled.totalR,
        avgR: v.segmented.pooled.avgR,
        winRate: v.segmented.pooled.winRate,
        maxDrawdownR: v.segmented.pooled.maxDrawdownR,
        windowsPositive: v.segmented.windowsPositive,
        windowsWithTrades: v.segmented.windowsWithTrades,
        pValue: v.significance.pValue,
        qValue: v.qValue,
        windows: v.segmented.windows.map((w) => ({
          index: w.index,
          trades: w.stats.trades,
          totalR: w.stats.totalR,
        })),
      };
    })
    // Survivors first, then by total R — but the ordering is presentational
    // only. A high total R that failed the gate is still a failure.
    .sort((a, b) => Number(b.passed) - Number(a.passed) || b.totalR - a.totalR);

  return {
    ok: true,
    message: `Screened ${result.testedCount} patterns on ${bars.length.toLocaleString()} bars.`,
    instrument,
    granularity,
    bars: bars.length,
    from: new Date(bars[0].time).toISOString().slice(0, 10),
    to: new Date(bars[bars.length - 1].time).toISOString().slice(0, 10),
    testedCount: result.testedCount,
    expectedFalsePositives: result.expectedFalsePositives,
    rows,
  };
}
