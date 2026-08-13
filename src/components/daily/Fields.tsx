"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { clsx } from "@/lib/clsx";

/**
 * Shared form furniture for the daily-loop screens.
 *
 * Saving is explicit rather than on every keystroke. These are reflective
 * fields — half a sentence auto-saved mid-thought is worse than a save button,
 * and a journal you can't trust to hold what you meant stops getting used.
 */

export function useSaver() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Save failed");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    });
  }

  return { save, pending, saved, error };
}

export function SaveButton({
  onClick,
  pending,
  saved,
  label = "Save",
}: {
  onClick: () => void;
  pending: boolean;
  saved: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors",
        saved
          ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
          : "bg-[var(--color-accent)] text-black hover:opacity-90",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : saved ? (
        <Check className="size-3.5" />
      ) : null}
      {saved ? "Saved" : label}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-faint">{label}</span>
      {hint && (
        <span className="mt-0.5 block text-[11px] text-[var(--color-ink-faint)]">{hint}</span>
      )}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent-line)]"
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-3 py-1.5 text-[13px] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent-line)]",
        className,
      )}
    />
  );
}

/** 1–5 pill scale. Orange because it is interface state, never money. */
export function Scale({
  value,
  onChange,
  low,
  high,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  low: string;
  high: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--color-ink-faint)]">{low}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            // Clicking the selected value clears it — an unfilled field is
            // honest, a value you can't take back is not.
            onClick={() => onChange(value === n ? null : n)}
            className={clsx(
              "size-7 rounded-md border text-xs font-semibold transition-colors",
              value === n
                ? "border-[var(--color-accent-line)] bg-[var(--color-accent)] text-black"
                : "border-[var(--color-line)] text-[var(--color-ink-mute)] hover:border-[var(--color-line-strong)]",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-[var(--color-ink-faint)]">{high}</span>
    </div>
  );
}

export function TagToggles({
  options,
  selected,
  onChange,
}: {
  options: ReadonlyArray<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() =>
              onChange(on ? selected.filter((s) => s !== o.id) : [...selected, o.id])
            }
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              on
                ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "border-[var(--color-line)] text-[var(--color-ink-mute)] hover:border-[var(--color-line-strong)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>;
}
