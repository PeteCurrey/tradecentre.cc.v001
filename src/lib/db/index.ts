import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Postgres connection.
 *
 * PRIMARY: Railway Postgres over private networking —
 *   postgres.railway.internal:5432
 * Never leaves Railway's network, so there is no public exposure, no IPv6/IPv4
 * routing problem, and ~1ms latency. Railway injects this via a reference
 * variable when the services are linked.
 *
 * Externally (migrations, seeding, sync from a laptop) the same database is
 * reachable at its public proxy host, which does require TLS.
 *
 * ⚠️ Two host-dependent settings, both of which fail confusingly if wrong:
 *
 *   TLS — required over the public internet, but `*.railway.internal` presents
 *   no certificate valid for that name, so forcing it breaks the connection
 *   rather than securing anything. See needsTls().
 *
 *   PREPARED STATEMENTS — postgres.js uses them by default. Supabase's
 *   transaction pooler (port 6543) does not support them and fails
 *   intermittently under load rather than cleanly at startup. Detected by port.
 *   Retained because Supabase remains a valid target for this app.
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

/**
 * Whether TLS should be required.
 *
 * Railway's `*.railway.internal` addresses are on a private network that never
 * leaves their infrastructure, and the endpoint does not present a certificate
 * valid for that hostname — so forcing TLS there fails the connection outright
 * rather than making anything safer. Everything reachable over the public
 * internet still requires it.
 */
function needsTls(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    if (h === "localhost" || h === "127.0.0.1") return false;
    if (h.endsWith(".railway.internal")) return false;
    return true;
  } catch {
    return true; // unparseable — fail closed
  }
}

function client() {
  if (!globalForDb.__sql) {
    const url = env().DATABASE_URL;
    globalForDb.__sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: needsTls(url) ? "require" : false,
      // Required on Supabase's transaction pooler; harmless elsewhere but it
      // costs performance, so only disable prepares when we actually must.
      prepare: !isTransactionPooler(url),
    });
  }
  return globalForDb.__sql;
}

export const db = drizzle(client(), { schema });
export { schema };
