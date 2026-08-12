import { sql } from "drizzle-orm";
import { hasSession } from "@/lib/auth/guard";

/**
 * Health check.
 *
 * Exists because "A server error occurred" is useless when a deployment fails.
 * This reports what is actually reachable, with the real error text, so a
 * broken deploy is diagnosable from the browser instead of by guesswork.
 *
 * Public summary is deliberately thin — anything that names a host, a database
 * or an error detail requires a session, since that is reconnaissance
 * information on an app holding broker credentials.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
  ms?: number;
};

async function timed(name: string, fn: () => Promise<string | void>): Promise<Check> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail: detail || undefined, ms: Date.now() - t };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message, ms: Date.now() - t };
  }
}

export async function GET() {
  const authed = await hasSession();

  const checks: Check[] = [];

  // --- Environment -------------------------------------------------------
  const required = ["DATABASE_URL", "AUTH_SECRET", "AUTH_PASSWORD_HASH"];
  const missing = required.filter((k) => !process.env[k]);
  checks.push({
    name: "env",
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
  });

  // --- Database ----------------------------------------------------------
  checks.push(
    await timed("database", async () => {
      const { db } = await import("@/lib/db");
      const r = await db.execute(sql`select 1 as ok`);
      if (!r) throw new Error("no response");

      const url = process.env.DATABASE_URL ?? "";
      let shape = "";
      try {
        const u = new URL(url);
        const pooled = u.hostname.includes("pooler.supabase.com");
        shape = `${u.hostname}:${u.port || 5432} ${pooled ? "(pooler)" : "(DIRECT — IPv6 only, will fail on IPv4 hosts)"}`;
      } catch {
        shape = "unparseable DATABASE_URL";
      }
      return shape;
    }),
  );

  // --- OANDA -------------------------------------------------------------
  checks.push(
    await timed("oanda", async () => {
      if (!process.env.OANDA_PRACTICE_TOKEN && !process.env.OANDA_LIVE_TOKEN) {
        throw new Error("no token configured");
      }
      const { oanda } = await import("@/lib/oanda/client");
      const environment = process.env.OANDA_LIVE_TOKEN ? "live" : "practice";
      const accounts = await oanda(environment).listAccounts();
      return `${environment}: ${accounts.length} accounts`;
    }),
  );

  // --- Price stream ------------------------------------------------------
  checks.push(
    await timed("stream", async () => {
      const { hub } = await import("@/lib/stream/hub");
      return `${hub.connectionState}, ${hub.snapshot.length} instruments`;
    }),
  );

  const ok = checks.every((c) => c.ok);

  if (!authed) {
    // Unauthenticated callers get liveness only — no hostnames, no error text.
    return Response.json(
      { ok, checks: checks.map((c) => ({ name: c.name, ok: c.ok })) },
      { status: ok ? 200 : 503 },
    );
  }

  return Response.json(
    { ok, checks, node: process.version, env: process.env.NODE_ENV },
    { status: ok ? 200 : 503 },
  );
}
