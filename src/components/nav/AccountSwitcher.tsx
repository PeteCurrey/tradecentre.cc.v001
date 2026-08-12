"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FlaskConical, Layers } from "lucide-react";
import { BOOK_LIST, isDemo, scopeLabel, type Scope } from "@/lib/books";
import { clsx } from "@/lib/clsx";

/**
 * Scope selector: four live books, the All Live roll-up, or a demo account.
 *
 * Demo is deliberately hard to confuse with live — separated below a divider,
 * badged, and when active the whole top bar takes a striped demo treatment
 * (see TopBar). Mistaking demo for live is the one failure mode this structure
 * exists to prevent.
 */
export function AccountSwitcher({
  scope,
  onChange,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const demo = isDemo(scope);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
          demo
            ? "border-[var(--color-warn)] bg-[var(--color-warn-wash)] text-[var(--color-warn)]"
            : "border-[var(--color-line)] bg-[var(--color-card)] text-[var(--color-ink)] hover:border-[var(--color-line-strong)]",
        )}
      >
        {demo ? (
          <FlaskConical className="size-3.5" />
        ) : scope === "all-live" ? (
          <Layers className="size-3.5 text-[var(--color-ink-mute)]" />
        ) : (
          <span
            className="size-2 rounded-full"
            style={{ background: BOOK_LIST.find((b) => b.id === scope)?.colorVar }}
          />
        )}
        <span className="font-medium">{scopeLabel(scope)}</span>
        <ChevronDown className="size-3.5 text-[var(--color-ink-mute)]" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl shadow-black/60"
        >
          <Option
            active={scope === "all-live"}
            onClick={() => {
              onChange("all-live");
              setOpen(false);
            }}
            icon={<Layers className="size-3.5 text-[var(--color-ink-mute)]" />}
            title="All Live"
            sub="Roll-up across the four live books"
          />

          <div className="my-1 h-px bg-[var(--color-line)]" />

          {BOOK_LIST.map((book) => (
            <Option
              key={book.id}
              active={scope === book.id}
              onClick={() => {
                onChange(book.id);
                setOpen(false);
              }}
              icon={
                <span
                  className="size-2 rounded-full"
                  style={{ background: book.colorVar }}
                />
              }
              title={book.label}
              sub={book.covers}
            />
          ))}

          <div className="mt-1 border-t border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-1.5">
            <span className="label-faint text-[var(--color-warn)]">
              Practice — never counted in live stats
            </span>
          </div>

          {BOOK_LIST.map((book) => {
            const s: Scope = `demo:${book.id}`;
            return (
              <Option
                key={s}
                active={scope === s}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                icon={<FlaskConical className="size-3.5 text-[var(--color-warn)]" />}
                title={`Demo · ${book.label}`}
                sub="Incubation"
                muted
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Option({
  active,
  onClick,
  icon,
  title,
  sub,
  muted,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  muted?: boolean;
}) {
  return (
    <button
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--color-card-raised)]",
        active && "bg-[var(--color-accent-wash)]",
      )}
    >
      <span className="grid w-4 place-items-center">{icon}</span>
      <span className="flex-1">
        <span
          className={clsx(
            "block text-[13px]",
            muted ? "text-[var(--color-ink-dim)]" : "text-[var(--color-ink)]",
          )}
        >
          {title}
        </span>
        <span className="block text-[11px] text-[var(--color-ink-mute)]">{sub}</span>
      </span>
      {active && <Check className="size-3.5 text-[var(--color-accent)]" />}
    </button>
  );
}
