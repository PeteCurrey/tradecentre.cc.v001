import { sql } from "drizzle-orm";
import { hasSession } from "@/lib/auth/guard";
import { env } from "@/lib/env";

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
    const host = u.hostname;
    const where = `${host}:${port}`;

    // Railway private networking — the correct target for the deployed app.
    if (host.endsWith(".railway.internal")) {
      return `${where} (Railway private network)`;
    }
    // Railway's public proxy, used by scripts run from outside Railway.
    if (host.endsWith(".rlwy.net") || host.includes("proxy.rlwy")) {
      return `${where} (Railway public proxy)`;
    }
    if (host.includes("pooler.supabase.com")) {
      return `${where} (Supabase ${port === "6543" ? "transaction" : "session"} pooler)`;
    }
    // ONLY Supabase's direct host carries the IPv6 warning. An earlier version
    // applied it to every unrecognised host, which told Peter to "fix" a
    // Railway connection that was working perfectly at 3ms.
    if (/^db\..*\.supabase\.co$/.test(host)) {
      const userLooksPooled = u.username.includes(".");
      return (
        `${where} (Supabase DIRECT host — publishes IPv6 only, unreachable from ` +
        `IPv4 platforms like Railway; use the session pooler` +
        `${userLooksPooled ? "" : "; its username is postgres.<project-ref>"})`
      );
    }
    if (host === "localhost" || host === "127.0.0.1") return `${where} (local)`;
    return where;
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
}

/**
 * Host:port for a connection string, with credentials stripped.
 *
 * Never returns the password — this is for telling two URLs apart, not for
 * copying one out of a running container.
 */
function hostOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.username ? `${u.username}@` : ""}${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "unparseable";
  }
}

/**
 * Which variable is the connection actually coming from?
 *
 * A dashboard showing the right value proves nothing if the running container
 * has a different one, or if a second variable is shadowing the one that was
 * edited. This lists every name the resolver considers, so "I changed it and
 * nothing happened" becomes a question with an answer rather than a guess.
 */
function databaseUrlSources(): Record<string, string | null> {
  return {
    DATABASE_URL: hostOf(process.env.DATABASE_URL),
    POSTGRES_URL: hostOf(process.env.POSTGRES_URL),
    DATABASE_PUBLIC_URL: hostOf(process.env.DATABASE_PUBLIC_URL),
    RESOLVED: hostOf(env().DATABASE_URL),
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT ?? null,
  };
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
  //
  // Describe the RESOLVED url — the one @/lib/db actually dials — not the raw
  // DATABASE_URL. env() resolves aliases (POSTGRES_URL) and can substitute
  // DATABASE_PUBLIC_URL, so the raw variable and the live connection are not
  // always the same string. Reporting the raw one sent Peter to fix a variable
  // that was not the one in use.
  const shape = describeDatabaseUrl(env().DATABASE_URL);

  checks.push(
    await timed("database", async () => {
      const { db } = await import("@/lib/db");
      try {
        await db.execute(sql`select 1 as ok`);

        // `select 1` succeeds on a completely empty database, so connectivity
        // alone reported "healthy" while every page crashed on a missing
        // table. Check the schema actually exists.
        const rows = (await db.execute(
          sql`select count(*)::int as n from information_schema.tables
              where table_schema = 'public'`,
        )) as unknown as Array<{ n: number }>;
        const tables = Number(rows?.[0]?.n ?? 0);

        if (tables === 0) {
          throw new Error("connected, but NO TABLES — run: npm run db:migrate && npm run seed");
        }
        return `${shape} — ${tables} tables`;
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
    {
      ok,
      checks,
      database_url_sources: databaseUrlSources(),
      node: process.version,
      env: process.env.NODE_ENV,
    },
    { status: ok ? 200 : 503 },
  );
}
