import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, appConfig, trades, transactionsRaw } from "@/lib/db/schema";
import { syncEnvironment } from "@/lib/oanda/sync";
import { deriveTrades, summarise, type DerivationStats } from "./derive";
import { DEFAULT_HORIZON_THRESHOLDS, type HorizonThresholds } from "@/lib/books";
import type { OandaEnvironment } from "@/lib/oanda/types";

/**
 * Sync the ledger and rebuild derived trades.
 *
 * Shared by the CLI script and the in-app sync button, so there is exactly one
 * implementation. Duplicating this would let the two drift, and a UI sync that
 * behaved differently from the scripted one would be very hard to debug.
 */

export type RebuildResult = {
  accountId: string;
  book: string;
  fetched: number;
  inserted: number;
  stats: DerivationStats;
};

export type SyncSummary = {
  results: RebuildResult[];
  totalNew: number;
  totalTrades: number;
  durationMs: number;
  errors: string[];
};

export async function syncAndDerive(
  opts: { environments?: OandaEnvironment[]; fromScratch?: boolean } = {},
): Promise<SyncSummary> {
  const started = Date.now();
  const environments = opts.environments ?? (["practice", "live"] as const);
  const errors: string[] = [];
  const bySync = new Map<string, { fetched: number; inserted: number }>();

  for (const environment of environments) {
    try {
      for (const r of await syncEnvironment(environment, {
        fromScratch: opts.fromScratch,
      })) {
        bySync.set(r.accountId, { fetched: r.fetched, inserted: r.inserted });
      }
    } catch (e) {
      errors.push(`${environment}: ${(e as Error).message}`);
    }
  }

  // Horizon boundaries are Peter's to tune, so read them rather than assume.
  const [cfg] = await db.select().from(appConfig).limit(1);
  const thresholds =
    (cfg?.horizonThresholds as HorizonThresholds | undefined) ?? DEFAULT_HORIZON_THRESHOLDS;

  const results: RebuildResult[] = [];
  const allAccounts = await db.select().from(accounts);

  for (const account of allAccounts) {
    const rows = await db
      .select()
      .from(transactionsRaw)
      .where(eq(transactionsRaw.accountId, account.id))
      .orderBy(asc(transactionsRaw.id));

    if (rows.length === 0) continue;

    const derived = deriveTrades(
      rows.map((r) => r.payload as unknown as Record<string, unknown>) as never,
      thresholds,
    );

    // Wholesale rebuild. Safe because annotations live in a separate table
    // keyed on the broker's trade id — wiping trades cannot orphan them.
    await db.delete(trades).where(eq(trades.accountId, account.id));

    const CHUNK = 200;
    for (let i = 0; i < derived.length; i += CHUNK) {
      const slice = derived.slice(i, i + CHUNK).map((t) => ({
        accountId: account.id,
        oandaTradeId: t.oandaTradeId,
        book: account.book,
        horizon: t.horizon,
        instrument: t.instrument,
        direction: t.direction,
        state: t.state,
        units: String(t.units),
        entryTime: new Date(t.entryTime),
        entryPrice: String(t.entryPrice),
        exitTime: t.exitTime ? new Date(t.exitTime) : null,
        exitPrice: t.exitPrice !== null ? String(t.exitPrice) : null,
        plannedStop: t.plannedStop !== null ? String(t.plannedStop) : null,
        plannedTarget: t.plannedTarget !== null ? String(t.plannedTarget) : null,
        initialRisk: t.initialRisk !== null ? String(t.initialRisk) : null,
        realizedPl: String(t.realizedPl),
        financing: String(t.financing),
        commission: String(t.commission),
        spreadCost: String(t.spreadCost),
        rMultiple: t.rMultiple,
      }));
      if (slice.length) await db.insert(trades).values(slice);
    }

    const sync = bySync.get(account.id);
    results.push({
      accountId: account.id,
      book: account.book,
      fetched: sync?.fetched ?? 0,
      inserted: sync?.inserted ?? 0,
      stats: summarise(derived),
    });
  }

  return {
    results,
    totalNew: results.reduce((s, r) => s + r.inserted, 0),
    totalTrades: results.reduce((s, r) => s + r.stats.total, 0),
    durationMs: Date.now() - started,
    errors,
  };
}
