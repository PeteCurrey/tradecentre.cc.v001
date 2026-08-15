"use client";

import { ExternalLink } from "lucide-react";
import { clsx } from "@/lib/clsx";

/**
 * One line of the wire.
 *
 * Shared by the Today panel and the full screen so the two can never drift into
 * showing the same story differently.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 * Green and red mean money in this app and nothing else, so neither appears
 * here — a red headline would read as a loss. Importance is carried by
 * `--color-warn` and by weight; the accent marks interface state (unread,
 * selected) as it does everywhere else.
 */

export type WireRow = {
  id: string;
  source: string;
  category: string;
  /** Serialised over JSON from the poll, so a string in the browser. */
  publishedAt: string | Date;
  headline: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  tickers: string[];
  instruments: string[];
  importance: number | null;
};

export const SOURCE_LABEL: Record<string, string> = {
  polygon: "Polygon",
  finnhub: "Finnhub",
  fed: "Fed",
  sec: "SEC",
  macro: "Calendar",
};

export const CATEGORY_LABEL: Record<string, string> = {
  news: "News",
  central_bank: "Central bank",
  economic: "Economic",
  filing: "Filing",
};

/**
 * Elapsed time, not a clock time.
 *
 * On a feed you are asking "is this current?", and "4m" answers it directly
 * where "14:32" makes you do the subtraction. The full timestamp goes in the
 * title attribute for when the exact moment matters.
 */
export function age(from: Date, now: number): string {
  const secs = Math.max(0, Math.round((now - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function WireItem({
  item,
  now,
  compact = false,
  isNew = false,
}: {
  item: WireRow;
  now: number;
  /** The Today panel drops the summary and the source row to fit its column. */
  compact?: boolean;
  /** Arrived on the latest poll — washed in accent so you see it land. */
  isNew?: boolean;
}) {
  const published = new Date(item.publishedAt);
  const high = item.importance === 3;

  const body = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="shrink-0 tabular-nums text-[11px] text-[var(--color-ink-mute)]"
            title={published.toLocaleString("en-GB", { timeZone: "Europe/London" })}
          >
            {age(published, now)}
          </span>
          <span
            className={clsx(
              "min-w-0 text-[13px] leading-snug",
              high ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-dim)]",
            )}
          >
            {item.headline}
          </span>
          {item.url && !compact && (
            <ExternalLink className="mt-0.5 size-3 shrink-0 text-[var(--color-ink-faint)]" />
          )}
        </div>

        {!compact && item.summary && (
          <p className="mt-1 line-clamp-2 pl-8 text-xs text-[var(--color-ink-mute)]">
            {item.summary}
          </p>
        )}

        {(item.instruments.length > 0 || !compact) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8">
            {!compact && (
              <span className="label-faint text-[10px]">
                {SOURCE_LABEL[item.source] ?? item.source}
              </span>
            )}
            {item.instruments.map((i) => (
              <span
                key={i}
                className="rounded border border-[var(--color-line)] bg-[var(--color-card)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-ink-dim)]"
              >
                {i.replace("_", "/")}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right-hand thumbnail, so the time gutter and headline keep a straight
          left edge whether or not a story has artwork. Most rows have none —
          SEC, Fed and calendar items never do — and the row must not look
          broken when it is missing, which is why nothing reserves space.

          Plain <img> rather than next/image: the sources are arbitrary news
          CDNs, and next/image would need every one of them allowlisted in
          next.config before it would render at all. */}
      {item.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          // Don't hand the publisher's CDN our URL on every row.
          referrerPolicy="no-referrer"
          // A dead image link is common on wires; drop it rather than leave a
          // broken-image glyph sitting next to a real headline.
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className={clsx(
            "shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-sunken)] object-cover",
            compact ? "h-12 w-16" : "h-16 w-24",
          )}
        />
      )}
    </div>
  );

  return (
    <li
      className={clsx(
        "border-l-2 py-2 pl-2.5 pr-1 transition-colors",
        // A rule rather than a background: importance has to be visible while
        // scanning without making the row shout.
        high ? "border-[var(--color-warn)]" : "border-transparent",
        // Accent = interface state, here meaning "this just arrived".
        isNew ? "bg-[var(--color-accent-wash)] duration-1000" : "duration-150",
        item.url && "hover:bg-[var(--color-accent-wash)]",
      )}
    >
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="block">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
