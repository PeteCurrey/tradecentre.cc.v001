"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleSlash,
  Clock,
  Crosshair,
  ExternalLink,
  Shield,
  Target,
} from "lucide-react";
import { Money, RMultiple } from "@/components/ui/Money";
import { useNow } from "@/lib/stream/useAnimatedValue";
import { BOOKS, HORIZONS, type BookId, type HorizonId } from "@/lib/books";
import { formatDateTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

/**
 * One row of the blotter, expandable.
 *
 * The expander answers three questions the table cannot fit: where the stop and
 * target were, how long it was held, and why it was taken. The third is the
 * hard one — see `Rationale` below.
 */

export type TradeRowData = {
  id: number;
  oandaTradeId: string;
  book: string;
  horizon: string | null;
  instrument: string;
  direction: "long" | "short";
  state: string;
  units: number;
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  plannedStop: number | null;
  plannedTarget: number | null;
  realizedPl: number | null;
  rMultiple: number | null;
  maeR: number | null;
  mfeR: number | null;
  spreadCost: number;
  financing: number;
  commission: number;
};

/** What the engine recorded about this trade, if the engine placed it. */
export type TradeOrigin = {
  patternName: string | null;
  patternSlug: string | null;
  patternSummary: string | null;
  /** The engine's own words at the moment of the decision. */
  reason: string | null;
  requestedStop: number | null;
  requestedTarget: number | null;
  outcome: string | null;
  decidedAt: string | null;
};

/** Peter's own note, from trade_annotations. */
export type TradeNote = {
  reasoning: string | null;
  notes: string | null;
  conviction: string | null;
  patternName: string | null;
};

export function TradeRow({
  trade: t,
  origin,
  note,
  currency,
  columns,
}: {
  trade: TradeRowData;
  origin: TradeOrigin | null;
  note: TradeNote | null;
  currency: string;
  columns: number;
}) {
  const [open, setOpen] = useState(false);
  const bookDef = BOOKS[t.book as BookId];

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "cursor-pointer border-b border-[var(--color-line)]/60 transition-colors last:border-0",
          open ? "bg-[var(--color-card-raised)]" : "hover:bg-[var(--color-card-raised)]",
        )}
      >
        <Td className="whitespace-nowrap text-[var(--color-ink-dim)]">
          <span className="flex items-center gap-1">
            <ChevronRight
              className={clsx(
                "size-3 shrink-0 transition-transform",
                open && "rotate-90",
              )}
              aria-hidden
            />
            {formatDateTime(new Date(t.entryTime))}
          </span>
        </Td>
        <Td className="font-medium">
          <span className="flex items-center gap-1.5">
            {t.instrument}
            {/* An engine-placed trade is marked, because "did I do this or did
                it?" is the first question about any row in this table. */}
            {origin && (
              <span
                className="rounded bg-[var(--color-accent-wash)] px-1 text-[9px] font-bold uppercase tracking-wider text-[var(--color-accent)]"
                title="Placed by the engine"
              >
                auto
              </span>
            )}
          </span>
        </Td>
        <Td>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: bookDef?.colorVar }}
            />
            <span className="text-[var(--color-ink-dim)]">
              {bookDef?.label ?? t.book}
            </span>
          </span>
        </Td>
        <Td>
          {t.horizon ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ background: HORIZONS[t.horizon as HorizonId].colorVar }}
              />
              <span className="text-[var(--color-ink-mute)]">
                {HORIZONS[t.horizon as HorizonId].label}
              </span>
            </span>
          ) : (
            <span className="text-[var(--color-ink-faint)]">open</span>
          )}
        </Td>
        <Td align="right">
          <span
            className={clsx(
              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              t.direction === "long"
                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "bg-[var(--color-line)] text-[var(--color-ink-dim)]",
            )}
          >
            {t.direction}
          </span>
        </Td>
        <Td align="right" className="figure text-[var(--color-ink-dim)]">
          {t.units.toLocaleString()}
        </Td>
        <Td align="right" className="figure">
          {t.entryPrice.toFixed(5)}
        </Td>
        <Td align="right" className="figure text-[var(--color-ink-dim)]">
          {t.exitPrice !== null ? t.exitPrice.toFixed(5) : "—"}
        </Td>
        <Td align="right" className="figure text-[var(--color-ink-mute)]">
          {t.plannedStop !== null ? t.plannedStop.toFixed(5) : "—"}
        </Td>
        <Td align="right">
          {t.rMultiple !== null ? (
            <RMultiple value={t.rMultiple} />
          ) : (
            <span className="text-[var(--color-ink-faint)]">—</span>
          )}
        </Td>
        <Td align="right">
          {t.realizedPl !== null ? (
            <Money value={t.realizedPl} currency={currency} />
          ) : (
            "—"
          )}
        </Td>
        <Td align="right" className="figure text-[var(--color-ink-mute)]">
          {t.spreadCost.toFixed(2)}
        </Td>
      </tr>

      {open && (
        <tr className="border-b border-[var(--color-line)]/60 bg-[var(--color-sunken)]">
          <td colSpan={columns} className="px-3 py-3">
            <div className="expand-in grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <Levels trade={t} origin={origin} currency={currency} />
              <Rationale trade={t} origin={origin} note={note} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ==========================================================================
   LEVELS — where the stop and target were, and how it actually went
   ========================================================================== */

function Levels({
  trade: t,
  origin,
  currency,
}: {
  trade: TradeRowData;
  origin: TradeOrigin | null;
  currency: string;
}) {
  const risk = t.plannedStop !== null ? Math.abs(t.entryPrice - t.plannedStop) : null;

  const rewardR =
    t.plannedTarget !== null && risk !== null && risk > 0
      ? Math.abs(t.plannedTarget - t.entryPrice) / risk
      : null;

  /**
   * An open trade's hold time keeps counting.
   *
   * `useNow` rather than `Date.now()` inline: a clock read during render is
   * impure, and this one is genuinely live — the duration on an open position
   * should tick up while you are looking at it. Returns 0 on the server, where
   * there is no meaningful "now", so that case renders without a duration.
   */
  const now = useNow();
  const holdMs = t.exitTime
    ? new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()
    : now > 0
      ? now - new Date(t.entryTime).getTime()
      : null;

  return (
    <div>
      <h4 className="label mb-2">Levels &amp; hold</h4>

      <dl className="space-y-1.5 text-[12px]">
        <Level
          icon={<Crosshair className="size-3" />}
          label="Entry"
          value={t.entryPrice.toFixed(5)}
          note={formatDateTime(new Date(t.entryTime))}
        />

        <Level
          icon={<Shield className="size-3" />}
          label="Stop loss"
          value={t.plannedStop !== null ? t.plannedStop.toFixed(5) : "None recorded"}
          tone={t.plannedStop === null ? "muted" : "warn"}
          note={
            risk !== null
              ? `${risk.toFixed(5)} away · this is the 1R the trade was sized on`
              : "Without a stop there is no R denominator for this trade"
          }
        />

        <Level
          icon={<Target className="size-3" />}
          label="Take profit"
          value={
            t.plannedTarget !== null ? t.plannedTarget.toFixed(5) : "None attached"
          }
          tone={t.plannedTarget === null ? "muted" : "accent"}
          note={
            t.plannedTarget !== null
              ? rewardR !== null
                ? `${rewardR.toFixed(2)}R reward · ${Math.abs(t.plannedTarget - t.entryPrice).toFixed(5)} away`
                : null
              : origin
                ? "The pattern defined no first target — this ran stop-only, exiting on its management rules"
                : "No take-profit order was attached"
          }
        />

        {t.exitPrice !== null && (
          <Level
            icon={<CircleSlash className="size-3" />}
            label="Exit"
            value={t.exitPrice.toFixed(5)}
            note={exitDescription(t)}
          />
        )}

        <Level
          icon={<Clock className="size-3" />}
          label="Hold time"
          value={holdMs !== null ? formatDuration(holdMs) : "—"}
          note={
            t.exitTime
              ? `${formatDateTime(new Date(t.entryTime))} → ${formatDateTime(new Date(t.exitTime))}`
              : "Still open"
          }
        />
      </dl>

      {/* Excursion, when derivation captured it. MAE is the number that tells
          you whether the stop was ever genuinely threatened. */}
      {(t.maeR !== null || t.mfeR !== null) && (
        <div className="mt-2.5 flex gap-4 border-t border-[var(--color-line)] pt-2">
          {t.maeR !== null && (
            <div>
              <span className="label-faint">Worst point</span>
              <div className="figure text-[12px] text-[var(--color-ink-dim)]">
                {t.maeR.toFixed(2)}R
              </div>
            </div>
          )}
          {t.mfeR !== null && (
            <div>
              <span className="label-faint">Best point</span>
              <div className="figure text-[12px] text-[var(--color-ink-dim)]">
                {t.mfeR.toFixed(2)}R
              </div>
            </div>
          )}
        </div>
      )}

      {/* Costs, broken out. Spread was three quarters of the net loss on this
          account, so it is never folded silently into P&L. */}
      <div className="mt-2.5 flex flex-wrap gap-4 border-t border-[var(--color-line)] pt-2">
        <Cost label="Spread" value={t.spreadCost} currency={currency} />
        <Cost label="Financing" value={t.financing} currency={currency} />
        <Cost label="Commission" value={t.commission} currency={currency} />
      </div>
    </div>
  );
}

function exitDescription(t: TradeRowData): string {
  if (t.exitPrice === null) return "";
  const near = (a: number, b: number) => Math.abs(a - b) < Math.abs(b) * 1e-4;

  // Stated as "at the stop", not "stopped out" — this compares prices after the
  // fact and cannot know which order actually filled.
  if (t.plannedStop !== null && near(t.exitPrice, t.plannedStop)) {
    return "Closed at or very near the stop";
  }
  if (t.plannedTarget !== null && near(t.exitPrice, t.plannedTarget)) {
    return "Closed at or very near the target";
  }
  return "Closed away from both the stop and the target";
}

function Level({
  icon,
  label,
  value,
  note,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: string | null;
  tone?: "default" | "warn" | "accent" | "muted";
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={clsx(
          "mt-0.5 shrink-0",
          tone === "warn"
            ? "text-[var(--color-warn)]"
            : tone === "accent"
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-ink-faint)]",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="label-faint">{label}</dt>
          <dd
            className={clsx(
              "figure text-[12px]",
              tone === "muted" ? "text-[var(--color-ink-mute)]" : "text-[var(--color-ink)]",
            )}
          >
            {value}
          </dd>
        </div>
        {note && (
          <p className="text-[10px] leading-relaxed text-[var(--color-ink-mute)]">{note}</p>
        )}
      </div>
    </div>
  );
}

function Cost({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div>
      <span className="label-faint">{label}</span>
      <div className="figure text-[12px] text-[var(--color-ink-dim)]">
        {value.toLocaleString("en-GB", {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}

/* ==========================================================================
   RATIONALE — why this trade exists
   ========================================================================== */

/**
 * The "why".
 *
 * Three sources, in descending order of authority:
 *
 *   1. THE ORDER LOG — what the engine actually decided, recorded at the moment
 *      it decided it. This is the only genuinely reliable account of intent.
 *   2. PETER'S ANNOTATION — written after the fact, but written by the person
 *      who took the trade.
 *   3. NOTHING.
 *
 * Case 3 says so plainly. It is tempting to fill the gap by matching the trade
 * against the pattern library retrospectively, and that would look far better
 * than an empty panel — but a reconstructed rationale displayed beside a
 * recorded one is indistinguishable from it, and the entire value of this panel
 * is that what it says about a trade is true.
 */
function Rationale({
  trade: t,
  origin,
  note,
}: {
  trade: TradeRowData;
  origin: TradeOrigin | null;
  note: TradeNote | null;
}) {
  const hasAnything = origin !== null || note?.reasoning || note?.notes;

  return (
    <div>
      <h4 className="label mb-2">Why this trade</h4>

      {!hasAnything && (
        <div className="rounded-[var(--radius-tile)] border border-dashed border-[var(--color-line-strong)] px-3 py-4 text-center">
          <p className="text-[12px] text-[var(--color-ink-mute)]">No recorded reason.</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
            This trade predates the engine or was placed by hand, and no note was
            written. Nothing here is inferred — a guessed rationale would be
            indistinguishable from a real one.
          </p>
          <Link
            href={`/trades/${t.id}`}
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]"
          >
            Add one <ExternalLink className="size-2.5" />
          </Link>
        </div>
      )}

      {origin && (
        <div className="rounded-[var(--radius-tile)] border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
              Engine decision
            </span>
            {origin.decidedAt && (
              <span className="label-faint">
                {formatDateTime(new Date(origin.decidedAt))}
              </span>
            )}
          </div>

          {origin.patternName && (
            <p className="mt-1.5 text-[13px] font-semibold">
              {origin.patternSlug ? (
                <Link
                  href={`/patterns/${origin.patternSlug}`}
                  className="hover:text-[var(--color-accent)]"
                >
                  {origin.patternName}
                </Link>
              ) : (
                origin.patternName
              )}
            </p>
          )}

          {origin.patternSummary && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
              {origin.patternSummary}
            </p>
          )}

          {origin.reason && (
            <p className="mt-1.5 border-t border-[var(--color-accent-line)] pt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
              <span className="text-[var(--color-ink-mute)]">Logged reason: </span>
              {origin.reason}
            </p>
          )}

          {/* What the engine ASKED for, next to what the ledger recorded. A
              difference between the two is slippage or a broker adjustment,
              and it is worth being able to see it. */}
          {(origin.requestedStop !== null || origin.requestedTarget !== null) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-accent-line)] pt-1.5">
              {origin.requestedStop !== null && (
                <Requested
                  label="Stop requested"
                  requested={origin.requestedStop}
                  actual={t.plannedStop}
                />
              )}
              {origin.requestedTarget !== null && (
                <Requested
                  label="Target requested"
                  requested={origin.requestedTarget}
                  actual={t.plannedTarget}
                />
              )}
            </div>
          )}
        </div>
      )}

      {(note?.reasoning || note?.notes) && (
        <div
          className={clsx(
            "rounded-[var(--radius-tile)] border border-[var(--color-line)] px-3 py-2.5",
            origin && "mt-2",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-dim)]">
              Your note
            </span>
            {note.conviction && (
              <span className="label-faint">conviction {note.conviction}</span>
            )}
            {note.patternName && (
              <span className="label-faint">{note.patternName}</span>
            )}
          </div>
          {note.reasoning && (
            <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
              {note.reasoning}
            </p>
          )}
          {note.notes && (
            <p className="mt-1.5 whitespace-pre-wrap border-t border-[var(--color-line)] pt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
              {note.notes}
            </p>
          )}
        </div>
      )}

      <Link
        href={`/trades/${t.id}`}
        className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-accent)]"
      >
        Full trade, with chart <ExternalLink className="size-2.5" />
      </Link>
    </div>
  );
}

function Requested({
  label,
  requested,
  actual,
}: {
  label: string;
  requested: number;
  actual: number | null;
}) {
  const differs = actual !== null && Math.abs(actual - requested) > Math.abs(requested) * 1e-6;
  return (
    <div>
      <span className="label-faint">{label}</span>
      <div className="figure text-[11px] text-[var(--color-ink-dim)]">
        {requested.toFixed(5)}
        {differs && (
          <span className="ml-1 text-[var(--color-warn)]">
            → filled {actual.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   HELPERS
   ========================================================================== */

function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={clsx(
        "px-3 py-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
