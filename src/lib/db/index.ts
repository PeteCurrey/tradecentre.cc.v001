import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Postgres connection (Supabase-hosted, app running on Railway).
 *
 * ⚠️ Supabase offers three connection strings and they are NOT interchangeable:
 *
 *   • Direct        db.<ref>.supabase.co:5432        — IPv6 only on many projects
 *   • Session pool  <region>.pooler.supabase.com:5432 — behaves like a normal PG
 *   • Transaction   <region>.pooler.supabase.com:6543 — NO prepared statements
 *
 * postgres.js uses prepared statements by default, so pointing it at the
 * transaction pooler (6543) without `prepare: false` produces confusing
 * intermittent errors under load rather than a clean failure at startup.
 * We detect the port and configure accordingly.
 *
 * For a persistent Node process holding a small pool, the SESSION pooler
 * (port 5432) is the better default — it supports prepared statements and
 * behaves like ordinary Postgres.
 */

const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

function isTransactionPooler(url: string): boolean {
  try {
    const u = new URL(url);
    return u.port === "6543" || u.hostname.includes("pooler.supabase.com") && u.port === "6543";
  } catch {
    return false;
  }
}

function isLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1";
  } catch {
    return false;
  }
}

function client() {
  if (!globalForDb.__sql) {
    const url = env().DATABASE_URL;
    globalForDb.__sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: isLocal(url) ? false : "require",
      // Required on Supabase's transaction pooler; harmless elsewhere but it
      // costs performance, so only disable prepares when we actually must.
      prepare: !isTransactionPooler(url),
    });
  }
  return globalForDb.__sql;
}

export const db = drizzle(client(), { schema });
export { schema };
