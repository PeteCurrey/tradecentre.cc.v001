"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Ban, Bell, BellOff, Check, Shield, TrendingDown, TrendingUp, X } from "lucide-react";
import { usePersistedFlag } from "@/lib/stream/useAnimatedValue";
import type { EngineEvent } from "@/lib/stream/events";
import { BOOKS, type BookId } from "@/lib/books";
import { formatTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

/**
 * Engine announcements.
 *
 * Mounted in the shell rather than on the Today page, because the moment worth
 * announcing is precisely the one where you are looking at something else.
 *
 * Colour follows the rule: every toast is interface state, so orange for a
 * dry-run action, --color-warn for anything that reached the broker or was
 * refused. No green or red anywhere here — a fill is not a profit, and colouring
 * it as one would be the first crack in the only rule that makes a red number
 * unambiguous.
 */

const SOUND_KEY = "desk.engineSound";
const VISIBLE_MS = 12_000;

export function EngineToasts({
  events,
  onDismiss,
}: {
  events: EngineEvent[];
  onDismiss: (at: number) => void;
}) {
  const [soundOn, setSoundOn] = usePersistedFlag(SOUND_KEY);

  useChime(events, soundOn);

  /**
   * Auto-dismiss on a timer, EXCEPT for anything that reached the broker.
   *
   * A real order that scrolled past while you were in another tab is the one
   * message that must still be there when you look back. Dry runs and
   * near-misses expire on their own.
   */
  useEffect(() => {
    const timers = events
      .filter((e) => !e.sent)
      .map((e) =>
        setTimeout(() => onDismiss(e.at), Math.max(0, e.at + VISIBLE_MS - Date.now())),
      );
    return () => timers.forEach(clearTimeout);
  }, [events, onDismiss]);

  if (events.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col-reverse gap-2"
      role="log"
      aria-live="polite"
      aria-label="Engine activity"
    >
      {events.slice(0, 4).map((e) => (
        <Toast key={e.at} event={e} onDismiss={() => onDismiss(e.at)} />
      ))}

      <button
        onClick={() => setSoundOn(!soundOn)}
        className="pointer-events-auto ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-card-glass)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-mute)] backdrop-blur transition-colors hover:text-[var(--color-ink-dim)]"
      >
        {soundOn ? <Bell className="size-3" /> : <BellOff className="size-3" />}
        {soundOn ? "Sound on" : "Sound off"}
      </button>
    </div>
  );
}

function Toast({ event, onDismiss }: { event: EngineEvent; onDismiss: () => void }) {
  const book = BOOKS[event.book as BookId];
  const isReject = event.kind === "rejected";

  const Icon = isReject
    ? Ban
    : event.kind === "managed"
      ? Shield
      : event.kind === "fill"
        ? event.headline.startsWith("Short")
          ? TrendingDown
          : TrendingUp
        : Check;

  return (
    <div
      className={clsx(
        "toast-in pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-tile)] border bg-[var(--color-card-glass)] px-3.5 py-2.5 backdrop-blur",
        event.sent
          ? "border-[var(--color-warn)]/50 shadow-[0_0_24px_-8px_var(--color-warn)]"
          : isReject
            ? "border-[var(--color-line-strong)]"
            : "border-[var(--color-accent-line)]",
      )}
    >
      <Icon
        className={clsx(
          "mt-0.5 size-4 shrink-0",
          event.sent
            ? "text-[var(--color-warn)]"
            : isReject
              ? "text-[var(--color-ink-mute)]"
              : "text-[var(--color-accent)]",
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold">{event.headline}</span>
          <span className="label-faint shrink-0">{formatTime(new Date(event.at))}</span>
        </div>

        {event.detail && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
            {event.detail}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2">
          {book && (
            <span className="inline-flex items-center gap-1">
              <span
                className="size-1.5 rounded-full"
                style={{ background: book.colorVar }}
              />
              <span className="text-[10px] text-[var(--color-ink-faint)]">{book.label}</span>
            </span>
          )}
          {/* Says plainly whether this touched the broker. The distinction
              between a dry run and a real order is the whole safety model. */}
          <span
            className={clsx(
              "text-[10px] font-semibold uppercase tracking-wider",
              event.sent ? "text-[var(--color-warn)]" : "text-[var(--color-ink-faint)]",
            )}
          >
            {event.sent ? "sent to broker" : isReject ? "not placed" : "dry run"}
          </span>
          {event.oandaTradeId && event.sent && (
            <Link
              href="/orders"
              className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]"
            >
              Order log
            </Link>
          )}
        </div>
      </div>

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-dim)]"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * A short tone on each new engine event.
 *
 * WebAudio rather than an audio file: no asset to ship, and no decode latency
 * on the first play. Browsers refuse to start an AudioContext until the user has
 * interacted with the page, so the context is created lazily on the first event
 * and simply fails silently if the browser is not ready — a missed beep must
 * never surface as an error on a trading screen.
 */
function useChime(events: EngineEvent[], enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const lastSeen = useRef<number>(0);

  useEffect(() => {
    if (!enabled || events.length === 0) return;

    const newest = events[0];
    if (newest.at <= lastSeen.current) return;

    // On first mount `lastSeen` is 0, which would replay a chime for every
    // buffered event. Prime it instead and stay quiet until the next one.
    const priming = lastSeen.current === 0;
    lastSeen.current = newest.at;
    if (priming) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;

      const ctx = (ctxRef.current ??= new Ctor());
      if (ctx.state === "suspended") void ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      // A rejection drops in pitch, an action rises — distinguishable without
      // looking at the screen, which is the only reason to have sound at all.
      const up = newest.kind !== "rejected";
      osc.frequency.setValueAtTime(up ? 660 : 440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        up ? 880 : 330,
        ctx.currentTime + 0.09,
      );
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);

      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
    } catch {
      /* audio unavailable — the toast is the primary signal regardless */
    }
  }, [events, enabled]);

  useEffect(() => () => void ctxRef.current?.close(), []);
}
