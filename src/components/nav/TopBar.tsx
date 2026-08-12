"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AccountSwitcher } from "./AccountSwitcher";
import { SyncButton } from "./SyncButton";
import { isDemo, type Scope } from "@/lib/books";
import { SESSIONS, formatTime, isPrimeOverlap, isSessionOpen } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export type ConnectionState = "connecting" | "live" | "stale" | "offline";

export function TopBar({
  scope,
  onScopeChange,
  connection = "connecting",
}: {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  connection?: ConnectionState;
}) {
  const [now, setNow] = useState<Date | null>(null);

  // Rendered client-side only: a server-rendered clock would hydrate mismatched.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const demo = isDemo(scope);

  return (
    <header
      className={clsx(
        "flex h-14 shrink-0 items-center gap-4 border-b px-4",
        demo
          ? "border-[var(--color-warn)]/40 bg-[repeating-linear-gradient(135deg,var(--color-warn-wash)_0px,var(--color-warn-wash)_10px,transparent_10px,transparent_20px)]"
          : "border-[var(--color-line)] bg-[var(--color-sunken)]",
      )}
    >
      <AccountSwitcher scope={scope} onChange={onScopeChange} />

      {demo && (
        <span className="flex items-center gap-1.5 rounded-md bg-[var(--color-warn)] px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-black">
          <AlertTriangle className="size-3" />
          Practice account
        </span>
      )}

      <div className="flex-1" />

      <SyncButton />

      {/* Session strip */}
      <div className="hidden items-center gap-1.5 md:flex">
        {SESSIONS.map((s) => {
          const open = now ? isSessionOpen(s, now) : false;
          return (
            <span
              key={s.id}
              title={`${s.label} ${open ? "open" : "closed"}`}
              className={clsx(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                open
                  ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-faint)]",
              )}
            >
              {s.label}
            </span>
          );
        })}
        {now && isPrimeOverlap(now) && (
          <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
            Overlap
          </span>
        )}
      </div>

      <div className="h-6 w-px bg-[var(--color-line)]" />

      <div className="flex items-center gap-2">
        <ConnectionDot state={connection} />
        <span className="figure text-sm text-[var(--color-ink-dim)]">
          {now ? formatTime(now) : "--:--"}
        </span>
        <span className="label-faint hidden sm:inline">London</span>
      </div>
    </header>
  );
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const map = {
    live: { cls: "live-dot", label: "Live" },
    connecting: { cls: "bg-[var(--color-warn)]", label: "Connecting" },
    stale: { cls: "bg-[var(--color-warn)]", label: "Stale" },
    offline: { cls: "bg-[var(--color-loss)]", label: "Offline" },
  } as const;
  const { cls, label } = map[state];
  return (
    <span className="flex items-center gap-1.5" title={`Data feed: ${label}`}>
      <span className={clsx("size-1.5 rounded-full", cls)} />
      <span className="label-faint hidden lg:inline">{label}</span>
    </span>
  );
}
