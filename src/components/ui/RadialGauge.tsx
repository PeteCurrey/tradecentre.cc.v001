"use client";

import { useAnimatedValue } from "@/lib/stream/useAnimatedValue";
import { clsx } from "@/lib/clsx";

/**
 * The reference's charging meter, repurposed as the daily R gauge.
 *
 * Deliberately symmetric around zero rather than one-directional:
 *   left of centre  = losses, filling toward your daily limit
 *   right of centre = profit
 *
 * A one-directional "budget consumed" gauge would have to render a profitable
 * day as an empty meter, which tells you nothing. This way the needle position
 * alone answers both "how am I doing?" and "how much rope is left?".
 *
 * Colour follows the money rule: green up, red down, grey at flat. The unused
 * track stays neutral so it never competes.
 */

const SWEEP_DEG = 120; // half-sweep either side of top centre → 240° total

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const start = polar(cx, cy, r, fromDeg);
  const end = polar(cx, cy, r, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
}

export function RadialGauge({
  value,
  limit,
  size = 260,
  label = "Today",
  sublabel,
  live = false,
  className,
}: {
  /** Today's R. Positive is profit. */
  value: number;
  /** Daily loss limit in R, as a positive magnitude (e.g. 3 for a −3R limit). */
  limit: number;
  size?: number;
  label?: string;
  sublabel?: string;
  /** True when open positions are moving this figure in real time. */
  live?: boolean;
  className?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const stroke = 14;

  /**
   * The needle eases; the printed number does not.
   *
   * Deliberately different treatments. Smoothing the arc makes movement
   * readable, but smoothing the digits would put a figure on screen that was
   * never true — and this particular figure is the one the daily limit is
   * judged against. So the geometry is animated and the value is not.
   */
  const shown = useAnimatedValue(value);

  const safeLimit = limit > 0 ? limit : 1;
  const clamped = Math.max(-safeLimit, Math.min(safeLimit, shown));
  const t = clamped / safeLimit; // −1 … 1
  const angle = t * SWEEP_DEG;

  const tone =
    value > 0 ? "var(--color-profit)" : value < 0 ? "var(--color-loss)" : "var(--color-flat)";

  // At or beyond the limit the gauge reads as breached, not merely "very red".
  const breached = value <= -safeLimit;

  /** Where the needle sits, for the tip marker and the glow. */
  const tip = polar(cx, cy, r, angle);

  const ticks = Array.from({ length: 25 }, (_, i) => -SWEEP_DEG + (i * (SWEEP_DEG * 2)) / 24);

  return (
    <div className={clsx("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${label}: ${value.toFixed(2)}R against a ${safeLimit}R daily limit`}>
        {/* Unused track */}
        <path
          d={arcPath(cx, cy, r, -SWEEP_DEG, SWEEP_DEG)}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />

        {/* Tick ring, echoing the reference's dial */}
        {ticks.map((deg, i) => {
          const outer = polar(cx, cy, r + stroke / 2 + 6, deg);
          const inner = polar(cx, cy, r + stroke / 2 + (i % 6 === 0 ? 12 : 9), deg);
          return (
            <line
              key={deg}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke={i % 6 === 0 ? "var(--color-ink-faint)" : "var(--color-line-strong)"}
              strokeWidth={i % 6 === 0 ? 1.5 : 1}
              strokeLinecap="round"
            />
          );
        })}

        {/* Filled arc, from centre outward in whichever direction.
            No CSS transition on `d`: the path is already re-rendered each frame
            by the eased value, and a transition on top would fight it. */}
        {Math.abs(t) > 0.001 && (
          <path
            d={arcPath(cx, cy, r, 0, angle)}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 12px ${tone}66)` }}
          />
        )}

        {/* Needle tip. Present only while something is actually moving the
            figure — a pulsing tip on a static gauge would be claiming activity
            that isn't happening. */}
        {live && Math.abs(t) > 0.001 && (
          <>
            <circle
              cx={tip.x}
              cy={tip.y}
              r={stroke / 2 + 3}
              fill="none"
              stroke={tone}
              strokeWidth={1.5}
              className="pulse-ring"
              style={{ transformOrigin: `${tip.x}px ${tip.y}px` }}
            />
            <circle cx={tip.x} cy={tip.y} r={3} fill={tone} />
          </>
        )}

        {/* Zero marker */}
        <line
          x1={polar(cx, cy, r - stroke / 2 - 3, 0).x}
          y1={polar(cx, cy, r - stroke / 2 - 3, 0).y}
          x2={polar(cx, cy, r + stroke / 2 + 3, 0).x}
          y2={polar(cx, cy, r + stroke / 2 + 3, 0).y}
          stroke="var(--color-ink-mute)"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Limit marker — the wall */}
        <circle
          cx={polar(cx, cy, r, -SWEEP_DEG).x}
          cy={polar(cx, cy, r, -SWEEP_DEG).y}
          r={4}
          fill={breached ? "var(--color-loss)" : "var(--color-ink-faint)"}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="label-faint">{label}</span>
        <span
          className="figure font-semibold leading-none mt-1"
          style={{ fontSize: size * 0.2, color: tone }}
        >
          {value > 0 ? "+" : ""}
          {value.toFixed(2)}
          <span style={{ fontSize: size * 0.1 }}>R</span>
        </span>
        <span className="label-faint mt-1.5">
          {sublabel ?? `Limit −${safeLimit.toFixed(1)}R`}
        </span>
        {breached && (
          <span className="mt-1.5 rounded-full bg-[var(--color-loss-wash)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-loss)]">
            Limit reached
          </span>
        )}
      </div>
    </div>
  );
}
