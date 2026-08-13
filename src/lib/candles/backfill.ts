import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { candles as candlesTable } from "@/lib/db/schema";
import { oanda } from "@/lib/oanda/client";
import type { Granularity, OandaEnvironment } from "@/lib/oanda/types";
import type { Bar } from "@/lib/indicators";
import {
  collectPages,
  resolveResumeStart,
  type PageFetcher,
  type RawCandle,
} from "./pagination";

/**
 * Bulk historical candle backfill.
 *
 * `service.ts` caches a few hundred candles around each trade. Backtesting
 * needs something different: five-plus years of continuous H1 per instrument,
 * about 30,000 bars and roughly seven OANDA requests each.
 *
 * Three properties this has to have, because it will be re-run:
 *
 * 1. IDEMPOTENT. The primary key is (instrument, granularity, time) and every
 *    insert is `onConflictDoNothing`, so a second run stores nothing twice.
 * 2. RESUMABLE. It starts from the newest stored candle, so an interrupted run
 *    costs only the pages it had not reached.
 * 3. TERMINATING. See `pagination.ts` — the cursor logic lives there so it can
 *    be tested without a database.
 *
 * Only COMPLETE candles are stored. A forming candle written to a permanent
 * store is frozen mid-formation and never corrected.
 */

export type BackfillSummary = {
  instrument: string;
  granularity: Granularity;
  /** Candles received, including incomplete ones that are then dropped. */
  fetched: number;
  /** Rows offered to the database. Conflicts are expected, not failures. */
  stored: number;
  pages: number;
  firstTime: Date | null;
  lastTime: Date | null;
  /** Where the walk actually began, after resuming from what was stored. */
  resumedFrom: Date;
  /** Nothing to do — storage was already current. */
  skipped: boolean;
  /** MAX_PAGES stopped the walk; run again to continue. */
  truncated: boolean;
};

/**
 * Backfill one instrument.
 *
 * Resumes from the newest stored candle. `force` restarts from `from`, which
 * only helps if you suspect stored data is wrong — and since inserts never
 * overwrite, correcting bad rows means deleting them first, deliberately.
 */
export async function backfillInstrument(opts: {
  instrument: string;
  granularity?: Granularity;
  from: Date;
  to?: Date;
  environment: OandaEnvironment;
  force?: boolean;
  /** Injectable for tests; defaults to the read-only OANDA client. */
  fetcher?: PageFetcher;
}): Promise<BackfillSummary> {
  const granularity = opts.granularity ?? "H1";
  const to = opts.to ?? new Date();

  // See `resolveResumeStart` — resuming from the newest stored candle is only
  // safe when storage already reaches back to `from`.
  const bounds = opts.force
    ? []
    : await db
        .select({
          oldest: sql<Date | null>`min(${candlesTable.time})`,
          newest: sql<Date | null>`max(${candlesTable.time})`,
        })
        .from(candlesTable)
        .where(
          and(
            eq(candlesTable.instrument, opts.instrument),
            eq(candlesTable.granularity, granularity),
          ),
        );

  const { start: resumedFrom } = resolveResumeStart({
    from: opts.from,
    oldest: bounds[0]?.oldest ? new Date(bounds[0].oldest) : null,
    newest: bounds[0]?.newest ? new Date(bounds[0].newest) : null,
  });

  if (resumedFrom >= to) {
    return {
      instrument: opts.instrument,
      granularity,
      fetched: 0,
      stored: 0,
      pages: 0,
      firstTime: null,
      lastTime: null,
      resumedFrom,
      skipped: true,
      truncated: false,
    };
  }

  const fetcher: PageFetcher =
    opts.fetcher ??
    (async (a) => {
      const res = await oanda(opts.environment).candles(a.instrument, {
        granularity: a.granularity,
        from: a.from,
        count: a.count,
        price: "M",
      });
      return (res.candles ?? []) as RawCandle[];
    });

  const { candles, pages, truncated } = await collectPages(fetcher, {
    instrument: opts.instrument,
    granularity,
    from: resumedFrom,
    to,
  });

  const rows: (typeof candlesTable.$inferInsert)[] = [];
  for (const c of candles) {
    if (!c.complete || !c.mid) continue;
    rows.push({
      instrument: opts.instrument,
      granularity,
      time: new Date(c.time),
      o: c.mid.o,
      h: c.mid.h,
      l: c.mid.l,
      c: c.mid.c,
      tickVolume: c.volume,
      complete: true,
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(candlesTable).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }

  return {
    instrument: opts.instrument,
    granularity,
    fetched: candles.length,
    stored: rows.length,
    pages,
    firstTime: rows.length > 0 ? (rows[0].time as Date) : null,
    lastTime: rows.length > 0 ? (rows[rows.length - 1].time as Date) : null,
    resumedFrom,
    skipped: false,
    truncated,
  };
}

/**
 * Peter's traded universe on OANDA, verified available 13 Aug 2026.
 *
 * Shares are deliberately absent: OANDA lists 123 instruments and none is an
 * equity, so shares need a separate data source (decision #75).
 */
export const BACKTEST_UNIVERSE = [
  "NAS100_USD",
  "UK100_GBP",
  "US30_USD",
  "SPX500_USD",
  "JP225_USD",
  "XAU_USD",
  "XAG_USD",
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
] as const;

/**
 * Backfill the whole universe, sequentially.
 *
 * Sequential on purpose: ten instruments in parallel is ~70 simultaneous
 * requests against the same API the live pricing stream depends on, to save a
 * couple of minutes on a job that runs rarely.
 */
export async function backfillUniverse(opts: {
  from: Date;
  to?: Date;
  environment: OandaEnvironment;
  granularity?: Granularity;
  instruments?: readonly string[];
  onProgress?: (s: BackfillSummary) => void;
}): Promise<BackfillSummary[]> {
  const out: BackfillSummary[] = [];
  for (const instrument of opts.instruments ?? BACKTEST_UNIVERSE) {
    const s = await backfillInstrument({
      instrument,
      granularity: opts.granularity,
      from: opts.from,
      to: opts.to,
      environment: opts.environment,
    });
    out.push(s);
    opts.onProgress?.(s);
  }
  return out;
}

/**
 * Read stored history back out, for the backtester.
 *
 * Reads only — never fetches. A backtest that silently hit the network would
 * give different answers depending on what happened to be cached, which is the
 * opposite of what a backtest is for. If the data is missing, backfill it and
 * know that you did.
 */
export async function getHistory(opts: {
  instrument: string;
  granularity?: Granularity;
  from?: Date;
  to?: Date;
}): Promise<Bar[]> {
  const granularity = opts.granularity ?? "H1";
  const filters = [
    eq(candlesTable.instrument, opts.instrument),
    eq(candlesTable.granularity, granularity),
  ];
  if (opts.from) filters.push(gte(candlesTable.time, opts.from));
  if (opts.to) filters.push(lte(candlesTable.time, opts.to));

  const rows = await db
    .select()
    .from(candlesTable)
    .where(and(...filters))
    .orderBy(asc(candlesTable.time));

  return rows.map((r) => ({
    time: r.time.getTime(),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.tickVolume,
  }));
}

export type Coverage = {
  instrument: string;
  granularity: string;
  bars: number;
  from: Date | null;
  to: Date | null;
};

/**
 * What is stored right now, for the backtest UI and for sanity checks.
 *
 * One aggregate query for everything. Counting by selecting the rows and
 * measuring the array would pull ~300k rows over the wire to produce ten
 * numbers.
 */
export async function historyCoverage(): Promise<Coverage[]> {
  const rows = await db
    .select({
      instrument: candlesTable.instrument,
      granularity: candlesTable.granularity,
      bars: sql<number>`count(*)::int`,
      from: sql<Date | null>`min(${candlesTable.time})`,
      to: sql<Date | null>`max(${candlesTable.time})`,
    })
    .from(candlesTable)
    .groupBy(candlesTable.instrument, candlesTable.granularity)
    .orderBy(asc(candlesTable.instrument), asc(candlesTable.granularity));

  return rows.map((r) => ({
    instrument: r.instrument,
    granularity: r.granularity,
    bars: Number(r.bars),
    from: r.from ? new Date(r.from) : null,
    to: r.to ? new Date(r.to) : null,
  }));
}
