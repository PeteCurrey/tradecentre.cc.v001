import type { Granularity } from "@/lib/oanda/types";

/**
 * Candle pagination — the cursor logic, with no database and no network.
 *
 * Deliberately separate from `backfill.ts`, which imports `server-only` and the
 * db client and therefore cannot be unit-tested in plain Node. Pagination bugs
 * are the silent kind: a dropped page looks exactly like a market holiday, and
 * a stalled cursor looks like a hang at 3am. Both deserve real tests, so the
 * logic lives where tests can reach it.
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

/** OANDA's hard per-request ceiling. Asking for more silently returns 5000. */
export const MAX_CANDLES_PER_REQUEST = 5000;

/**
 * Refuse to make more than this many requests in one walk.
 *
 * At 5000 H1 candles a page, 200 pages is over a century of history — so
 * hitting this means the cursor is broken, not that the range was large.
 */
export const MAX_PAGES = 200;

export type RawCandle = {
  time: string;
  complete: boolean;
  volume: number;
  mid?: { o: string; h: string; l: string; c: string };
};

export type PageFetcher = (opts: {
  instrument: string;
  granularity: Granularity;
  from: string;
  count: number;
}) => Promise<RawCandle[]>;

export type CollectResult = {
  candles: RawCandle[];
  pages: number;
  /** True when the walk stopped at `to` rather than running out of history. */
  reachedEnd: boolean;
  /** Set when MAX_PAGES stopped the walk — the result is incomplete. */
  truncated: boolean;
};

/**
 * Walk OANDA's pagination from `from` to `to`.
 *
 * Cursor rule: the next page starts one millisecond after the newest candle
 * received. Advancing by `lastTime + granularity` instead would skip a bar
 * whenever OANDA's bar boundaries and our arithmetic disagree — which they do
 * around DST changes and the 17:00 New York rollover.
 *
 * Termination is guaranteed three ways: an empty page, a page whose newest
 * candle does not advance the cursor, and MAX_PAGES. The middle one is the
 * important one, because that is the case that would otherwise re-request the
 * same page forever.
 *
 * A short page (fewer than `count`) is NOT treated as the end, so a complete
 * walk costs one extra empty request. That is deliberate: a short page almost
 * always means history ran out, but if it ever means anything else — a
 * throttle, a partial response — short-circuiting would silently truncate the
 * history and the backtest built on it would be quietly wrong. One wasted
 * request per instrument is a good price for not having that failure mode.
 */
export async function collectPages(
  fetch: PageFetcher,
  opts: {
    instrument: string;
    granularity: Granularity;
    from: Date;
    to: Date;
    countPerPage?: number;
  },
): Promise<CollectResult> {
  const count = Math.min(
    Math.max(1, opts.countPerPage ?? MAX_CANDLES_PER_REQUEST),
    MAX_CANDLES_PER_REQUEST,
  );
  const toMs = opts.to.getTime();

  const out: RawCandle[] = [];
  let cursor = opts.from.getTime();
  let pages = 0;
  let reachedEnd = false;

  while (true) {
    if (cursor > toMs) {
      reachedEnd = true;
      break;
    }
    if (pages >= MAX_PAGES) {
      return { candles: out, pages, reachedEnd: false, truncated: true };
    }

    const page = await fetch({
      instrument: opts.instrument,
      granularity: opts.granularity,
      from: new Date(cursor).toISOString(),
      count,
    });
    pages++;

    if (page.length === 0) break; // ran out of history

    let newest = cursor;
    let pastEnd = false;
    for (const c of page) {
      const t = Date.parse(c.time);
      if (Number.isNaN(t)) continue; // a malformed timestamp is not a reason to stop
      if (t > toMs) {
        pastEnd = true;
        continue;
      }
      out.push(c);
      if (t > newest) newest = t;
    }

    if (pastEnd) {
      reachedEnd = true;
      break;
    }

    // The guard that makes this terminate: if nothing in the page is newer than
    // where we started, asking again returns the same page.
    if (newest <= cursor) break;

    cursor = newest + 1;
  }

  return { candles: out, pages, reachedEnd, truncated: false };
}

/**
 * Where a backfill should actually start, given what is already stored.
 *
 * ⚠️ The tempting rule — "resume from the newest stored candle" — is wrong
 * whenever storage is not a contiguous prefix starting at `from`. `service.ts`
 * caches a few hundred candles around each trade, so an instrument can hold a
 * recent window and nothing else. Resuming from the newest candle then starts
 * the walk *after* that window and silently skips every year before it. The
 * backtest that follows runs on a fraction of the history and looks entirely
 * normal doing it.
 *
 * So resume only when the oldest stored candle already reaches back to `from`.
 * Otherwise restart from `from` and let the primary key absorb the overlap:
 * a few redundant requests cannot lose history, and a wrong cursor can.
 *
 * A hole in the MIDDLE of stored history is still not detected here — that
 * needs a gap scan, and the coverage table flags it as "thin" instead.
 */
export function resolveResumeStart(opts: {
  from: Date;
  oldest: Date | null;
  newest: Date | null;
}): { start: Date; resumed: boolean } {
  const { from, oldest, newest } = opts;
  if (!oldest || !newest) return { start: from, resumed: false };
  if (oldest > from) return { start: from, resumed: false }; // sparse — restart
  if (newest <= from) return { start: from, resumed: false };
  return { start: new Date(newest.getTime() + 1), resumed: true };
}

/**
 * Roughly how many bars a year of history should yield.
 *
 * For sanity-checking a backfill: FX and CFDs trade about five days in seven,
 * so a year of H1 is ~6,200 bars, not 8,760. A backfill returning far fewer
 * means gaps; far more means duplicates.
 */
export function expectedBarsPerYear(granularity: Granularity): number {
  const step = GRANULARITY_MS[granularity] ?? GRANULARITY_MS.H1;
  return Math.floor((365 * 24 * 3_600_000 * (5 / 7)) / step);
}

export { GRANULARITY_MS };
