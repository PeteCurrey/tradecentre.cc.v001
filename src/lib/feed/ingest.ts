import "server-only";
import { and, gte, lte, lt, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedItems, macroEvents } from "@/lib/db/schema";
import { resolve } from "./resolve";
import {
  fetchFedReleases,
  fetchFinnhubNews,
  fetchPolygonNews,
  fetchSecFilings,
  type FeedItem,
} from "./sources";

/**
 * Ingest — pull every source, dedupe, write, prune.
 *
 * Idempotent by construction: ids are deterministic per source, so running this
 * twice a minute updates rows rather than growing the table. That matters more
 * here than on the macro calendar, because this runs on a timer rather than on
 * a button.
 */

/** Items older than this are dropped on each ingest. */
const RETENTION_DAYS = 30;

/**
 * How far ahead a scheduled release becomes "imminent" and enters the stream.
 *
 * An hour is the point at which a release starts affecting what you should be
 * doing — it is when you stop opening new risk into it.
 */
const IMMINENT_MS = 60 * 60_000;

/**
 * Project the macro calendar into the stream.
 *
 * `macro_events` is not re-fetched here; it is the calendar's job to populate
 * that table and this only reads it. The projection exists so that "CPI in 40
 * minutes" appears in the same column you are already watching, rather than on
 * a screen you have to remember to check.
 *
 * ⚠️ Only UPCOMING releases are projected, never "released" ones. Our sources
 * carry release dates but no actual figures, so an item saying CPI had been
 * released would imply a number we do not have. The wire's own coverage is
 * what reports the print.
 */
async function projectMacro(now: Date): Promise<FeedItem[]> {
  const rows = await db
    .select()
    .from(macroEvents)
    .where(
      and(
        // Already imminent…
        lte(macroEvents.time, new Date(now.getTime() + IMMINENT_MS)),
        // …but not so long past that it is stale news.
        gte(macroEvents.time, new Date(now.getTime() - 12 * 3600_000)),
      ),
    )
    .orderBy(desc(macroEvents.time))
    .limit(40);

  return rows
    .filter((e) => e.source !== "polymarket")
    .map((e) => {
      const res = resolve(e.title);
      return {
        id: `macro:${e.id}`,
        source: "macro" as const,
        category: "economic" as const,
        // Placed at the moment it became imminent, so it sits in correct
        // chronological position rather than pinned to the top as a future
        // timestamp would be.
        publishedAt: new Date(e.time.getTime() - IMMINENT_MS),
        headline: e.title,
        summary: e.country ? `Scheduled release · ${e.country}` : "Scheduled release",
        url: null,
        // A calendar entry is our own row, not a published story.
        imageUrl: null,
        tickers: [],
        instruments: res.instruments,
        importance: e.importance,
      };
    });
}

/**
 * Two providers routinely carry the same wire story under different ids.
 *
 * Deduped on a normalised headline: lowercased, punctuation stripped, collapsed
 * whitespace. Not clever, but it catches the common case — the same Reuters
 * copy syndicated twice — without risking merging two genuinely different
 * stories that happen to share a few words.
 */
function normalise(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Map<string, FeedItem>();
  for (const item of items) {
    const key = normalise(item.headline);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    // Keep the earlier one — whoever carried it first is the better timestamp —
    // but merge the tags, since one provider often has symbols the other lacks.
    const keep = item.publishedAt < existing.publishedAt ? item : existing;
    const drop = keep === item ? existing : item;
    seen.set(key, {
      ...keep,
      tickers: [...new Set([...keep.tickers, ...drop.tickers])],
      instruments: [...new Set([...keep.instruments, ...drop.instruments])].sort(),
      importance: Math.max(keep.importance ?? 0, drop.importance ?? 0) || null,
    });
  }
  return [...seen.values()];
}

export type IngestResult = {
  fetched: number;
  written: number;
  pruned: number;
  errors: string[];
};

export async function ingestFeed(): Promise<IngestResult> {
  const now = new Date();

  // Parallel, and each already fails soft — one provider down costs its own
  // items and an error line, nothing more.
  const [polygon, finnhub, fed, sec, macro] = await Promise.all([
    fetchPolygonNews(),
    fetchFinnhubNews(),
    fetchFedReleases(),
    fetchSecFilings(),
    projectMacro(now).catch(() => [] as FeedItem[]),
  ]);

  const raw = [
    ...polygon.items,
    ...finnhub.items,
    ...fed.items,
    ...sec.items,
    ...macro,
  ];
  const errors = [
    ...polygon.errors,
    ...finnhub.errors,
    ...fed.errors,
    ...sec.errors,
  ];

  const items = dedupe(raw);

  for (const item of items) {
    await db
      .insert(feedItems)
      .values({
        id: item.id,
        source: item.source,
        category: item.category,
        publishedAt: item.publishedAt,
        headline: item.headline,
        summary: item.summary,
        url: item.url,
        imageUrl: item.imageUrl,
        tickers: item.tickers,
        instruments: item.instruments,
        importance: item.importance,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: feedItems.id,
        set: {
          // publishedAt is deliberately NOT updated: a story's moment is fixed,
          // and letting it drift would reshuffle a feed whose whole contract is
          // that it does not reshuffle.
          headline: item.headline,
          summary: item.summary,
          imageUrl: item.imageUrl,
          tickers: item.tickers,
          instruments: item.instruments,
          importance: item.importance,
          fetchedAt: now,
        },
      });
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const pruned = await db
    .delete(feedItems)
    .where(lt(feedItems.publishedAt, cutoff))
    .returning({ id: feedItems.id });

  return {
    fetched: raw.length,
    written: items.length,
    pruned: pruned.length,
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export type FeedQuery = {
  limit?: number;
  sources?: string[];
  categories?: string[];
  /** Narrow to items touching any of these OANDA instruments. */
  instruments?: string[];
  /**
   * Only items that resolve to an instrument, or that are central-bank or
   * economic. The Today panel's default.
   *
   * Measured on a live pull of all four sources: of 213 items, 122 carried
   * neither a tag nor an importance, and the newest 40 contained just 4 tagged
   * items and none at top importance — twenty were SEC insider filings and
   * seventeen were retail equity commentary. Strict chronology on that mix
   * gives a panel that is ~90% irrelevant to an FX, indices and commodities
   * book, with the Fed and macro items pushed below the fold by age alone.
   *
   * This is a FILTER, not a ranking: it changes what is shown, never the
   * order, and `/wire` remains complete. That distinction is the whole reason
   * the feed can be trusted — see the ordering contract in Wire.tsx.
   */
  relevantOnly?: boolean;
};

/**
 * Read the stream.
 *
 * Always ordered `published_at desc`, unconditionally. Filters narrow what is
 * shown; nothing reorders it. That is the property that lets absence from the
 * feed mean something.
 */
export async function readFeed(q: FeedQuery = {}) {
  const conditions = [];

  if (q.sources?.length) {
    conditions.push(sql`${feedItems.source} = ANY(${q.sources})`);
  }
  if (q.categories?.length) {
    conditions.push(sql`${feedItems.category} = ANY(${q.categories})`);
  }
  if (q.instruments?.length) {
    // Array overlap: the item touches at least one instrument asked for.
    conditions.push(sql`${feedItems.instruments} && ${q.instruments}`);
  }
  if (q.relevantOnly) {
    conditions.push(
      sql`(cardinality(${feedItems.instruments}) > 0
           or ${feedItems.category} in ('central_bank', 'economic'))`,
    );
  }

  return db
    .select()
    .from(feedItems)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(feedItems.publishedAt))
    .limit(q.limit ?? 100);
}
