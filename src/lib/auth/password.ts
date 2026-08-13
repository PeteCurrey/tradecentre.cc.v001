import "server-only";
import { scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { requireAuth } from "@/lib/env";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Password verification. Node-only — scrypt is not available on the edge,
 * which is why session verification lives separately in ./session.ts.
 *
 * The stored format is produced by scripts/hash-password.mjs:
 *   scrypt$N$r$p$<salt base64>$<hash base64>
 *
 * Parameters are read from the stored string rather than assumed, so raising
 * the cost factor later does not invalidate an existing hash.
 *
 * The parsing and comparison are PURE functions taking the stored hash as an
 * argument, with thin env-reading wrappers on top. `env()` memoises, so logic
 * that reached into it directly could only ever be tested against the first
 * value the process happened to load.
 */

export type StoredHash = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
};

/**
 * Parse a stored hash, or null if it could never verify anything.
 *
 * Null exists because of a real failure: `.env` values are variable-expanded
 * before the app sees them, and an UNESCAPED hash is eaten by it — in
 * `scrypt$16384$8$1$…` the `$16384`, `$8` and `$1` are read as variable
 * references and substituted away, so the app receives a single mangled
 * string. Verification then failed at the parse and returned false, the login
 * route reported "Incorrect password", and every password on earth was
 * rejected — including the correct one.
 *
 * Escape the dollars in `.env.local`:
 *   AUTH_PASSWORD_HASH=scrypt\$16384\$8\$1\$…
 * Quoting does NOT help — Next's loader expands inside quotes too. Platforms
 * that set real environment variables (Railway, Vercel) are unaffected, which
 * is exactly why this reproduces locally and not in production.
 */
export function parseStoredHash(stored: string): StoredHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(rr) || !Number.isInteger(pp)) return null;
  if (N < 2 || rr < 1 || pp < 1) return null;

  const salt = Buffer.from(saltB64, "base64");
  const key = Buffer.from(keyB64, "base64");
  // Base64 that decodes to nothing would also reject every password.
  if (salt.length === 0 || key.length === 0) return null;

  return { N, r: rr, p: pp, salt, key };
}

/** Compare a password against an already-parsed hash. */
export async function verifyAgainst(
  password: string,
  stored: StoredHash,
): Promise<boolean> {
  let actual: Buffer;
  try {
    actual = await scrypt(password, stored.salt, stored.key.length, {
      N: stored.N,
      r: stored.r,
      p: stored.p,
    });
  } catch {
    return false;
  }

  // Constant-time: a length-dependent early return would leak information.
  if (actual.length !== stored.key.length) return false;
  return timingSafeEqual(actual, stored.key);
}

/**
 * Is the configured hash usable at all?
 *
 * The login route calls this first so a configuration fault is never reported
 * as a credential fault — the distinction that cost real debugging time once.
 */
export function passwordHashIsWellFormed(): boolean {
  return parseStoredHash(requireAuth().passwordHash) !== null;
}

export async function verifyPassword(password: string): Promise<boolean> {
  const stored = parseStoredHash(requireAuth().passwordHash);
  if (!stored) return false;
  return verifyAgainst(password, stored);
}
