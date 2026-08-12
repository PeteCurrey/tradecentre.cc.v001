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
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const { passwordHash } = requireAuth();

  const parts = passwordHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  let actual: Buffer;
  try {
    actual = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  // Constant-time: a length-dependent early return would leak information.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
