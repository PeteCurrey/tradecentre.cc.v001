import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, transactionsRaw } from "@/lib/db/schema";
import { oanda } from "./client";
import type { OandaEnvironment, Transaction } from "./types";

/**
 * Ledger sync.
 *
 * `transactions_raw` is the source of truth for everything downstream, so this
 * stores OANDA's payloads verbatim and derives nothing. Two properties matter:
 *
 *   • IDEMPOTENT — re-running inserts nothing new. Conflicts on (account, id)
 *     are ignored rather than updated, so a stored payload is never rewritten.
 *   • RESUMABLE — progress is tracked per account by last transaction id, so a
 *     sync interrupted halfway resumes rather than refetching from zero.
 */

export type SyncResult = {
  accountId: string;
  fetched: number;
  inserted: number;
  fromId: string;
  toId: string;
  pages: number;
};

/** OANDA caps each response; loop until the account's latest id is reached. */
const MAX_PAGES = 200;

export async function syncAccount(
  accountId: string,
  environment: OandaEnvironment,
  opts: { fromScratch?: boolean } = {},
): Promise<SyncResult> {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  const startId = opts.fromScratch ? "0" : (account?.lastSyncedTransactionId ?? "0");
  const client = oanda(environment);

  let since = startId;
  let fetched = 0;
  let inserted = 0;
  let pages = 0;
  let latestSeen = startId;

  while (pages < MAX_PAGES) {
    const page = await client.transactionsSince(accountId, since);
    const tx = page.transactions ?? [];
    pages++;

    if (tx.length === 0) {
      // Nothing new. `lastTransactionID` still advances on OANDA's side for
      // non-account events, so trust it rather than our own high-water mark.
      latestSeen = maxId(latestSeen, page.lastTransactionID);
      break;
    }

    inserted += await insertBatch(accountId, tx);
    fetched += tx.length;

    const pageMax = tx.reduce((m, t) => maxId(m, t.id), since);
    latestSeen = maxId(latestSeen, pageMax);

    // Guard against a page that fails to advance — otherwise this loops forever.
    if (pageMax === since) break;
    since = pageMax;

    if (Number(pageMax) >= Number(page.lastTransactionID)) break;
  }

  await db
    .update(accounts)
    .set({ lastSyncedTransactionId: latestSeen })
    .where(eq(accounts.id, accountId));

  return { accountId, fetched, inserted, fromId: startId, toId: latestSeen, pages };
}

async function insertBatch(accountId: string, tx: Transaction[]): Promise<number> {
  const rows = tx.map((t) => ({
    accountId,
    id: t.id,
    type: t.type,
    time: new Date(t.time),
    payload: t as unknown as Record<string, unknown>,
  }));

  let inserted = 0;
  // Chunked to stay well under Postgres' parameter limit on wide jsonb rows.
  const CHUNK = 250;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await db
      .insert(transactionsRaw)
      .values(rows.slice(i, i + CHUNK))
      // Never overwrite a stored payload: the ledger is immutable by design.
      .onConflictDoNothing()
      .returning({ id: transactionsRaw.id });
    inserted += res.length;
  }
  return inserted;
}

/** OANDA ids are numeric strings; compare numerically, not lexically. */
function maxId(a: string, b: string): string {
  return Number(b) > Number(a) ? b : a;
}

/** Sync every active account in an environment. */
export async function syncEnvironment(
  environment: OandaEnvironment,
  opts: { fromScratch?: boolean } = {},
): Promise<SyncResult[]> {
  const list = await db.query.accounts.findMany({
    where: eq(accounts.environment, environment),
  });

  const results: SyncResult[] = [];
  for (const a of list) {
    if (!a.active) continue;
    try {
      results.push(await syncAccount(a.id, environment, opts));
    } catch (e) {
      // One inaccessible sub-account must not abort the rest.
      results.push({
        accountId: a.id,
        fetched: 0,
        inserted: 0,
        fromId: a.lastSyncedTransactionId ?? "0",
        toId: a.lastSyncedTransactionId ?? "0",
        pages: 0,
      });
      console.error(`sync failed for ${a.id}: ${(e as Error).message}`);
    }
  }
  return results;
}
