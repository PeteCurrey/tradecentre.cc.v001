import { clsx } from "@/lib/clsx";

/**
 * Small server-rendered SVG chart primitives.
 *
 * Deliberately not a charting library: these render inside server components
 * with no client JavaScript at all, which keeps the analytics screens instant
 * and keeps Lightweight Charts for the one place it earns its weight — the
 * per-trade candle chart.
 *
 * Colour rule, enforced here rather than left to each caller: green and red
 * mean money and nothing else. Anything that is not a P&L quantity is drawn in
 * the orange accent or a neutral grey.
 */

const UP = "var(--color-profit)";
const DOWN = "var(--color-loss)";
const ACCENT = "var(--color-accent)";
const LINE = "var(--color-line)";
const DIM = "var(--color-ink-faint)";

/** Cumulative line, filled to the zero axis. Used for equity in R and in cash. */
export function AreaLine({
  values,
  height = 160,
  className,
  /** Money semantics: colour by sign. Off for non-money series. */
  money = true,
}: {
  values: number[];
  height?: number;
  className?: string;
  money?: boolean;
}) {
  if (values.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-xs text-[var(--color-ink-faint)]"
        style={{ height }}
      >
        Not enough closed trades to plot a curve yet.
      </div>
    );
  }

  const W = 1000;
  const H = height;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const last = values[values.length - 1];
  const stroke = money ? (last >= 0 ? UP : DOWN) : ACCENT;
  const zeroY = y(0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={clsx("w-full", className)}
      style={{ height }}
      role="img"
    >
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke={LINE} strokeWidth={1} />
      <path
        d={`${path} L${W},${zeroY} L0,${zeroY} Z`}
        fill={stroke}
        opacity={0.12}
      />
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Underwater plot — distance below the running peak. Always ≤ 0, always red. */
export function UnderwaterPlot({
  values,
  height = 90,
}: {
  values: number[];
  height?: number;
}) {
  if (values.length < 2) return null;

  const W = 1000;
  const H = height;
  const worst = Math.min(...values, -0.0001);

  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => (v / worst) * H;

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
    >
      <path d={`${path} L${W},0 L0,0 Z`} fill={DOWN} opacity={0.18} />
      <path d={path} fill="none" stroke={DOWN} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Horizontal bar row — the workhorse of every "by X" breakdown.
 *
 * Bars are scaled against the largest ABSOLUTE value in the set so a −3R row
 * and a +3R row are visually the same size in opposite directions, which is the
 * only way the comparison is honest.
 */
export function BarRows({
  rows,
  format,
  money = true,
}: {
  rows: Array<{ label: string; value: number; sub?: string }>;
  format: (v: number) => string;
  money?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-ink-faint)]">Nothing to show yet.</p>;
  }

  const scale = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const pct = (Math.abs(r.value) / scale) * 50; // half-width each side of centre
        const positive = r.value >= 0;
        const color = money ? (positive ? UP : DOWN) : ACCENT;
        return (
          <div key={r.label} className="grid grid-cols-[8rem_1fr_5.5rem] items-center gap-2">
            <span className="truncate text-xs text-[var(--color-ink-dim)]" title={r.label}>
              {r.label}
            </span>
            <div className="relative h-4 rounded-sm bg-[var(--color-sunken)]">
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-line)]" />
              <div
                className="absolute inset-y-[3px] rounded-sm"
                style={{
                  background: color,
                  opacity: 0.75,
                  left: positive ? "50%" : `${50 - pct}%`,
                  width: `${pct}%`,
                }}
              />
            </div>
            <span
              className="figure text-right text-xs"
              style={{ color: money ? color : "var(--color-ink)" }}
            >
              {format(r.value)}
              {r.sub && (
                <span className="ml-1 text-[10px] text-[var(--color-ink-faint)]">{r.sub}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical histogram. Counts are not money, so bars are neutral by default. */
export function Histogram({
  buckets,
  height = 120,
}: {
  buckets: Array<{ label: string; count: number; tone?: "up" | "down" | "neutral" }>;
  height?: number;
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {buckets.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="figure text-[10px] text-[var(--color-ink-faint)]">
            {b.count || ""}
          </span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${(b.count / max) * (height - 28)}px`,
              minHeight: b.count ? 2 : 0,
              background:
                b.tone === "up" ? UP : b.tone === "down" ? DOWN : ACCENT,
              opacity: 0.75,
            }}
          />
          <span className="text-[9px] text-[var(--color-ink-faint)]">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A thin sparkline for tiles. Neutral unless told it represents money. */
export function Sparkline({
  values,
  money = true,
  width = 120,
  height = 28,
}: {
  values: number[];
  money?: boolean;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const path = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(i / (values.length - 1)) * width},${
          height - ((v - min) / span) * height
        }`,
    )
    .join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={path}
        fill="none"
        stroke={money ? (last >= 0 ? UP : DOWN) : DIM}
        strokeWidth={1.5}
      />
    </svg>
  );
}
