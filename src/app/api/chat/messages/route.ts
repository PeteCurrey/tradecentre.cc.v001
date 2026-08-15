import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  MAX_MESSAGE_LENGTH,
  postMessage,
  readRoom,
  roomExists,
} from "@/lib/chat/rooms";
import {
  currentUser,
  hasAcceptedChatTerms,
  type CurrentUser,
} from "@/lib/identity/user";

/**
 * Chat read and write.
 *
 * Both verbs re-check the terms rather than trusting the UI to have hidden the
 * composer. A client-side gate is a courtesy; this is the gate.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Modest per-user write limit — enough to converse, not to flood a room. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const posts = new Map<number, { count: number; resetAt: number }>();

function rateLimited(userId: number): boolean {
  const now = Date.now();
  const rec = posts.get(userId);
  if (!rec || now > rec.resetAt) {
    posts.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > MAX_PER_WINDOW;
}

async function requireMember(): Promise<CurrentUser | NextResponse> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return user;
}

export async function GET(req: NextRequest) {
  const user = await requireMember();
  if (user instanceof NextResponse) return user;

  const params = new URL(req.url).searchParams;
  const room = params.get("room") ?? "";
  if (!room || !(await roomExists(room))) {
    return NextResponse.json({ error: "No such room" }, { status: 404 });
  }

  const afterRaw = Number(params.get("after"));
  const after = Number.isInteger(afterRaw) && afterRaw > 0 ? afterRaw : undefined;

  const messages = await readRoom(room, { afterId: after });

  return NextResponse.json({
    messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    me: user.id,
    canPost: hasAcceptedChatTerms(user),
  });
}

const bodySchema = z.object({
  room: z.string().min(1).max(64),
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

export async function POST(req: NextRequest) {
  const user = await requireMember();
  if (user instanceof NextResponse) return user;

  if (!hasAcceptedChatTerms(user)) {
    return NextResponse.json(
      { error: "Accept the chat terms before posting." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }

  if (!(await roomExists(parsed.data.room))) {
    return NextResponse.json({ error: "No such room" }, { status: 404 });
  }

  if (rateLimited(user.id)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    const message = await postMessage(parsed.data.room, user.id, parsed.data.body);
    return NextResponse.json({
      message: { ...message, createdAt: message.createdAt.toISOString() },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
