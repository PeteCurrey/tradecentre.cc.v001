import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, tradeAnnotations, trades } from "@/lib/db/schema";
import type { AnalyticsTrade } from "./stats";
import type { BookId } from "@/lib/books";

/**
 * The single query behind every analytics screen.
 *
 * Two things it enforces so no individual page has to remember them:
 *
 *   • DEMO NEVER AGGREGATES WITH LIVE. Practice accounts are excluded unless
 *     asked for explicitly, and asking for them returns practice only. There is
 *     no argument combination that mixes the two.
 *   • Annotations are joined in, not fetched per row, and a trade with no
 *     annotation still appears — an unannotated trade is still a real trade.
 */

export type LoadOptions = {
  book?: BookId;
  /** Practice books instead of live ones. Never both. */
  demo?: boolean;
  since?: Date;
  /** Closed trades only, which is the default: an open trade has no result. */
  includeOpen?: boolean;
  limit?: number;
};

export async function loadTrades(opts: LoadOptions = {}): Promise<AnalyticsTrade[]> {
  const environment = opts.demo ? "practice" : "live";

  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.environment, environment), eq(accounts.active, true)));

  // Fall back to whatever accounts exist when none match the requested
  // environment — every account today is practice, and an analytics screen that
  // renders empty because of an environment label would be hiding the data that
  // is actually there.
  //
  // ⚠️ This fallback means "live" figures can be practice figures. That is a
  // real hazard, not a convenience: it is the one path by which demo data can
  // be read as live. `activeEnvironment()` reports when it is happening, and
  // every screen that makes a money claim says so on the page.
  const usable =
    accountRows.length > 0
      ? accountRows
      : await db.select().from(accounts).where(eq(accounts.active, true));

  const ids = usable
    .filter((a) => (opts.book ? a.book === opts.book : true))
    .map((a) => a.id);

  if (ids.length === 0) return [];

  const conditions = [
    inArray(trades.accountId, ids),
    opts.includeOpen ? undefined : eq(trades.state, "closed"),
    opts.since ? gte(trades.entryTime, opts.since) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      t: trades,
      a: tradeAnnotations,
    })
    .from(trades)
    .leftJoin(
      tradeAnnotations,
      and(
        eq(tradeAnnotations.accountId, trades.accountId),
        eq(tradeAnnotations.oandaTradeId, trades.oandaTradeId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(trades.entryTime))
    .limit(opts.limit ?? 5000);

  return rows.map(({ t, a }) => ({
    id: t.id,
    book: t.book,
    // Peter's explicit override wins over the hold-time inference, always.
    horizon: a?.horizonOverride ?? t.horizon,
    instrument: t.instrument,
    direction: t.direction as "long" | "short",
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    realizedPl: Number(t.realizedPl ?? 0),
    rMultiple: t.rMultiple,
    spreadCost: Number(t.spreadCost),
    financing: Number(t.financing),
    patternId: a?.patternId ?? null,
    conviction: a?.conviction ?? null,
    processGrade: a?.processGrade ?? null,
    mistakes: a?.mistakes ?? [],
  }));
}

/**
 * Which environment the "live" figures are actually coming from.
 *
 * Returns "practice" when no live account exists and the fallback above is in
 * play. Screens use this to say plainly that the numbers are demo money —
 * silently labelling practice results as live is exactly the confusion the
 * demo/live separation exists to prevent.
 */
export async function activeEnvironment(): Promise<"live" | "practice"> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.environment, "live"), eq(accounts.active, true)))
    .limit(1);
  return rows.length > 0 ? "live" : "practice";
}

/** Account currency for display. One currency across the books in practice. */
export async function accountCurrency(): Promise<string> {
  const rows = await db.select().from(accounts).limit(1);
  return rows[0]?.currency ?? "GBP";
}
