"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import { useNow } from "@/lib/stream/useAnimatedValue";
import { CATEGORY_LABEL, SOURCE_LABEL, WireItem, type WireRow } from "./WireItem";

/**
 * The wire.
 *
 * ── The ordering contract ─────────────────────────────────────────────────
 * Always `published_at desc`, unconditionally, and nothing in this component
 * may change that. Filters narrow WHAT is shown; they never reorder it, and
 * importance drives emphasis only.
 *
 * The reason is worth stating, because "put the important ones on top" is the
 * obvious feature request: a feed that rearranges itself is one you cannot
 * trust to have shown you something. If order is fixed, then scrolling to a
 * timestamp you have already read means you are up to date — and absence
 * becomes meaningful. Ranking destroys that property.
 *
 * ── Polling ───────────────────────────────────────────────────────────────
 * Server state is authoritative; this refetches on an interval and replaces
 * what it has. New ids are marked so they can be seen arriving, which is the
 * one place the accent colour is used here.
 */

const POLL_MS = 60_000;

export type WireFilter = {
  sources?: string[];
  categories?: string[];
  instruments?: string[];
};

function query(filter: WireFilter, limit: number): string {
  const p = new URLSearchParams({ limit: String(limit) });
  if (filter.sources?.length) p.set("sources", filter.sources.join(","));
  if (filter.categories?.length) p.set("categories", filter.categories.join(","));
  if (filter.instruments?.length) p.set("instruments", filter.instruments.join(","));
  return p.toString();
}

export function Wire({
  initialItems,
  limit = 100,
  compact = false,
  filter: externalFilter,
  showFilters = false,
  className,
}: {
  initialItems: WireRow[];
  limit?: number;
  compact?: boolean;
  /** Fixed filter, used by the Today panel. Ignored when showFilters is on. */
  filter?: WireFilter;
  showFilters?: boolean;
  className?: string;
}) {
  const [items, setItems] = useState<WireRow[]>(initialItems);
  const [sources, setSources] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Ticks once a second so ages count up without refetching.
  const now = useNow(1000);

  const filter = useMemo<WireFilter>(
    () => (showFilters ? { sources, categories } : (externalFilter ?? {})),
    [showFilters, sources, categories, externalFilter],
  );

  /**
   * Ids present on the previous poll. Anything not in here is new, which is
   * what the accent marker keys off. Held in a ref because marking an item as
   * seen must not itself trigger a render.
   */
  const seen = useRef<Set<string>>(new Set(initialItems.map((i) => i.id)));
  const [arrived, setArrived] = useState<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?${query(filter, limit)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { items: WireRow[] };

      const fresh = data.items.filter((i) => !seen.current.has(i.id));
      if (fresh.length) {
        setArrived(new Set(fresh.map((i) => i.id)));
        for (const i of fresh) seen.current.add(i.id);
      }
      setItems(data.items);
      setError(null);
    } catch (e) {
      // Shown, not swallowed: a wire that has silently stopped updating looks
      // exactly like a quiet news day, and those must never be confusable.
      setError((e as Error).message);
    }
  }, [filter, limit]);

  useEffect(() => {
    // Immediate fetch on a filter change, then resume the interval.
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const toggle = (
    value: string,
    current: string[],
    set: (next: string[]) => void,
  ) => set(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);

  return (
    <div className={clsx("flex min-h-0 flex-col", className)}>
      {showFilters && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(SOURCE_LABEL).map(([key, label]) => (
            <FilterChip
              key={key}
              label={label}
              active={sources.includes(key)}
              onClick={() => toggle(key, sources, setSources)}
            />
          ))}
          <span className="mx-1 w-px self-stretch bg-[var(--color-line)]" />
          {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
            <FilterChip
              key={key}
              label={label}
              active={categories.includes(key)}
              onClick={() => toggle(key, categories, setCategories)}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="mb-2 text-xs text-[var(--color-warn)]">
          Feed not updating — {error}. Showing the last items received.
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
          {sources.length || categories.length
            ? "Nothing matches these filters."
            : "No feed items stored yet. The wire fills on the first refresh."}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--color-line)] overflow-y-auto">
          {items.map((item) => (
            <WireItem
              key={item.id}
              item={item}
              now={now}
              compact={compact}
              isNew={arrived.has(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
        // Accent = selected. Interface state, not money.
        active
          ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
          : "border-[var(--color-line)] text-[var(--color-ink-mute)] hover:text-[var(--color-ink-dim)]",
      )}
    >
      {label}
    </button>
  );
}
