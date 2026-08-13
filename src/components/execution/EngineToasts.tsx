"use client";

import Link from "next/link";
import { AlertTriangle, Ban, CheckCircle2, Power, ShieldCheck, X } from "lucide-react";
import type { EngineEvent } from "@/lib/stream/events";
import { clsx } from "@/lib/clsx";

/**
 * Engine notifications, shown on every page.
 *
 * The engine can act while Peter is looking at any screen, so what it did has
 * to reach him wherever he is rather than only on the order log.
 *
 * Two rules about how these are presented:
 *
 *   • DRY RUN IS LABELLED, ALWAYS. A dry-run order and a real one produce the
 *     same headline from the same code path, and the only thing distinguishing
 *     them is whether it actually reached the broker. Anything not sent says so
 *     in the toast, so "the engine bought gold" can never be misread.
 *   • NOTHING AUTO-DISMISSES. A toast that fades after five seconds is one you
 *     will miss while reading a chart, and the whole point is that the engine's
 *     actions are seen. They stay until dismissed.
 *
 * Colour follows the app's rule: orange for interface and engine state, warn
 * amber for refusals and halts, and green/red reserved for money — which is why
 * a fill is announced in accent, not in profit-green.
 */

const STYLES: Record<
  EngineEvent["kind"],
  { icon: typeof CheckCircle2; tone: "accent" | "warn" | "neutral" }
> = {
  fill: { icon: CheckCircle2, tone: "accent" },
  managed: { icon: ShieldCheck, tone: "accent" },
  armed: { icon: ShieldCheck, tone: "accent" },
  dry_run: { icon: CheckCircle2, tone: "neutral" },
  rejected: { icon: Ban, tone: "warn" },
  disarmed: { icon: Power, tone: "neutral" },
  halted: { icon: AlertTriangle, tone: "warn" },
};

export function EngineToasts({
  events,
  onDismiss,
}: {
  events: EngineEvent[];
  onDismiss: (at: number) => void;
}) {
  if (events.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {/* Newest at the bottom, nearest the eye. */}
      {events.slice(-5).map((e) => {
        const style = STYLES[e.kind] ?? STYLES.managed;
        const Icon = style.icon;

        return (
          <div
            key={`${e.at}-${e.kind}-${e.instrument ?? ""}`}
            className={clsx(
              "pointer-events-auto rounded-[var(--radius-tile)] border bg-[var(--color-card)] px-3.5 py-2.5 shadow-lg",
              style.tone === "warn"
                ? "border-[var(--color-warn)]/50"
                : style.tone === "accent"
                  ? "border-[var(--color-accent-line)]"
                  : "border-[var(--color-line-strong)]",
            )}
          >
            <div className="flex items-start gap-2.5">
              <Icon
                className={clsx(
                  "mt-0.5 size-4 shrink-0",
                  style.tone === "warn"
                    ? "text-[var(--color-warn)]"
                    : style.tone === "accent"
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-ink-mute)]",
                )}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{e.headline}</span>
                  {!e.sent && (
                    <span className="shrink-0 rounded bg-[var(--color-line)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-dim)]">
                      not sent
                    </span>
                  )}
                </div>

                {e.detail && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
                    {e.detail}
                  </p>
                )}

                <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-ink-faint)]">
                  <span>{new Date(e.at).toLocaleTimeString("en-GB")}</span>
                  <span>{e.book}</span>
                  {e.instrument && <span>{e.instrument}</span>}
                  {e.patternName && <span>{e.patternName}</span>}
                  <Link
                    href="/orders"
                    className="ml-auto hover:text-[var(--color-accent)]"
                  >
                    order log
                  </Link>
                </div>
              </div>

              <button
                onClick={() => onDismiss(e.at)}
                className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
