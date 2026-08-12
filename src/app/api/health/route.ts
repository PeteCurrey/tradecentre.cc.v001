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

/**
 * Describe DATABASE_URL without ever revealing the password.
 *
 * The pooler-vs-direct distinction is the whole diagnosis on IPv4 hosts, so it
 * is stated explicitly rather than left to be inferred from a hostname.
 */
function describeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return "DATABASE_URL not set";
  try {
    const u = new URL(raw);
    const port = u.port || "5432";
    const pooled = u.hostname.includes("pooler.supabase.com");
    const userLooksPooled = u.username.includes(".");

    if (pooled) {
      const mode = port === "6543" ? "transaction pooler" : "session pooler";
      return `${u.hostname}:${port} (${mode})`;
    }
    return (
      `${u.hostname}:${port} (DIRECT HOST — publishes IPv6 only, ` +
      `unreachable from IPv4 platforms like Railway; switch to the session pooler` +
      `${userLooksPooled ? "" : "; note the pooler username is postgres.<project-ref>"})`
    );
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
}

/** Flatten an error chain — postgres.js hides the real cause underneath. */
function unwrap(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    const err = cur as Error & { code?: string; errno?: number; cause?: unknown };
    const bits = [err.code, err.message?.split("\n")[0]].filter(Boolean);
    if (bits.length) parts.push(bits.join(" "));
    cur = err.cause;
  }
  return parts.join(" ← ") || String(e);
}

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
  // The connection SHAPE is reported whether or not the query succeeds. An
  // earlier version computed it only on success, which hid the single most
  // useful fact — pooler or direct host — at exactly the moment it mattered.
  const shape = describeDatabaseUrl(process.env.DATABASE_URL);

  checks.push(
    await timed("database", async () => {
      const { db } = await import("@/lib/db");
      try {
        await db.execute(sql`select 1 as ok`);
        return shape;
      } catch (e) {
        // postgres.js wraps the real failure: `message` is just "Failed query".
        // The cause is in code/errno/cause, and without it the report says
        // nothing actionable.
        throw new Error(`${shape} — ${unwrap(e)}`);
      }
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
