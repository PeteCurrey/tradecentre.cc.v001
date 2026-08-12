import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { candles as candlesTable } from "@/lib/db/schema";
import { oanda } from "@/lib/oanda/client";
import type { Granularity, OandaEnvironment } from "@/lib/oanda/types";
import type { Bar } from "@/lib/indicators";

/**
 * Candle windows for trade charts.
 *
 * Cached permanently, on purpose: this is what makes the journal durable. A
 * chart from three years ago renders instantly and identically regardless of
 * OANDA's history retention or any later data revision. Storage is trivial at
 * a few hundred candles per trade.
 */

const GRANULARITY_MS: Record<string, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D: 86_400_000,
};

/**
 * Choose a granularity giving roughly 60–200 candles across the hold, so a
 * three-minute scalp and a six-week position both produce a readable chart.
 */
export function granularityForDuration(durationMs: number): Granularity {
  const target = durationMs / 80; // aim for ~80 bars across the trade itself
  const options: Granularity[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D"];
  for (const g of options) {
    if (GRANULARITY_MS[g] >= target) return g;
  }
  return "D";
}

/** Context bars either side of the trade, so the setup is visible. */
const CONTEXT_BARS = 60;

export type TradeChartWindow = {
  bars: Bar[];
  granularity: Granularity;
  fromCache: boolean;
};

export async function getTradeCandles(opts: {
  instrument: string;
  entryTime: Date;
  exitTime: Date | null;
  environment: OandaEnvironment;
}): Promise<TradeChartWindow> {
  const { instrument, entryTime, environment } = opts;
  const exitTime = opts.exitTime ?? new Date();

  const duration = Math.max(60_000, exitTime.getTime() - entryTime.getTime());
  const granularity = granularityForDuration(duration);
  const step = GRANULARITY_MS[granularity];

  const from = new Date(entryTime.getTime() - CONTEXT_BARS * step);
  const to = new Date(exitTime.getTime() + CONTEXT_BARS * step);

  // Cache first. A stored window is authoritative — never re-fetched, so the
  // chart cannot change under a trade you have already reviewed.
  const cached = await db
    .select()
    .from(candlesTable)
    .where(
      and(
        eq(candlesTable.instrument, instrument),
        eq(candlesTable.granularity, granularity),
        gte(candlesTable.time, from),
        lte(candlesTable.time, to),
      ),
    )
    .orderBy(asc(candlesTable.time));

  const expected = Math.floor((to.getTime() - from.getTime()) / step);
  // Weekends and holidays mean we never get a full grid; 40% is a reasonable
  // threshold for "this window is already stored".
  if (cached.length > 0 && cached.length >= expected * 0.4) {
    return {
      bars: cached.map(rowToBar),
      granularity,
      fromCache: true,
    };
  }

  const res = await oanda(environment).candles(instrument, {
    granularity,
    from: from.toISOString(),
    to: to.toISOString(),
    price: "M",
  });

  const bars: Bar[] = [];
  const rows: (typeof candlesTable.$inferInsert)[] = [];

  for (const c of res.candles ?? []) {
    if (!c.mid) continue;
    const time = new Date(c.time);
    bars.push({
      time: time.getTime(),
      o: Number(c.mid.o),
      h: Number(c.mid.h),
      l: Number(c.mid.l),
      c: Number(c.mid.c),
      v: c.volume,
    });
    // Only complete candles are stored; a forming candle would be frozen
    // mid-formation and never corrected.
    if (c.complete) {
      rows.push({
        instrument,
        granularity,
        time,
        o: c.mid.o,
        h: c.mid.h,
        l: c.mid.l,
        c: c.mid.c,
        tickVolume: c.volume,
        complete: true,
      });
    }
  }

  if (rows.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(candlesTable)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing();
    }
  }

  return { bars, granularity, fromCache: false };
}

function rowToBar(r: typeof candlesTable.$inferSelect): Bar {
  return {
    time: r.time.getTime(),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.tickVolume,
  };
}

/**
 * Maximum adverse and favourable excursion, in R.
 *
 * Deliberately computed from candles rather than stored at sync time: OANDA's
 * transaction ledger records fills, not the path between them, so MAE/MFE
 * simply are not derivable from the ledger alone.
 */
export function excursions(
  bars: Bar[],
  opts: {
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    direction: "long" | "short";
    risk: number;
  },
): { maeR: number; mfeR: number } {
  if (opts.risk <= 0) return { maeR: 0, mfeR: 0 };
  let mae = 0;
  let mfe = 0;
  for (const b of bars) {
    if (b.time < opts.entryTime || b.time > opts.exitTime) continue;
    const favourable =
      opts.direction === "long" ? b.h - opts.entryPrice : opts.entryPrice - b.l;
    const adverse =
      opts.direction === "long" ? opts.entryPrice - b.l : b.h - opts.entryPrice;
    mfe = Math.max(mfe, favourable / opts.risk);
    mae = Math.max(mae, adverse / opts.risk);
  }
  return { maeR: mae, mfeR: mfe };
}
