import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedItems } from "@/lib/db/schema";
import { hasSession } from "@/lib/auth/guard";
import { ingestFeed, readFeed } from "@/lib/feed/ingest";

/**
 * The wire's polling endpoint.
 *
 * ── Why polling rather than the SSE hub ────────────────────────────────────
 * `lib/stream/hub.ts` exists and pushes over SSE, but it is a price-tick hub
 * bound to the OANDA streaming connection's lifecycle. Putting news through it
 * would make the feed depend on the broker socket being up — so a weekend, when
 * OANDA's stream is closed and there is time to actually read, is exactly when
 * the news would stop arriving. At a 60-second cadence polling costs nothing
 * and keeps the two independent.
 *
 * ── Ingest is triggered by staleness, not by a scheduler ───────────────────
 * The first request after the data goes stale pulls the sources. That means no
 * cron to deploy and no work done while nobody is looking at the screen, which
 * suits a dashboard that is either open all day or closed entirely.
 *
 * The refresh is fire-and-forget: the caller gets whatever is stored right now
 * rather than waiting on four providers. SEC alone takes ~10s, and a feed that
 * stalls for ten seconds every few minutes is worse than one a minute behind.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 60_000;

/** Guards against a burst of requests each kicking off its own ingest. */
let inFlight: Promise<unknown> | null = null;

async function refreshIfStale(): Promise<boolean> {
  if (inFlight) return false;

  const [newest] = await db
    .select({ fetchedAt: feedItems.fetchedAt })
    .from(feedItems)
    .orderBy(desc(feedItems.fetchedAt))
    .limit(1);

  const age = newest ? Date.now() - newest.fetchedAt.getTime() : Infinity;
  if (age < STALE_MS) return false;

  inFlight = ingestFeed()
    .catch(() => {
      // Swallowed on purpose: a provider outage must not turn into a 500 on a
      // read. The errors are reported through the refresh action instead,
      // where someone actually asked for them.
    })
    .finally(() => {
      inFlight = null;
    });

  return true;
}

function list(param: string | null): string[] | undefined {
  const parts = param?.split(",").map((s) => s.trim()).filter(Boolean);
  return parts?.length ? parts : undefined;
}

export async function GET(request: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const refreshing = await refreshIfStale();

  const items = await readFeed({
    limit: Math.min(Number(url.searchParams.get("limit")) || 100, 200),
    sources: list(url.searchParams.get("sources")),
    categories: list(url.searchParams.get("categories")),
    instruments: list(url.searchParams.get("instruments")),
    relevantOnly: url.searchParams.get("relevant") === "1",
  });

  const [{ newest } = { newest: null }] = await db
    .select({ newest: sql<Date | null>`max(${feedItems.fetchedAt})` })
    .from(feedItems);

  return Response.json({
    items,
    refreshing,
    fetchedAt: newest,
  });
}
