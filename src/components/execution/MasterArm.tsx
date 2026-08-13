"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Power, ShieldCheck, Square } from "lucide-react";
import { armAll, disarmAll, killAll, type ArmAllResult } from "@/lib/execution/actions";
import { useArmLevel } from "@/components/AppShell";
import { BOOKS, type BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

/**
 * The "Enable Auto Trading" switch.
 *
 * One control, but it cannot start real trading — `armAll` forces every book
 * into dry run, and leaving dry run is a per-book action on /engine. That
 * separation is the point: the exciting button is safe to press, and the
 * dangerous one is deliberately dull and somewhere else.
 *
 * The state shown comes from the desk push (via `useArmLevel`), not from local
 * state, so pressing this in one tab updates every other tab and a kill switch
 * pressed elsewhere is reflected here immediately.
 */
export function MasterArm({ className }: { className?: string }) {
  const router = useRouter();
  const level = useArmLevel();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ArmAllResult | null>(null);

  const armed = level === "armed" || level === "live";

  function enable() {
    setResult(null);
    startTransition(async () => {
      const res = await armAll();
      setResult(res);
      router.refresh();
    });
  }

  function disable() {
    setResult(null);
    startTransition(async () => {
      await disarmAll();
      router.refresh();
    });
  }

  function halt() {
    setResult(null);
    startTransition(async () => {
      await killAll("Kill switch pressed from the desk");
      router.refresh();
    });
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {armed ? (
          <button
            onClick={disable}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-line-strong)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Square className="size-4" />
            )}
            Disable auto trading
          </button>
        ) : (
          <button
            onClick={enable}
            disabled={pending || level === "halted"}
            className={clsx(
              "group relative inline-flex items-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all",
              "bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hot)]",
              "shadow-[0_0_24px_-6px_var(--color-accent)] hover:shadow-[0_0_32px_-4px_var(--color-accent)]",
              "disabled:opacity-40 disabled:shadow-none",
            )}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            Enable auto trading
          </button>
        )}

        {armed && (
          <button
            onClick={halt}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-warn)]/60 bg-[var(--color-warn-wash)] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-warn)] transition-colors hover:bg-[var(--color-warn)] hover:text-black"
          >
            <Power className="size-3.5" />
            Halt
          </button>
        )}

        <StatusLine level={level} />
      </div>

      {/* What actually happened. A one-click control that silently skips books
          would leave you believing the whole desk is armed when half of it
          isn't — so the skips are named, with their reasons. */}
      {result?.ok && (
        <div className="expand-in mt-2.5 rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2">
          {result.armed.length > 0 ? (
            <p className="text-[11px] text-[var(--color-ink-dim)]">
              Armed in dry run:{" "}
              <span className="text-[var(--color-accent)]">
                {result.armed.map((b) => BOOKS[b as BookId].label).join(", ")}
              </span>
              . Orders are computed and logged, never sent —{" "}
              <Link href="/engine" className="underline underline-offset-2">
                go live per book on Engine
              </Link>
              .
            </p>
          ) : (
            <p className="text-[11px] text-[var(--color-warn)]">
              Nothing was armed — no book is configured to permit anything yet.
            </p>
          )}

          {result.skipped.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 border-t border-[var(--color-line)] pt-1.5">
              {result.skipped.map((s) => (
                <li key={s.book} className="flex items-start gap-1.5 text-[11px]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--color-ink-mute)]" />
                  <span className="text-[var(--color-ink-mute)]">
                    <span className="text-[var(--color-ink-dim)]">
                      {BOOKS[s.book as BookId].label}
                    </span>{" "}
                    skipped — {s.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && !result.ok && result.error && (
        <p className="mt-2 text-[11px] text-[var(--color-warn)]">{result.error}</p>
      )}
    </div>
  );
}

function StatusLine({ level }: { level: ReturnType<typeof useArmLevel> }) {
  if (level === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-warn)]">
        <span className="size-1.5 rounded-full bg-[var(--color-warn)]" />
        Live — orders reach the broker
      </span>
    );
  }
  if (level === "armed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-dim)]">
        <span className="live-dot" />
        Armed in dry run
      </span>
    );
  }
  if (level === "halted") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-warn)]">
        <AlertTriangle className="size-3.5" />
        Halted —{" "}
        <Link href="/engine" className="underline underline-offset-2">
          clear it on Engine
        </Link>
      </span>
    );
  }
  return (
    <span className="text-[11px] text-[var(--color-ink-mute)]">
      Nothing armed. No order can be placed.
    </span>
  );
}
