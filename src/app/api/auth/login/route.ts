import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { passwordHashIsWellFormed, verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookieOptions } from "@/lib/auth/session";
import { ownerUser } from "@/lib/identity/user";
import { isAuthConfigured } from "@/lib/env";

// scrypt is Node-only.
export const runtime = "nodejs";

const bodySchema = z.object({ password: z.string().min(1).max(512) });

/**
 * Crude but effective rate limiting.
 *
 * Single-user app on a single always-on process, so an in-memory counter is
 * genuinely sufficient — there is no second instance to coordinate with. It
 * resets on deploy, which is acceptable for a brute-force guard.
 */
const attempts = { count: 0, resetAt: 0 };
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          'Auth is not configured. Run: node scripts/hash-password.mjs "your password"',
      },
      { status: 503 },
    );
  }

  /**
   * A broken hash is a configuration fault, not a wrong password.
   *
   * Checked BEFORE the rate limiter, so a misconfigured deployment cannot lock
   * itself out while showing a message that sends you looking for the wrong
   * problem. Says what is wrong and how to fix it; reveals nothing about the
   * stored value.
   */
  if (!passwordHashIsWellFormed()) {
    return NextResponse.json(
      {
        error:
          "AUTH_PASSWORD_HASH is malformed, so no password can succeed. If it is " +
          "set in a .env file, escape the dollar signs (scrypt\\$16384\\$8\\$1\\$…) " +
          "— quoting is not enough — then restart. Or regenerate it with: " +
          'node scripts/hash-password.mjs "your password"',
      },
      { status: 503 },
    );
  }

  const now = Date.now();
  if (now > attempts.resetAt) {
    attempts.count = 0;
    attempts.resetAt = now + WINDOW_MS;
  }
  if (attempts.count >= MAX_ATTEMPTS) {
    const mins = Math.ceil((attempts.resetAt - now) / 60000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ok = await verifyPassword(parsed.data.password);
  if (!ok) {
    attempts.count++;
    // Deliberately vague, and no timing branch beyond the constant-time compare.
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  attempts.count = 0;

  // The password login is the owner. Resolving the row here means the session
  // carries a real user id from the start, so chat and anything else
  // multi-tenant needs no special case for Peter.
  const owner = await ownerUser();

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    value: await createSession(owner.id),
  });
  return res;
}
