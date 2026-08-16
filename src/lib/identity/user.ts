import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE, readSessionUid } from "@/lib/auth/session";
import {
  canPostToChat,
  canReadChat,
  type Role,
  type UserStatus,
} from "@/lib/identity/roles";

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
  /* Chat profile — null until the wizard is completed. */
  username: string | null;
  usernameChangedAt: Date | null;
  jobTitle: string | null;
  avatar: string | null;
  chatEnabled: boolean;
  onboardedAt: Date | null;
  /* Role and standing. */
  role: Role;
  status: UserStatus;
  suspendedUntil: Date | null;
  statusReason: string | null;
  /**
   * The password login, and the deployment's owner.
   *
   * Derived from the reserved external id, never stored as a role — so no
   * update to the role column can confer it, and no admin can promote
   * themselves to it.
   */
  isOwner: boolean;
};

/** One mapper, so a new column cannot be wired into one path and not the other. */
function toCurrentUser(row: typeof users.$inferSelect): CurrentUser {
  return {
    id: row.id,
    externalId: row.externalId,
    displayName: row.displayName,
    termsAcceptedAt: row.termsAcceptedAt,
    termsVersion: row.termsVersion,
    username: row.username,
    usernameChangedAt: row.usernameChangedAt,
    jobTitle: row.jobTitle,
    avatar: row.avatar,
    chatEnabled: row.chatEnabled,
    onboardedAt: row.onboardedAt,
    role: row.role,
    status: row.status,
    suspendedUntil: row.suspendedUntil,
    statusReason: row.statusReason,
    isOwner: row.externalId === OWNER_EXTERNAL_ID,
  };
}

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

  return toCurrentUser(row);
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

  return toCurrentUser(row);
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

/**
 * Has this member finished the wizard on the CURRENT terms?
 *
 * A terms bump sends them back through it. That is the point of versioning:
 * "they agreed to something once" is not the question anyone will ask later.
 */
export function hasCompletedChatOnboarding(u: CurrentUser): boolean {
  return u.onboardedAt !== null && u.username !== null && hasAcceptedChatTerms(u);
}

/**
 * May this member post right now?
 *
 * Standing is checked FIRST and separately from the member's own switch: a
 * suspension is not something they can toggle off, and folding the two into
 * one boolean would make that distinction easy to lose in a later edit.
 */
export function canUseChat(u: CurrentUser): boolean {
  if (!canPostToChat(u)) return false;
  return hasCompletedChatOnboarding(u) && u.chatEnabled;
}

/** May they even see the rooms? Banned members cannot; suspended ones can. */
export function canViewChat(u: CurrentUser): boolean {
  return canReadChat(u);
}

export async function acceptChatTerms(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ termsAcceptedAt: new Date(), termsVersion: CHAT_TERMS_VERSION })
    .where(eq(users.id, userId));
}
