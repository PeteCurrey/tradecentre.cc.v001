import { NextResponse, type NextRequest } from "next/server";
import { createSession, sessionCookieOptions } from "@/lib/auth/session";
import { drawdownSsoConfigured, verifyDrawdownToken } from "@/lib/identity/drawdown";
import { upsertUser } from "@/lib/identity/user";

/**
 * Exchange a drawdown.trading token for a desk session.
 *
 * Drawdown links a subscriber here as:
 *   https://<desk>/api/auth/sso?token=<jwt>&next=/chat
 *
 * The token is spent once and immediately: what the browser keeps afterwards
 * is this app's own httpOnly cookie. See lib/identity/drawdown.ts for why the
 * token must be short-lived.
 *
 * This route is public in proxy.ts by necessity — it is how an unauthenticated
 * subscriber becomes authenticated. Its only power is verifying a signature it
 * cannot forge.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only same-site paths. Without this the `next` parameter is an open redirect:
 * a link from anywhere could bounce a freshly-authenticated member to a
 * lookalike site with their session already warm. A protocol-relative `//host`
 * is rejected too, which is the case a naive startsWith("/") check misses.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));

  if (!drawdownSsoConfigured()) {
    return NextResponse.json(
      { error: "Single sign-on is not configured. Set DRAWDOWN_JWT_SECRET." },
      { status: 503 },
    );
  }

  const identity = await verifyDrawdownToken(url.searchParams.get("token") ?? undefined);
  if (!identity) {
    // Deliberately vague and deliberately not a redirect back to Drawdown —
    // an invalid token must not become a bounce loop between two sites.
    return NextResponse.json({ error: "Sign-in link is invalid or expired" }, { status: 401 });
  }

  const user = await upsertUser(identity.externalId, identity.displayName);

  const res = NextResponse.redirect(new URL(next, url.origin));
  res.cookies.set({
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    value: await createSession(user.id),
  });
  return res;
}
