import { existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) { if (existsSync(f)) { process.loadEnvFile(f); break; } }
const { createSession, sessionCookieOptions } = await import("../src/lib/auth/session.ts");
const token = await createSession();
const opts = sessionCookieOptions(false);
console.log(JSON.stringify({ name: opts.name, value: token }));
process.exit(0);
