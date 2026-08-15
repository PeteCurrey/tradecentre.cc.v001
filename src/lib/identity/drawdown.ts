import { jwtVerify } from "jose";

/**
 * Identity from drawdown.trading.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 * Drawdown authenticates the subscriber and hands them a short-lived JWT,
 * which they present here once to exchange for a desk session. Drawdown is the
 * only place a subscriber has a password; this app never sees one and stores
 * no credential for them.
 *
 * The token must be HS256, signed with a secret shared between the two systems
 * (`DRAWDOWN_JWT_SECRET`), and carry:
 *
 *   iss  "drawdown"          — issuer
 *   aud  "trading-desk"      — this app, so a token minted for the courses
 *                              site cannot be replayed here
 *   sub  <drawdown user id>  — stable and permanent; becomes users.externalId
 *   name <display name>      — optional, defaults to "Member"
 *   exp  <expiry>            — REQUIRED, and deliberately short
 *
 * ── Why short-lived, and why exchanged ────────────────────────────────────
 * The token is a bearer credential in a URL, which is the least private place
 * a secret can live: it lands in browser history, in any proxy log, and in the
 * Referer header of the next request. So it is spent immediately for an
 * httpOnly cookie and is useless within minutes. MAX_AGE_SECONDS caps that
 * regardless of what expiry the issuer chose, because a mistake at their end
 * must not become an indefinite session at ours.
 *
 * Entitlement is Drawdown's job. Issuing a token IS the statement that this
 * person has paid for access; this app does not second-guess it, which keeps
 * one system in charge of billing rather than two disagreeing.
 */

const ISSUER = "drawdown";
const AUDIENCE = "trading-desk";

/** A token older than this is refused however far away its own exp is. */
const MAX_AGE_SECONDS = 5 * 60;

export type DrawdownIdentity = {
  externalId: string;
  displayName: string;
};

export function drawdownSsoConfigured(): boolean {
  return Boolean(process.env.DRAWDOWN_JWT_SECRET);
}

function secret(): Uint8Array {
  const s = process.env.DRAWDOWN_JWT_SECRET;
  if (!s) throw new Error("DRAWDOWN_JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

/**
 * Verify a Drawdown token, or null.
 *
 * Null for every failure — bad signature, wrong audience, expired, too old,
 * missing subject. The caller must not be able to tell these apart, because
 * the difference is only useful to someone probing.
 */
export async function verifyDrawdownToken(
  token: string | undefined,
): Promise<DrawdownIdentity | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ["sub", "exp", "iat"],
      // Tokens are minted for immediate use; no allowance for drifting clocks
      // beyond a couple of seconds.
      clockTolerance: 2,
    });

    const iat = payload.iat;
    if (typeof iat !== "number") return null;
    if (Date.now() / 1000 - iat > MAX_AGE_SECONDS) return null;

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) return null;

    const name = payload.name;
    const displayName =
      typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : "Member";

    return { externalId: `drawdown:${sub}`, displayName };
  } catch {
    return null;
  }
}
