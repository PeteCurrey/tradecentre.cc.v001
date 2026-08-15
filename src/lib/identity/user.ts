import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE, readSessionUid } from "@/lib/auth/session";

/**
 * Who is this request?
 *
 * One resolver for both login routes, so nothing downstream has to know
 * whether a person arrived by Peter's password or by a Drawdown token. Chat
 * and everything multi-tenant reads from here.
 */

/**
 * Peter's password login. A reserved external id rather than a magic user id,
 * so the owner is an ordinary row and every query is the same query — there is
 * no "if owner" branch anywhere.
 */
export const OWNER_EXTERNAL_ID = "local:owner";

export type CurrentUser = {
  id: number;
  externalId: string;
  displayName: string;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  /** The password login. Not a permission system — see the note below. */
  isOwner: boolean;
};

/**
 * Find or create a user by external id.
 *
 * Upsert rather than select-then-insert: two tabs finishing SSO at once would
 * otherwise race on the unique index and one would 500 on first ever login,
 * which is the worst possible moment for it.
 */
export async function upsertUser(
  externalId: string,
  displayName: string,
): Promise<CurrentUser> {
  const [row] = await db
    .insert(users)
    .values({ externalId, displayName, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: users.externalId,
      // The name can change at Drawdown; the row must follow it. Terms
      // acceptance is deliberately NOT touched here.
      set: { displayName, lastSeenAt: new Date() },
    })
    .returning();

  return {
    id: row.id,
    externalId: row.externalId,
    displayName: row.displayName,
    termsAcceptedAt: row.termsAcceptedAt,
    termsVersion: row.termsVersion,
    isOwner: row.externalId === OWNER_EXTERNAL_ID,
  };
}

/** The owner row, created on first use. */
export async function ownerUser(): Promise<CurrentUser> {
  return upsertUser(OWNER_EXTERNAL_ID, "Peter");
}

/**
 * The user this request is acting as, or null if not signed in.
 *
 * Returns null rather than redirecting: callers differ on what they want to do
 * about it, and an API route returning a login page as JSON is the bug this
 * avoids.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSessionUid(token);
  if (!session) return null;

  // A session with no uid predates the users table and can only be the
  // password login. See readSessionUid.
  if (session.uid === undefined) return ownerUser();

  const [row] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  // The row is gone but the cookie is still signed and unexpired — treat as
  // signed out rather than resurrecting a deleted member.
  if (!row) return null;

  return {
    id: row.id,
    externalId: row.externalId,
    displayName: row.displayName,
    termsAcceptedAt: row.termsAcceptedAt,
    termsVersion: row.termsVersion,
    isOwner: row.externalId === OWNER_EXTERNAL_ID,
  };
}

/* -------------------------------------------------------------------------- */
/* Terms                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bump this when the wording changes and everyone is asked again.
 *
 * Versioned rather than a boolean because "did they accept THESE terms" is the
 * question that gets asked later, and a bare flag cannot answer it.
 */
export const CHAT_TERMS_VERSION = "2026-08-1";

export function hasAcceptedChatTerms(u: CurrentUser): boolean {
  return u.termsAcceptedAt !== null && u.termsVersion === CHAT_TERMS_VERSION;
}

export async function acceptChatTerms(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ termsAcceptedAt: new Date(), termsVersion: CHAT_TERMS_VERSION })
    .where(eq(users.id, userId));
}
