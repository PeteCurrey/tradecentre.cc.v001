import { BOOK_LIST } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export type BookRisk = {
  bookId: string;
  label: string;
  colorVar: string;
  /** Open risk in R currently committed in this book. */
  riskR: number;
  positions: number;
};

const ROW_H = 46;
const SVG_W = 210;

/**
 * The reference's "energy flow" ribbons, repurposed.
 *
 * Source (left) = total open risk. Ribbons fan out to the four books with
 * thickness proportional to risk committed, orange where live and grey where
 * flat — the reference's active/inactive treatment.
 *
 * Labels are HTML rather than SVG text: text inside a scaled viewBox becomes
 * illegible at small sizes, and the reference pairs its ribbons with a proper
 * labelled port list anyway. The SVG carries only the curves, at a fixed size
 * so its rows align exactly with the HTML rows beside it.
 */
export function RiskFlow({ books, className }: { books: BookRisk[]; className?: string }) {
  const height = books.length * ROW_H;
  const total = books.reduce((s, b) => s + b.riskR, 0);

  const rows = books.map((b, i) => {
    const y = i * ROW_H + ROW_H / 2;
    const share = total > 0 ? b.riskR / total : 0;
    // Thickness spans 3–26px by share of total open risk.
    const thickness = total > 0 ? 3 + share * 23 : 3;
    return { ...b, y, thickness, live: b.riskR > 0 };
  });

  return (
    <div className={clsx("flex items-stretch", className)}>
      {/* Source */}
      <div className="flex shrink-0 flex-col justify-center">
        <div
          className={clsx(
            "rounded-[var(--radius-tile)] border px-3.5 py-3",
            total > 0
              ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)]"
              : "border-[var(--color-line)] bg-[var(--color-sunken)]",
          )}
        >
          <div className="label-faint whitespace-nowrap">Open risk</div>
          <div
            className="figure mt-1 text-2xl leading-none"
            style={{
              color: total > 0 ? "var(--color-accent)" : "var(--color-ink-faint)",
            }}
          >
            {total.toFixed(2)}
            <span className="text-sm">R</span>
          </div>
        </div>
      </div>

      {/* Ribbons — fixed size so rows line up with the list */}
      <svg
        width={SVG_W}
        height={height}
        viewBox={`0 0 ${SVG_W} ${height}`}
        className="hidden shrink-0 sm:block"
        aria-hidden
      >
        <defs>
          {rows.map((r) => (
            <linearGradient key={r.bookId} id={`flow-${r.bookId}`} x1="0" y1="0" x2="1" y2="0">
              <stop
                offset="0%"
                stopColor={r.live ? "var(--color-accent)" : "var(--color-line-strong)"}
              />
              <stop
                offset="100%"
                stopColor={r.live ? r.colorVar : "var(--color-line)"}
              />
            </linearGradient>
          ))}
        </defs>

        {rows.map((r) => (
          <path
            key={r.bookId}
            d={`M 0 ${height / 2} C ${SVG_W * 0.5} ${height / 2}, ${SVG_W * 0.5} ${r.y}, ${SVG_W} ${r.y}`}
            fill="none"
            stroke={`url(#flow-${r.bookId})`}
            strokeWidth={r.thickness}
            strokeLinecap="round"
            opacity={r.live ? 1 : 0.5}
          />
        ))}
      </svg>

      {/* Destinations — the reference's port list */}
      <ul className="min-w-0 flex-1">
        {rows.map((r) => (
          <li
            key={r.bookId}
            className="flex items-center gap-3 pl-1"
            style={{ height: ROW_H }}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background: r.live ? r.colorVar : "var(--color-line-strong)",
                boxShadow: r.live ? `0 0 10px ${r.colorVar}` : undefined,
              }}
            />
            <span className="min-w-0 flex-1">
              <span
                className={clsx(
                  "block truncate text-[13px] font-medium",
                  r.live ? "text-[var(--color-ink)]" : "text-[var(--color-ink-mute)]",
                )}
              >
                {r.label}
              </span>
              <span className="block text-[11px] text-[var(--color-ink-faint)]">
                {r.positions} {r.positions === 1 ? "position" : "positions"}
              </span>
            </span>
            <span
              className={clsx(
                "figure shrink-0 text-sm",
                r.live ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]",
              )}
            >
              {r.riskR.toFixed(2)}R
            </span>
            {/* Pill toggle, straight from the reference: orange on, grey off */}
            <span
              className={clsx("pill h-5 min-w-9 shrink-0", r.live && "pill-on")}
              aria-label={r.live ? "risk on" : "flat"}
            >
              <span
                className={clsx(
                  "h-0.5 w-3.5 rounded-full",
                  r.live ? "bg-black/70" : "bg-[var(--color-ink-faint)]",
                )}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Zeroed state used until OANDA is connected. */
export const EMPTY_BOOK_RISK: BookRisk[] = BOOK_LIST.map((b) => ({
  bookId: b.id,
  label: b.label,
  colorVar: b.colorVar,
  riskR: 0,
  positions: 0,
}));
