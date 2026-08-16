import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { ChatWizard } from "@/components/chat/ChatWizard";
import { ChatToggle } from "@/components/chat/ChatToggle";
import { listRooms, readRoom, roomExists } from "@/lib/chat/rooms";
import {
  CHAT_TERMS_VERSION,
  canUseChat,
  currentUser,
  hasCompletedChatOnboarding,
} from "@/lib/identity/user";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Chat.
 *
 * The first screen in this app that assumes more than one person exists.
 * Identity comes from drawdown.trading via /api/auth/sso; Peter's own password
 * login resolves to an ordinary user row, so there is no special case here.
 *
 * ── First visit is the wizard, and only the wizard ────────────────────────
 * No rooms, no message list, nothing to skip to. Three documents have to be
 * acknowledged and a profile chosen before this screen becomes a chat at all.
 * A member who has been through it and then switched chat off sees the rooms
 * read-only rather than the wizard again — acceptance already happened, and
 * asking twice would imply otherwise.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fchat");

  if (!hasCompletedChatOnboarding(user)) {
    return (
      <>
        <PageHeader
          title="Chat"
          subtitle="A few things to read before you join."
        />
        <ChatWizard version={CHAT_TERMS_VERSION} fallbackName={user.displayName} />
      </>
    );
  }

  const rooms = await listRooms();
  const { room: requested } = await searchParams;

  const active =
    requested && (await roomExists(requested)) ? requested : (rooms[0]?.slug ?? "floor");

  const messages = await readRoom(active);

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle="Rooms for members. Opinions here are not advice."
        action={
          <div className="flex items-center gap-4">
            <Link
              href="/chat/profile"
              className="text-xs font-semibold text-[var(--color-ink-mute)] hover:text-[var(--color-ink-dim)]"
            >
              Edit profile
            </Link>
            <ChatToggle enabled={user.chatEnabled} username={user.username ?? ""} />
          </div>
        }
      />

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
            canPost={canUseChat(user)}
            initialMessages={messages.map((m) => ({
              id: m.id,
              userId: m.userId,
              author: m.author,
              jobTitle: m.jobTitle,
              avatar: m.avatar,
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
