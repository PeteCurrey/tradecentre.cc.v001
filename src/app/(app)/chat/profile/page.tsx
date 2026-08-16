import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { usernameHistory } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/Page";
import { Card, CardHeader } from "@/components/ui/Card";
import { ProfileEditor } from "@/components/chat/ProfileEditor";
import { currentUser, hasCompletedChatOnboarding } from "@/lib/identity/user";
import { usernameCooldownRemaining } from "@/lib/identity/profile";

export const dynamic = "force-dynamic";

/**
 * Chat profile.
 *
 * Lives under /chat rather than in Settings because it is chat-only: nothing
 * here affects the trading side of the app, and Settings is about accounts,
 * books and risk.
 */
export default async function ChatProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fchat%2Fprofile");
  // Nothing to edit before the wizard has run, and the wizard is where these
  // fields get set in the first place.
  if (!hasCompletedChatOnboarding(user)) redirect("/chat");

  const previous = await db
    .select({
      username: usernameHistory.username,
      releasedAt: usernameHistory.releasedAt,
    })
    .from(usernameHistory)
    .where(eq(usernameHistory.userId, user.id))
    .orderBy(desc(usernameHistory.releasedAt))
    .limit(10);

  return (
    <>
      <PageHeader
        title="Chat profile"
        subtitle="How you appear to other members."
        action={
          <Link
            href="/chat"
            className="flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-mute)] hover:text-[var(--color-ink-dim)]"
          >
            <ChevronLeft className="size-3.5" />
            Back to chat
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <Card className="p-5">
          <ProfileEditor
            initialUsername={user.username ?? ""}
            initialJobTitle={user.jobTitle ?? ""}
            initialAvatar={user.avatar}
            cooldownDays={usernameCooldownRemaining(user.usernameChangedAt)}
          />
        </Card>

        {previous.length > 0 && (
          <Card className="h-fit p-5">
            <CardHeader title="Previous names" />
            {/* Shown to the member because it is their own record, and because
                a name they used before is one other people may still know them
                by. It is also what a moderator would be looking at. */}
            <ul className="mt-3 space-y-2">
              {previous.map((p) => (
                <li
                  key={`${p.username}-${p.releasedAt.toISOString()}`}
                  className="flex items-baseline justify-between gap-4 text-[13px]"
                >
                  <span className="text-[var(--color-ink-dim)]">{p.username}</span>
                  <span className="tabular-nums text-[11px] text-[var(--color-ink-faint)]">
                    until{" "}
                    {p.releasedAt.toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "Europe/London",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
