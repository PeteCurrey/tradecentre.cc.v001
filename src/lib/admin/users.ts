"use server";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { chatMessages, moderationActions, users } from "@/lib/db/schema";
import { currentUser, type CurrentUser } from "@/lib/identity/user";
import {
  canActOn,
  canAssignRole,
  canManageRoles,
  canModerate,
  canOpenDashboard,
  type Role,
} from "@/lib/identity/roles";

/**
 * Administration.
 *
 * ── Every action re-derives the actor from the session ────────────────────
 * None of these take an actor id from the caller. A server action is a public
 * endpoint, and "who is doing this" is the one input that must never come from
 * the browser — otherwise the entire rank system is advisory.
 *
 * ── Every act is logged before it takes effect ────────────────────────────
 * Writes go through `record`, in the same transaction as the change. A sanction
 * with no record of who applied it is the thing a disputed ban turns into.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const DENIED: ActionResult = { ok: false, error: "You cannot do that." };

/** The actor, or null. Never trusts a caller-supplied id. */
async function actor(): Promise<CurrentUser | null> {
  return currentUser();
}

export type ManagedUser = {
  id: number;
  displayName: string;
  username: string | null;
  jobTitle: string | null;
  avatar: string | null;
  role: Role;
  status: "active" | "suspended" | "banned";
  suspendedUntil: Date | null;
  statusReason: string | null;
  isOwner: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  messageCount: number;
};

export async function listUsers(query?: string): Promise<ManagedUser[]> {
  const me = await actor();
  if (!me || !canOpenDashboard(me)) return [];

  const term = query?.trim();
  const where = term
    ? or(
        ilike(users.username, `%${term}%`),
        ilike(users.displayName, `%${term}%`),
        ilike(users.externalId, `%${term}%`),
      )
    : undefined;

  const rows = await db
    .select({
      id: users.id,
      externalId: users.externalId,
      displayName: users.displayName,
      username: users.username,
      jobTitle: users.jobTitle,
      avatar: users.avatar,
      role: users.role,
      status: users.status,
      suspendedUntil: users.suspendedUntil,
      statusReason: users.statusReason,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      messageCount: sql<number>`(
        select count(*)::int from ${chatMessages}
        where ${chatMessages.userId} = ${users.id}
      )`,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.lastSeenAt), desc(users.createdAt))
    .limit(200);

  return rows.map((r) => ({
    ...r,
    isOwner: r.externalId === "local:owner",
  }));
}

export type LogEntry = {
  id: number;
  action: string;
  reason: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
  actorName: string | null;
  targetName: string | null;
};

export async function listModerationLog(limit = 50): Promise<LogEntry[]> {
  const me = await actor();
  if (!me || !canOpenDashboard(me)) return [];

  const a = { ...users };
  const rows = await db
    .select({
      id: moderationActions.id,
      action: moderationActions.action,
      reason: moderationActions.reason,
      detail: moderationActions.detail,
      createdAt: moderationActions.createdAt,
      actorId: moderationActions.actorId,
      targetUserId: moderationActions.targetUserId,
    })
    .from(moderationActions)
    .orderBy(desc(moderationActions.createdAt))
    .limit(Math.min(limit, 200));

  // Two small lookups rather than a double self-join: the log page is short and
  // the join aliasing buys nothing at this size.
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.targetUserId]))].filter(
    (v): v is number => v !== null,
  );
  const names = ids.length
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName })
        .from(users)
        .where(sql`${users.id} in ${ids}`)
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.username ?? n.displayName]));
  void a;

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    reason: r.reason,
    detail: r.detail,
    createdAt: r.createdAt,
    actorName: r.actorId === null ? null : (nameOf.get(r.actorId) ?? "Removed"),
    targetName: nameOf.get(r.targetUserId) ?? "Unknown",
  }));
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Load a target and confirm the actor outranks them.
 *
 * One gate for every mutation below, so a new action cannot be added that
 * forgets to check — the check is the only way to obtain the target.
 */
async function gate(
  targetId: number,
): Promise<{ me: CurrentUser; target: ManagedUser } | null> {
  const me = await actor();
  if (!me || !canModerate(me)) return null;

  const [row] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!row) return null;

  const target: ManagedUser = {
    id: row.id,
    displayName: row.displayName,
    username: row.username,
    jobTitle: row.jobTitle,
    avatar: row.avatar,
    role: row.role,
    status: row.status,
    suspendedUntil: row.suspendedUntil,
    statusReason: row.statusReason,
    isOwner: row.externalId === "local:owner",
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    messageCount: 0,
  };

  if (!canActOn(me, target)) return null;
  return { me, target };
}

type Change = {
  action: string;
  reason?: string | null;
  detail?: Record<string, unknown>;
};

/** Apply a change and log it, atomically. */
async function record(
  actorId: number,
  targetId: number,
  change: Change,
  apply: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await apply(tx);
    await tx.insert(moderationActions).values({
      actorId,
      targetUserId: targetId,
      action: change.action,
      reason: change.reason ?? null,
      detail: change.detail ?? {},
    });
  });
}

export async function suspendUser(
  targetId: number,
  days: number | null,
  reason: string,
): Promise<ActionResult> {
  const g = await gate(targetId);
  if (!g) return DENIED;

  const until =
    days && days > 0 ? new Date(Date.now() + days * 86_400_000) : null;

  await record(
    g.me.id,
    targetId,
    {
      action: "suspend",
      reason: reason.trim() || null,
      detail: { until: until?.toISOString() ?? "indefinite" },
    },
    async (tx) => {
      await tx
        .update(users)
        .set({
          status: "suspended",
          suspendedUntil: until,
          statusReason: reason.trim() || null,
        })
        .where(eq(users.id, targetId));
    },
  );

  revalidatePath("/admin");
  return { ok: true };
}

export async function banUser(targetId: number, reason: string): Promise<ActionResult> {
  const g = await gate(targetId);
  if (!g) return DENIED;

  await record(
    g.me.id,
    targetId,
    { action: "ban", reason: reason.trim() || null },
    async (tx) => {
      await tx
        .update(users)
        .set({
          status: "banned",
          suspendedUntil: null,
          statusReason: reason.trim() || null,
          // A banned member's switch is turned off too, so lifting the ban does
          // not silently put them straight back into the rooms.
          chatEnabled: false,
        })
        .where(eq(users.id, targetId));
    },
  );

  revalidatePath("/admin");
  return { ok: true };
}

export async function reinstateUser(
  targetId: number,
  reason: string,
): Promise<ActionResult> {
  const g = await gate(targetId);
  if (!g) return DENIED;

  await record(
    g.me.id,
    targetId,
    {
      action: g.target.status === "banned" ? "unban" : "unsuspend",
      reason: reason.trim() || null,
      detail: { from: g.target.status },
    },
    async (tx) => {
      await tx
        .update(users)
        .set({ status: "active", suspendedUntil: null, statusReason: null })
        .where(eq(users.id, targetId));
    },
  );

  revalidatePath("/admin");
  return { ok: true };
}

export async function setUserRole(targetId: number, role: Role): Promise<ActionResult> {
  const me = await actor();
  if (!me || !canManageRoles(me)) return DENIED;

  const g = await gate(targetId);
  if (!g) return DENIED;

  // Checked against the ACTOR's ceiling, so an admin cannot mint a peer.
  if (!canAssignRole(me, g.target, role)) return DENIED;
  if (g.target.role === role) return { ok: true };

  await record(
    me.id,
    targetId,
    { action: "role_change", detail: { from: g.target.role, to: role } },
    async (tx) => {
      await tx.update(users).set({ role }).where(eq(users.id, targetId));
    },
  );

  revalidatePath("/admin");
  return { ok: true };
}

/** Remove a message. The row stays — see the note on the table. */
export async function removeMessage(
  messageId: number,
  reason: string,
): Promise<ActionResult> {
  const me = await actor();
  if (!me || !canModerate(me)) return DENIED;

  const [msg] = await db
    .select({ id: chatMessages.id, userId: chatMessages.userId })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), sql`${chatMessages.deletedAt} is null`))
    .limit(1);
  if (!msg) return { ok: false, error: "Message not found." };

  // A moderator may not remove the words of someone who outranks them.
  const g = await gate(msg.userId);
  if (!g) return DENIED;

  await record(
    me.id,
    msg.userId,
    { action: "message_delete", reason: reason.trim() || null, detail: { messageId } },
    async (tx) => {
      await tx
        .update(chatMessages)
        .set({ deletedAt: new Date(), deletedBy: me.id })
        .where(eq(chatMessages.id, messageId));
    },
  );

  revalidatePath("/admin");
  revalidatePath("/chat");
  return { ok: true };
}
