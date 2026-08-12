import { SignJWT, jwtVerify } from "jose";

/**
 * Session tokens.
 *
 * Deliberately EDGE-SAFE: this module reads process.env directly and imports
 * only `jose`, so middleware can verify a session without pulling in Node-only
 * crypto or the `server-only` guard. Password hashing lives in ./password.ts,
 * which is Node-only and never reaches the edge.
 */

const COOKIE = "desk_session";
const ISSUER = "trading-desk";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "AUTH_SECRET is not set. Generate one with:\n" +
        '  node scripts/hash-password.mjs "your password"',
    );
  }
  return new TextEncoder().encode(s);
}

export async function createSession(): Promise<string> {
  return new SignJWT({ sub: "peter" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

/** Returns true only for a signature-valid, unexpired token. */
export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secret(), { issuer: ISSUER });
    return true;
  } catch {
    // Expired, tampered with, or signed by an older AUTH_SECRET. All mean
    // "not logged in" — never distinguish these to the caller.
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    name: COOKIE,
    httpOnly: true, // never readable from JavaScript
    sameSite: "lax" as const,
    secure, // HTTPS only in production
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}
