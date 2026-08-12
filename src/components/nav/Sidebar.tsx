"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Command, LogOut } from "lucide-react";
import { NAV, activeHref } from "@/lib/nav";
import { clsx } from "@/lib/clsx";

const STORAGE_KEY = "sidebar.collapsed-groups";

/**
 * Grouped collapsible sidebar.
 *
 * The reference design uses a flat four-tab top bar; that does not survive 24
 * screens, so the navigation model diverges while the visual language stays.
 */
export function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = activeHref(pathname);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* first run, or storage unavailable — defaults are fine */
    }
  }, []);

  function toggle(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }

  return (
    <nav
      aria-label="Main"
      className="flex h-full w-[228px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-sunken)]"
    >
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="grid size-7 place-items-center rounded-lg bg-[var(--color-accent)]">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
            <path
              d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
              fill="#000"
              fillOpacity={0.85}
            />
          </svg>
        </div>
        <span className="display text-sm tracking-wide">Desk</span>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2.5 py-1.5 text-left text-xs text-[var(--color-ink-mute)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink-dim)]"
        >
          <Command className="size-3.5" />
          <span className="flex-1">Jump to…</span>
          <kbd className="figure rounded border border-[var(--color-line)] px-1 text-[10px]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          return (
            <div key={group.id} className="mb-1">
              <button
                onClick={() => toggle(group.id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-card)]"
              >
                <ChevronDown
                  className={clsx(
                    "size-3 text-[var(--color-ink-faint)] transition-transform duration-200",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <span className="label-faint">{group.label}</span>
              </button>

              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = current === item.href;
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          className={clsx(
                            "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                            isActive
                              ? "bg-[var(--color-accent-wash)] text-[var(--color-ink)]"
                              : "text-[var(--color-ink-dim)] hover:bg-[var(--color-card)] hover:text-[var(--color-ink)]",
                          )}
                        >
                          {isActive && (
                            <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--color-accent)]" />
                          )}
                          <Icon
                            className={clsx(
                              "size-4 shrink-0",
                              isActive
                                ? "text-[var(--color-accent)]"
                                : "text-[var(--color-ink-faint)] group-hover:text-[var(--color-ink-mute)]",
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-[var(--color-line)] p-2">
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
            router.refresh();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--color-ink-mute)] transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-ink-dim)]"
        >
          <LogOut className="size-4 shrink-0" />
          Sign out
        </button>
      </div>
    </nav>
  );
}
