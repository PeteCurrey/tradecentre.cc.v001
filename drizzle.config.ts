import { existsSync } from "node:fs";
import type { Config } from "drizzle-kit";

// drizzle-kit runs outside Next, so .env.local isn't loaded for us.
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

/**
 * Migrations almost always run from a laptop, where Railway's private
 * `postgres.railway.internal` name does not resolve. Prefer the public proxy
 * URL when we are outside Railway — same rule as src/lib/env.ts.
 */
function databaseUrl(): string {
  const primary = process.env.DATABASE_URL?.trim();
  const publicUrl = process.env.DATABASE_PUBLIC_URL?.trim();
  const insideRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);

  if (primary?.includes(".railway.internal") && !insideRailway && publicUrl) {
    return publicUrl;
  }
  if (primary) return primary;
  if (publicUrl) return publicUrl;

  throw new Error(
    "No database URL. Set DATABASE_URL (or DATABASE_PUBLIC_URL) in .env.local",
  );
}

const url = databaseUrl();

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
    // TLS everywhere except localhost and Railway's private network, which
    // presents no certificate valid for that hostname.
    ssl:
      url.includes("localhost") || url.includes(".railway.internal")
        ? false
        : "require",
  },
  strict: true,
  verbose: true,
} satisfies Config;
