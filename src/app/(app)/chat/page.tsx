import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { ChatTerms } from "@/components/chat/ChatTerms";
import { listRooms, readRoom, roomExists } from "@/lib/chat/rooms";
import {
  CHAT_TERMS_VERSION,
  currentUser,
  hasAcceptedChatTerms,
} from "@/lib/identity/user";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Chat.
 *
 * The first screen in this app that assumes more than one person exists.
 * Identity comes from drawdown.trading via /api/auth/sso; Peter's own password
 * login resolves to an ordinary user row, so there is no special case here.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fchat");

  const rooms = await listRooms();
  const { room: requested } = await searchParams;

  const active =
    requested && (await roomExists(requested)) ? requested : (rooms[0]?.slug ?? "floor");

  const messages = await readRoom(active);
  const accepted = hasAcceptedChatTerms(user);

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle="Rooms for members. Opinions here are not advice."
      />

      {!accepted && (
        <div className="mb-4">
          <ChatTerms version={CHAT_TERMS_VERSION} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <Card className="h-fit p-3">
          <nav className="flex flex-col gap-0.5">
            {rooms.map((r) => (
              <Link
                key={r.slug}
                href={`/chat?room=${r.slug}`}
                className={clsx(
                  "rounded-lg px-3 py-2 transition-colors",
                  // Accent = interface state, here "the room you are in".
                  r.slug === active
                    ? "bg-[var(--color-accent-wash)] text-[var(--color-ink)]"
                    : "text-[var(--color-ink-dim)] hover:bg-[var(--color-accent-wash)]",
                )}
              >
                <div className="text-[13px] font-semibold">{r.label}</div>
                {r.topic && (
                  <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                    {r.topic}
                  </div>
                )}
              </Link>
            ))}
          </nav>
        </Card>

        <Card className="p-4">
          <ChatRoom
            key={active}
            room={active}
            me={user.id}
            canPost={accepted}
            initialMessages={messages.map((m) => ({
              id: m.id,
              userId: m.userId,
              author: m.author,
              body: m.body,
              createdAt: m.createdAt.toISOString(),
              deleted: m.deleted,
            }))}
          />
        </Card>
      </div>
    </>
  );
}
