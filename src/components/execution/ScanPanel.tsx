"use client";

import { useEffect, useState } from "react";
import { Ban, Check, Radar, X } from "lucide-react";
import type { ScanCandidate, ScanPush } from "@/lib/stream/events";
import { BOOKS, type BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

/**
 * What the engine is thinking between trades.
 *
 * The problem this solves: an armed engine is, almost all of the time, doing
 * nothing visible. A dashboard that shows nothing while working looks identical
 * to one that has crashed — and the whole point of arming it is confidence that
 * it is running.
 *
 * Everything here is real evaluator output. The condition strings come from
 * `describeCondition`, the met/unmet flags from the same BarContext that
 * decides live entries. Nothing is simulated to make the panel look busy: when
 * the engine truly has nothing to say, this says so.
 */
export function ScanPanel({ scan, armed }: { scan: ScanPush | null; armed: boolean }) {
  if (!armed) {
    return (
      <Empty
        title="Auto trading is off"
        body="Enable it above and the engine's scan appears here — every instrument it checks, and how close each pattern is to firing."
      />
    );
  }

  if (!scan) {
    return (
      <Empty
        title="Waiting for the first scan"
        body="The engine ticks once a minute. The first pass will appear here."
      />
    );
  }

  if (!scan.marketOpen) {
    return (
      <Empty
        title="Market closed"
        body="FX is shut from Friday evening to Sunday evening. The engine is running and will scan again when it reopens."
      />
    );
  }

  if (scan.books.length === 0) {
    return (
      <Empty
        title="Nothing armed"
        body="The scheduler is ticking, but no book currently permits an order."
      />
    );
  }

  return (
    <div>
      <ScanHeartbeat scan={scan} />

      {scan.candidates.length === 0 ? (
        <p className="mt-3 pb-1 text-center text-xs leading-relaxed text-[var(--color-ink-mute)]">
          {scan.evaluated} {scan.evaluated === 1 ? "check" : "checks"} last pass, nothing
          close.
          <br />
          Setups appear here once they are at least halfway to triggering.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {scan.candidates.map((c) => (
            <CandidateRow key={`${c.book}-${c.instrument}-${c.patternId}`} candidate={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The heartbeat: a countdown to the next tick, plus what the last one did.
 *
 * This is the part that is honestly just saying "I am alive" — so it reports
 * facts (when, how long, how many) rather than animating for its own sake.
 */
function ScanHeartbeat({ scan }: { scan: ScanPush }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, scan.nextAt - now);
  const total = Math.max(1, scan.nextAt - scan.at);
  const progress = 1 - Math.min(1, remaining / total);
  const seconds = Math.ceil(remaining / 1000);

  const R = 13;
  const circumference = 2 * Math.PI * R;

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2">
      <div className="relative shrink-0">
        <svg width={32} height={32} viewBox="0 0 32 32" aria-hidden>
          <circle
            cx={16}
            cy={16}
            r={R}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={2}
          />
          <circle
            cx={16}
            cy={16}
            r={R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform="rotate(-90 16 16)"
          />
          {/* Sweep, only while a scan is imminent — a permanently spinning
              radar would be decoration rather than information. */}
          {remaining < 3000 && (
            <line
              x1={16}
              y1={16}
              x2={16}
              y2={16 - R}
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              className="scan-sweep"
            />
          )}
        </svg>
        <Radar className="absolute inset-0 m-auto size-3 text-[var(--color-accent)]" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-[var(--color-ink-dim)]">
          Next scan in {seconds}s
        </div>
        <div className="text-[10px] text-[var(--color-ink-faint)]">
          {scan.evaluated} {scan.evaluated === 1 ? "check" : "checks"} in{" "}
          {scan.durationMs}ms · {scan.books.length}{" "}
          {scan.books.length === 1 ? "book" : "books"} armed
        </div>
      </div>
    </div>
  );
}

function CandidateRow({ candidate: c }: { candidate: ScanCandidate }) {
  const [open, setOpen] = useState(false);
  const book = BOOKS[c.book as BookId];
  const blocked = c.blockedBy !== null;
  const complete = c.met === c.total;
  const fraction = c.total > 0 ? c.met / c.total : 0;

  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "w-full rounded-[var(--radius-tile)] border px-2.5 py-2 text-left transition-colors",
          blocked
            ? "border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)]"
            : complete
              ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)]"
              : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: book?.colorVar }}
          />
          <span className="truncate text-[12px] font-medium">{c.instrument}</span>
          <span
            className={clsx(
              "rounded px-1 text-[9px] font-bold uppercase tracking-wider",
              c.direction === "long"
                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "bg-[var(--color-line)] text-[var(--color-ink-dim)]",
            )}
          >
            {c.direction}
          </span>
          <span className="ml-auto figure shrink-0 text-[11px] text-[var(--color-ink-dim)]">
            {c.met}/{c.total}
          </span>
        </div>

        <div className="mt-1 truncate text-[10px] text-[var(--color-ink-mute)]">
          {c.patternName}
        </div>

        {/* Progress toward the trigger. Orange, not green: this is interface
            state — how close a setup is — and has nothing to do with money. */}
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[var(--color-line)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${fraction * 100}%`,
              background: blocked ? "var(--color-warn)" : "var(--color-accent)",
            }}
          />
        </div>

        {blocked && (
          <div className="mt-1.5 flex items-start gap-1 text-[10px] leading-relaxed text-[var(--color-warn)]">
            <Ban className="mt-0.5 size-2.5 shrink-0" />
            <span>
              <strong>Triggered but blocked</strong> by {c.blockedBy} — {c.blockedReason}
            </span>
          </div>
        )}
      </button>

      {open && (
        <ul className="expand-in mt-1 space-y-0.5 pl-2.5">
          {c.conditions.map((cond, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 text-[10px] leading-relaxed"
            >
              {cond.met ? (
                <Check className="mt-0.5 size-2.5 shrink-0 text-[var(--color-accent)]" />
              ) : (
                <X className="mt-0.5 size-2.5 shrink-0 text-[var(--color-ink-faint)]" />
              )}
              <span
                className={
                  cond.met ? "text-[var(--color-ink-dim)]" : "text-[var(--color-ink-mute)]"
                }
              >
                {cond.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-6 text-center">
      <Radar className="mx-auto size-5 text-[var(--color-ink-faint)]" />
      <p className="mt-2 text-xs font-semibold text-[var(--color-ink-dim)]">{title}</p>
      <p className="mx-auto mt-1 max-w-[24ch] text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
        {body}
      </p>
    </div>
  );
}
