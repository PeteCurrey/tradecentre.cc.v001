import { existsSync } from "node:fs";
import type { Config } from "drizzle-kit";

// drizzle-kit runs outside Next, so .env.local isn't loaded for us.
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set — check .env.local");
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
    // Same rule as the runtime client: TLS everywhere except localhost and
    // Railway's private network, which presents no matching certificate.
    ssl:
      url.includes("localhost") || url.includes(".railway.internal")
        ? false
        : "require",
  },
  strict: true,
  verbose: true,
} satisfies Config;
