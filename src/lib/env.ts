import "server-only";
import { z } from "zod";

/**
 * Server-only environment.
 *
 * The `server-only` import above is a build-time guard: if any client component
 * ever imports this module (directly or transitively), the build FAILS rather
 * than silently shipping a credential to the browser.
 *
 * ⚠️ OANDA personal access tokens are full trading credentials — the v20 API
 * has no read-only scope. There is no safe way to expose one to a browser, so
 * nothing here may ever be prefixed with the public-variable prefix.
 */

/**
 * Accepted aliases per canonical key.
 *
 * Providers name their keys inconsistently and so do dashboards, so rather than
 * demand one exact spelling we accept the common variants. This costs nothing
 * and removes a whole category of "why is this empty" debugging.
 */
const ALIASES: Record<string, string[]> = {
  DATABASE_URL: ["DATABASE_URL", "POSTGRES_URL"],
  OANDA_PRACTICE_TOKEN: ["OANDA_PRACTICE_TOKEN", "OANDA_API_KEY", "OANDA_DEMO_TOKEN"],
  OANDA_LIVE_TOKEN: ["OANDA_LIVE_TOKEN"],
  FINNHUB_API_KEY: ["FINNHUB_API_KEY", "FINNHUB_KEY"],
  TWELVEDATA_API_KEY: ["TWELVEDATA_API_KEY", "TWELVE_DATA_KEY", "TWELVE_DATA_API_KEY"],
  FRED_API_KEY: ["FRED_API_KEY", "FRED_KEY"],
  POLYGON_API_KEY: ["POLYGON_API_KEY", "POLYGON_KEY"],
  EIA_API_KEY: ["EIA_API_KEY", "EIA_KEY"],
  ANTHROPIC_API_KEY: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  OPENAI_API_KEY: ["OPENAI_API_KEY"],
  GEMINI_API_KEY: ["GEMINI_API_KEY", "GOOGLE_GEMINI_KEY", "GOOGLE_API_KEY"],
  XAI_API_KEY: ["XAI_API_KEY", "GROK_API_KEY"],
  AUTH_SECRET: ["AUTH_SECRET"],
  AUTH_PASSWORD_HASH: ["AUTH_PASSWORD_HASH"],
};

function resolve(canonical: string): string | undefined {
  for (const name of ALIASES[canonical] ?? [canonical]) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

const schema = z.object({
  DATABASE_URL: z.string().url(),

  /**
   * Auth is optional HERE and asserted at the auth boundary instead — see
   * requireAuth() below.
   *
   * Validating it globally would couple every CLI script and migration to
   * having a password configured, which is wrong: seeding the database has
   * nothing to do with logging in. It also produces a far worse error, since
   * "app won't boot" is much less useful than "auth is not configured" raised
   * at the login screen.
   */
  AUTH_SECRET: z.string().min(32).optional(),
  /** scrypt hash. See scripts/hash-password.mjs — never the password itself. */
  AUTH_PASSWORD_HASH: z.string().min(16).optional(),

  /** OANDA — live and practice are separate systems with separate tokens. */
  OANDA_LIVE_TOKEN: z.string().min(20).optional(),
  OANDA_PRACTICE_TOKEN: z.string().min(20).optional(),

  /** Market context. All optional — the app degrades rather than breaks. */
  FINNHUB_API_KEY: z.string().optional(),
  TWELVEDATA_API_KEY: z.string().optional(),
  FRED_API_KEY: z.string().optional(),
  POLYGON_API_KEY: z.string().optional(),
  /** US energy inventories — crude and natural gas release schedule. */
  EIA_API_KEY: z.string().optional(),

  /** AI providers. On demand only, so none is required to run the app. */
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const raw: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV };
  for (const canonical of Object.keys(ALIASES)) raw[canonical] = resolve(canonical);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => {
        const key = String(i.path[0]);
        const accepted = ALIASES[key]?.join(" | ") ?? key;
        return `  ${key}: ${i.message}\n    accepted names: ${accepted}`;
      })
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Assert auth is configured. Call this at the auth boundary only — never at
 * module load, or scripts that have no business needing a password will break.
 */
export function requireAuth(): { secret: string; passwordHash: string } {
  const e = env();
  if (!e.AUTH_SECRET || !e.AUTH_PASSWORD_HASH) {
    throw new Error(
      "Auth is not configured. Generate both values with:\n" +
        '  node scripts/hash-password.mjs "your password"\n' +
        "then set AUTH_SECRET and AUTH_PASSWORD_HASH in .env.local",
    );
  }
  return { secret: e.AUTH_SECRET, passwordHash: e.AUTH_PASSWORD_HASH };
}

export function isAuthConfigured(): boolean {
  const e = env();
  return Boolean(e.AUTH_SECRET && e.AUTH_PASSWORD_HASH);
}

/** True when a given OANDA environment has a token configured. */
export function hasOandaToken(environment: "live" | "practice"): boolean {
  const e = env();
  return Boolean(environment === "live" ? e.OANDA_LIVE_TOKEN : e.OANDA_PRACTICE_TOKEN);
}

/* -------------------------------------------------------------------------- */
/* AI providers                                                                */
/* -------------------------------------------------------------------------- */

export const AI_PROVIDERS = ["anthropic", "openai", "gemini", "xai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export function aiKey(provider: AiProvider): string | undefined {
  const e = env();
  switch (provider) {
    case "anthropic":
      return e.ANTHROPIC_API_KEY;
    case "openai":
      return e.OPENAI_API_KEY;
    case "gemini":
      return e.GEMINI_API_KEY;
    case "xai":
      return e.XAI_API_KEY;
  }
}

/** Providers with a key configured. Absence is a normal state, not an error. */
export function configuredAiProviders(): AiProvider[] {
  return AI_PROVIDERS.filter((p) => Boolean(aiKey(p)));
}
