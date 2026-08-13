import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { BOOKS, BOOK_IDS, type BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

/** Book filter shared by every analytics screen, so they all scope the same way. */
export function BookFilter({
  base,
  active,
  extra = "",
}: {
  base: string;
  active: BookId | undefined;
  /** Additional query string to preserve, e.g. "&window=90". */
  extra?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="label-faint mr-1">Book</span>
      <Chip href={`${base}${extra ? `?${extra.replace(/^&/, "")}` : ""}`} active={!active} label="All live" />
      {BOOK_IDS.map((b) => (
        <Chip
          key={b}
          href={`${base}?book=${b}${extra}`}
          active={active === b}
          label={BOOKS[b].label}
          dot={BOOKS[b].colorVar}
        />
      ))}
    </div>
  );
}

export function Chip({
  href,
  active,
  label,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  dot?: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
          : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]",
      )}
    >
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
      {label}
    </Link>
  );
}

/**
 * The clustering caveat, shown on every screen that reports a rate or an average.
 *
 * Peter's ledger is dominated by baskets closed in a single minute. Fifty
 * positions shut together is one outcome, not fifty samples, and every win rate
 * and expectancy on the page is really describing the smaller number. Saying so
 * once per screen is the difference between a statistic and a misleading one.
 */
export function ClusterNote({
  trades,
  independentExits,
}: {
  trades: number;
  independentExits: number;
}) {
  if (trades === 0 || independentExits >= trades * 0.5) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
      <p className="text-xs leading-relaxed text-[var(--color-warn)]">
        <strong>
          {trades} trades, but only {independentExits} independent exits.
        </strong>{" "}
        Positions closed in the same minute are one decision expressed as several tickets.
        Read every rate and average on this page as describing roughly{" "}
        {independentExits} outcomes, not {trades}.
      </p>
    </div>
  );
}

/**
 * Shown whenever the figures on a money screen are practice money.
 *
 * No live OANDA account is connected yet, so the analytics loader falls back to
 * the practice books rather than rendering every screen empty. That is the one
 * path by which demo results could be read as live, so every screen that makes
 * a money claim says so out loud instead of relying on the reader to remember.
 */
export function PracticeNote({ environment }: { environment: "live" | "practice" }) {
  if (environment === "live") return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
      <p className="text-xs leading-relaxed text-[var(--color-warn)]">
        <strong>These are practice figures.</strong> No live OANDA account is connected, so
        every number on this page comes from the demo books. Demo never aggregates with live
        — once a live account is mapped, these figures will not be included in it.
      </p>
    </div>
  );
}

/** Shown when a screen has no data rather than rendering zeroed-out charts. */
export function NoTrades({ what }: { what: string }) {
  return (
    <div className="rounded-[var(--radius-tile)] border border-dashed border-[var(--color-line-strong)] px-6 py-10 text-center">
      <p className="text-sm text-[var(--color-ink-mute)]">{what}</p>
      <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
        Run{" "}
        <code className="figure text-[var(--color-accent)]">npm run sync</code> to pull the
        ledger from OANDA, or use the sync button in the top bar.
      </p>
    </div>
  );
}
