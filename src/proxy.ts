import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Proxy — Next 16's replacement for Middleware (same semantics, new name).
 *
 * Everything is private by default. Deny-by-default matters more than usual
 * here because a live broker connection sits behind these routes: a screen
 * added later is protected without anyone remembering to protect it.
 *
 * Per Next's guidance, this is an OPTIMISTIC check, not the whole authorization
 * story. It verifies the session signature and bounces anonymous requests early
 * so no server component does needless work. Anything touching broker data
 * calls requireSession() from @/lib/auth/guard as well — see that file.
 */

/**
 * /api/health is public because a broken deploy is exactly when you cannot log
 * in to diagnose it. Its unauthenticated response carries only pass/fail per
 * check — no hostnames, no error text, no configuration detail.
 */
/**
 * /api/auth/sso is public of necessity: it is the door a drawdown.trading
 * subscriber arrives at with no session yet. It can do nothing but verify a
 * signature it has no way to forge.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/sso", "/api/health"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  // API routes get a status, not a redirect — a 302 to HTML would make a fetch
  // caller try to parse a login page as data.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static assets; everything else is gated.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
