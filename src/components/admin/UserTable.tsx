"use client";

import { useState, useTransition } from "react";
import { Ban, Clock, RotateCcw, Shield } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { initials } from "@/lib/identity/profile";
import {
  ROLE_LABEL,
  assignableRoles,
  canActOn,
  canAssignRole,
  canManageRoles,
  describeStanding,
  type Role,
} from "@/lib/identity/roles";
import { banUser, reinstateUser, setUserRole, suspendUser } from "@/lib/admin/users";

/**
 * The member list.
 *
 * Rows the actor cannot touch are shown but their controls are absent, not
 * disabled-looking-clickable — including the owner, who appears so the list is
 * a true picture of who exists, and can be acted on by nobody.
 *
 * Every control here is mirrored by a server-side check. This decides what is
 * worth showing; it does not decide what is allowed.
 */

export type Row = {
  id: number;
  displayName: string;
  username: string | null;
  jobTitle: string | null;
  avatar: string | null;
  role: Role;
  status: "active" | "suspended" | "banned";
  suspendedUntil: string | null;
  statusReason: string | null;
  isOwner: boolean;
  lastSeenAt: string | null;
  messageCount: number;
};

export type Me = { id: number; role: Role; isOwner: boolean };

const SUSPEND_OPTIONS = [
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "Indefinite", days: null },
];

export function UserTable({ me, rows }: { me: Me; rows: Row[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const manageRoles = canManageRoles(me);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "That did not work.");
      else setOpen(null);
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-xs text-[var(--color-warn)]">
          {error}
        </p>
      )}

      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
          No members yet.
        </p>
      )}

      {rows.map((r) => {
        const target = { id: r.id, role: r.role, isOwner: r.isOwner };
        const actionable = canActOn(me, target);
        const standing = describeStanding({
          status: r.status,
          suspendedUntil: r.suspendedUntil ? new Date(r.suspendedUntil) : null,
        });
        const isOpen = open === r.id;

        return (
          <div
            key={r.id}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)]"
          >
            <div className="flex items-center gap-3 p-3">
              <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-sunken)]">
                {r.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatar} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-[11px] font-semibold text-[var(--color-ink-mute)]">
                    {initials(r.username ?? r.displayName)}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                    {r.username ?? r.displayName}
                  </span>
                  {r.isOwner ? (
                    <Badge>Owner</Badge>
                  ) : r.role !== "member" ? (
                    <Badge>{ROLE_LABEL[r.role]}</Badge>
                  ) : null}
                  {r.jobTitle && (
                    <span className="text-[11px] text-[var(--color-ink-faint)]">
                      {r.jobTitle}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-[var(--color-ink-faint)]">
                  <span>{r.displayName}</span>
                  <span>{r.messageCount} messages</span>
                  {/* Warn, never red: red means money in this app. */}
                  <span
                    className={clsx(
                      standing !== "Active" && "font-semibold text-[var(--color-warn)]",
                    )}
                  >
                    {standing}
                  </span>
                </div>
                {r.statusReason && standing !== "Active" && (
                  <p className="mt-1 text-[11px] italic text-[var(--color-ink-mute)]">
                    “{r.statusReason}”
                  </p>
                )}
              </div>

              {actionable ? (
                <button
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="shrink-0 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent-line)]"
                >
                  {isOpen ? "Close" : "Manage"}
                </button>
              ) : (
                <span className="shrink-0 text-[10px] text-[var(--color-ink-faint)]">
                  {r.isOwner ? "Owner" : r.id === me.id ? "You" : "Outranks you"}
                </span>
              )}
            </div>

            {isOpen && actionable && (
              <div className="space-y-4 border-t border-[var(--color-line)] p-3">
                <ManageRow
                  row={r}
                  me={me}
                  manageRoles={manageRoles}
                  pending={pending}
                  run={run}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[var(--color-accent-line)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
      {children}
    </span>
  );
}

function ManageRow({
  row,
  me,
  manageRoles,
  pending,
  run,
}: {
  row: Row;
  me: Me;
  manageRoles: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [reason, setReason] = useState("");
  const target = { id: row.id, role: row.role, isOwner: row.isOwner };
  const roles = assignableRoles(me).filter((r) => canAssignRole(me, target, r));

  return (
    <>
      <div>
        <label className="label mb-1.5 block">Reason</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          placeholder="Shown to the member, and kept on the record"
          className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 text-[13px] outline-none focus:border-[var(--color-accent-line)]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {row.status === "active" ? (
          <>
            {SUSPEND_OPTIONS.map((o) => (
              <button
                key={o.label}
                disabled={pending}
                onClick={() => run(() => suspendUser(row.id, o.days, reason))}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-warn)] disabled:opacity-40"
              >
                <Clock className="size-3" />
                Suspend {o.label}
              </button>
            ))}
            <button
              disabled={pending}
              onClick={() => run(() => banUser(row.id, reason))}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-warn)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-warn)] transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              <Ban className="size-3" />
              Ban
            </button>
          </>
        ) : (
          <button
            disabled={pending}
            onClick={() => run(() => reinstateUser(row.id, reason))}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <RotateCcw className="size-3" />
            Reinstate
          </button>
        )}
      </div>

      {manageRoles && roles.length > 0 && (
        <div>
          <label className="label mb-1.5 flex items-center gap-1.5">
            <Shield className="size-3" />
            Role
          </label>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <button
                key={r}
                disabled={pending || row.role === r}
                onClick={() => run(() => setUserRole(row.id, r))}
                className={clsx(
                  "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed",
                  row.role === r
                    ? "border-[var(--color-accent-line)] text-[var(--color-accent)] opacity-60"
                    : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent-line)]",
                )}
              >
                {ROLE_LABEL[r]}
                {row.role === r && " ·  current"}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
