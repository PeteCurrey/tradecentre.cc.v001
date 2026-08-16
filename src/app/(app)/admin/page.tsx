import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/Page";
import { Card, CardHeader } from "@/components/ui/Card";
import { UserTable } from "@/components/admin/UserTable";
import { listModerationLog, listUsers } from "@/lib/admin/users";
import { currentUser } from "@/lib/identity/user";
import { ROLE_DESCRIPTION, ROLE_LABEL, canOpenDashboard, canManageRoles } from "@/lib/identity/roles";

export const dynamic = "force-dynamic";

/**
 * Admin and moderation.
 *
 * ── notFound(), not a redirect and not an error ───────────────────────────
 * Someone without the rank should not learn that this screen exists. A
 * redirect to /login says "there is something here"; a 403 says the same
 * louder. A 404 is the same answer they would get for any path that is not a
 * page, which is exactly what this should be for them.
 *
 * The nav entry is hidden from members for the same reason, but this is the
 * check — hiding a link protects nobody.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await currentUser();
  if (!me || !canOpenDashboard(me)) notFound();

  const { q } = await searchParams;
  const [rows, log] = await Promise.all([listUsers(q), listModerationLog(30)]);

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle={
          me.isOwner
            ? "Owner — full control."
            : `${ROLE_LABEL[me.role]} — ${ROLE_DESCRIPTION[me.role]}`
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Card className="p-4">
            <CardHeader
              title="Members"
              action={
                <span className="label-faint text-[11px]">
                  {rows.length} {rows.length === 1 ? "person" : "people"}
                </span>
              }
            />

            {/* A plain GET form — search survives a reload and is linkable,
                which matters when someone is sent a link to a member. */}
            <form className="mt-3" action="/admin">
              <input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search by username, name or Drawdown id"
                className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 text-[13px] outline-none focus:border-[var(--color-accent-line)]"
              />
            </form>

            <div className="mt-3">
              <UserTable
                me={{ id: me.id, role: me.role, isOwner: me.isOwner }}
                rows={rows.map((r) => ({
                  id: r.id,
                  displayName: r.displayName,
                  username: r.username,
                  jobTitle: r.jobTitle,
                  avatar: r.avatar,
                  role: r.role,
                  status: r.status,
                  suspendedUntil: r.suspendedUntil?.toISOString() ?? null,
                  statusReason: r.statusReason,
                  isOwner: r.isOwner,
                  lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
                  messageCount: r.messageCount,
                }))}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {canManageRoles(me) && (
            <Card className="h-fit p-4">
              <CardHeader title="What the roles do" />
              <dl className="mt-3 space-y-2.5">
                {(["moderator", "staff", "admin"] as const).map((r) => (
                  <div key={r}>
                    <dt className="text-[12px] font-semibold text-[var(--color-ink)]">
                      {ROLE_LABEL[r]}
                    </dt>
                    <dd className="text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
                      {ROLE_DESCRIPTION[r]}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                You can only act on someone below you, and only grant a role
                below your own. The owner cannot be demoted, sanctioned, or
                acted on by anyone.
              </p>
            </Card>
          )}

          <Card className="h-fit p-4">
            <CardHeader title="Recent actions" />
            {log.length === 0 ? (
              <p className="mt-3 text-[12px] text-[var(--color-ink-mute)]">
                Nothing yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {log.map((e) => (
                  <li key={e.id} className="text-[11px] leading-relaxed">
                    <div className="text-[var(--color-ink-dim)]">
                      <span className="font-semibold">{e.actorName ?? "Removed"}</span>{" "}
                      {describeAction(e.action, e.detail)}{" "}
                      <span className="font-semibold">{e.targetName}</span>
                    </div>
                    {e.reason && (
                      <div className="italic text-[var(--color-ink-faint)]">
                        “{e.reason}”
                      </div>
                    )}
                    <div className="tabular-nums text-[var(--color-ink-faint)]">
                      {e.createdAt.toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/London",
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function describeAction(action: string, detail: Record<string, unknown>): string {
  switch (action) {
    case "suspend":
      return detail.until === "indefinite"
        ? "suspended indefinitely"
        : "suspended";
    case "unsuspend":
      return "lifted the suspension on";
    case "ban":
      return "banned";
    case "unban":
      return "unbanned";
    case "role_change":
      return `changed the role of`;
    case "message_delete":
      return "removed a message from";
    default:
      return action;
  }
}
