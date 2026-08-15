import "server-only";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatRooms, users } from "@/lib/db/schema";

/**
 * Chat rooms and messages.
 *
 * ── Rooms, not DMs ────────────────────────────────────────────────────────
 * With a small membership one busy room beats a hundred silent private
 * threads, and a room that anyone can read is also a room that can be
 * moderated — which matters on a platform where people discuss positions.
 *
 * ── Transport ─────────────────────────────────────────────────────────────
 * Polling, NOT the SSE hub in lib/stream. That hub's lifecycle is bound to the
 * OANDA price socket, so it is down at weekends — precisely when people have
 * time to talk. The same reasoning kept The Wire off it.
 */

export const MAX_MESSAGE_LENGTH = 2000;

/** Seeded on first use so a new deployment is not an empty screen with no way in. */
const DEFAULT_ROOMS: Array<{ slug: string; label: string; topic: string; instrument?: string }> = [
  { slug: "floor", label: "The Floor", topic: "General trading talk" },
  { slug: "gold", label: "Gold", topic: "XAU and the metals", instrument: "XAU_USD" },
  { slug: "indices", label: "Indices", topic: "S&P, Nasdaq, Dow" },
  { slug: "fx", label: "FX", topic: "Majors and crosses" },
];

export type ChatRoom = {
  slug: string;
  label: string;
  topic: string | null;
  instrument: string | null;
};

export type ChatMessage = {
  id: number;
  roomSlug: string;
  userId: number;
  /** The chosen username, falling back to the Drawdown name if unset. */
  author: string;
  jobTitle: string | null;
  avatar: string | null;
  body: string;
  createdAt: Date;
  deleted: boolean;
};

export async function listRooms(): Promise<ChatRoom[]> {
  const existing = await db
    .select()
    .from(chatRooms)
    .where(eq(chatRooms.archived, false))
    .orderBy(asc(chatRooms.slug));

  if (existing.length > 0) {
    return existing.map((r) => ({
      slug: r.slug,
      label: r.label,
      topic: r.topic,
      instrument: r.instrument,
    }));
  }

  // First run. onConflictDoNothing so two simultaneous first visits cannot
  // collide on the primary key.
  await db.insert(chatRooms).values(DEFAULT_ROOMS).onConflictDoNothing();
  return DEFAULT_ROOMS.map((r) => ({
    slug: r.slug,
    label: r.label,
    topic: r.topic,
    instrument: r.instrument ?? null,
  }));
}

export async function roomExists(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ slug: chatRooms.slug })
    .from(chatRooms)
    .where(and(eq(chatRooms.slug, slug), eq(chatRooms.archived, false)))
    .limit(1);
  return Boolean(row);
}

/**
 * Read a room.
 *
 * `afterId` makes the poll incremental — the client already holds everything
 * older, so re-sending it every few seconds is pure waste on a history that,
 * by design, never gets shorter.
 *
 * Deleted messages are returned as tombstones rather than omitted. A silently
 * vanishing message makes a conversation read as though it never happened,
 * which is worse than showing that something was removed.
 */
export async function readRoom(
  slug: string,
  opts: { limit?: number; afterId?: number } = {},
): Promise<ChatMessage[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);

  const where = opts.afterId
    ? and(eq(chatMessages.roomSlug, slug), gt(chatMessages.id, opts.afterId))
    : eq(chatMessages.roomSlug, slug);

  const rows = await db
    .select({
      id: chatMessages.id,
      roomSlug: chatMessages.roomSlug,
      userId: chatMessages.userId,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      deletedAt: chatMessages.deletedAt,
      username: users.username,
      displayName: users.displayName,
      jobTitle: users.jobTitle,
      avatar: users.avatar,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(where)
    // Newest-first for the LIMIT so a long history returns the recent end,
    // then reversed to reading order below.
    .orderBy(desc(chatMessages.id))
    .limit(limit);

  return rows.reverse().map((r) => ({
    id: r.id,
    roomSlug: r.roomSlug,
    userId: r.userId,
    author: r.username ?? r.displayName,
    jobTitle: r.jobTitle,
    // A removed message shows no avatar either — the row is a tombstone, not a
    // post with the words taken out.
    avatar: r.deletedAt ? null : r.avatar,
    body: r.deletedAt ? "" : r.body,
    createdAt: r.createdAt,
    deleted: r.deletedAt !== null,
  }));
}

export async function postMessage(
  slug: string,
  userId: number,
  body: string,
): Promise<ChatMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message is empty");
  if (trimmed.length > MAX_MESSAGE_LENGTH) throw new Error("Message is too long");

  const [row] = await db
    .insert(chatMessages)
    .values({ roomSlug: slug, userId, body: trimmed })
    .returning();

  const [author] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      jobTitle: users.jobTitle,
      avatar: users.avatar,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    id: row.id,
    roomSlug: row.roomSlug,
    userId: row.userId,
    author: author?.username ?? author?.displayName ?? "Member",
    jobTitle: author?.jobTitle ?? null,
    avatar: author?.avatar ?? null,
    body: row.body,
    createdAt: row.createdAt,
    deleted: false,
  };
}

/**
 * Moderation. The row is never removed — see the retention note on the table.
 * Only the owner may do this for now; a proper moderator role can hang off the
 * users table when there is someone to give it to.
 */
export async function softDeleteMessage(id: number, byUserId: number): Promise<boolean> {
  const res = await db
    .update(chatMessages)
    .set({ deletedAt: new Date(), deletedBy: byUserId })
    .where(and(eq(chatMessages.id, id), isNull(chatMessages.deletedAt)))
    .returning({ id: chatMessages.id });
  return res.length > 0;
}
