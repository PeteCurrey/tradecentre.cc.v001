"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { visibleNav } from "@/lib/nav";
import { clsx } from "@/lib/clsx";

/**
 * ⌘K palette. At 24 screens this stops being a nicety — it is how you actually
 * move around without hunting the sidebar.
 *
 * Currently indexes screens only. Trades, patterns and dates get added once
 * those tables exist (Phase 2–3).
 */
export function CommandPalette({
  open,
  onClose,
  privileged = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Keeps Admin out of search for anyone who cannot open it. */
  privileged?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = visibleNav(privileged).flatMap((g) => g.items);
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q),
    );
  }, [query, privileged]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // Focus after paint, or the input isn't mounted yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-card)] shadow-2xl shadow-black/70"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-line)] px-4">
          <Search className="size-4 text-[var(--color-ink-mute)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                go(results[index].href);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Jump to a screen…"
            className="h-12 flex-1 bg-transparent text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
          />
        </div>

        <ul ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-mute)]">
              Nothing matches “{query}”
            </li>
          )}
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(item.href)}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    i === index ? "bg-[var(--color-accent-wash)]" : "hover:bg-[var(--color-card-raised)]",
                  )}
                >
                  <Icon
                    className={clsx(
                      "size-4 shrink-0",
                      i === index ? "text-[var(--color-accent)]" : "text-[var(--color-ink-faint)]",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-[var(--color-ink)]">{item.label}</span>
                    <span className="block truncate text-[11px] text-[var(--color-ink-mute)]">
                      {item.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
