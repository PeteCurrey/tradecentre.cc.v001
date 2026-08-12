import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Server-side session check, used by anything that reads broker data.
 *
 * Next's own guidance is that proxy should be an optimistic check rather than
 * the complete authorization story — proxy runs before routing and is easy to
 * misconfigure with a matcher. This is the second layer: it runs in the data
 * path itself, so a route that somehow escapes the matcher still cannot serve
 * account data to an anonymous request.
 */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySession(token))) redirect("/login");
}

/** Non-redirecting variant, for API routes that should return a status. */
export async function hasSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token);
}
