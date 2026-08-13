import type { HorizonId } from "@/lib/books";

/**
 * Position management.
 *
 * Decides what to do with an already-open position: move the stop to breakeven,
 * trail it, scale out, or flatten. Pure functions, so every path is testable
 * without a broker.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 * A STOP MAY ONLY EVER MOVE IN THE RISK-REDUCING DIRECTION.
 *
 * For a long that means upward; for a short, downward. Never the reverse, under
 * any rule, for any reason. Loosening a stop turns a bounded loss into an
 * unbounded one, and it is the single most expensive bug this module could
 * contain — so it is enforced by a clamp in one place rather than trusted to
 * each rule, and asserted by test.
 *
 * Management is also the part of an autonomous system that acts most often:
 * every tick is an opportunity to send another modify. Two things prevent that
 * becoming API spam and cost — a minimum move threshold, and idempotency on
 * scale-outs.
 */

export type ManagedPosition = {
  tradeId: string;
  instrument: string;
  direction: "long" | "short";
  /** Signed: positive long, negative short. */
  currentUnits: number;
  /** Units the position was opened with, for scale-out fractions. */
  initialUnits: number;
  entryPrice: number;
  /** The stop currently resting at the broker. */
  currentStop: number | null;
  /** The stop the trade was opened with — the R denominator. Never changes. */
  initialStop: number;
  /** Set once a scale-out has been executed, so it happens exactly once. */
  scaledOut: boolean;
  openedAt: Date;
  horizon: HorizonId | null;
};

export type ManagementRules = {
  breakevenAtR?: number;
  scaleOutFraction?: number;
  scaleOutAtR?: number;
  /** Trail this many R behind the best price reached, once in profit. */
  trailAtR?: number;
  trailDistanceR?: number;
  /** Flatten at this London hour, whatever the position. */
  flattenAtHour?: number;
};

export type MarketState = {
  /** Current mid price. */
  price: number;
  /** Best price reached since entry, in the favourable direction. */
  bestPrice: number;
  /** Current hour in Europe/London. */
  londonHour: number;
  now: Date;
};

export type ManagementAction =
  | { kind: "moveStop"; to: number; reason: string }
  | { kind: "scaleOut"; units: number; reason: string }
  | { kind: "flatten"; reason: string };

/**
 * Smallest stop move worth sending, as a fraction of initial risk.
 *
 * Without this the engine would issue a modify on nearly every tick as a trail
 * creeps along — thousands of API calls, rate-limit rejections, and no
 * meaningful difference to the position.
 */
export const MIN_STOP_MOVE_R = 0.05;

/** Risk distance the trade was opened with. The denominator for every R here. */
export function initialRisk(p: ManagedPosition): number {
  return Math.abs(p.entryPrice - p.initialStop);
}

/** How far in profit the position currently is, in R. */
export function currentR(p: ManagedPosition, price: number): number {
  const risk = initialRisk(p);
  if (!(risk > 0)) return 0;
  return p.direction === "long"
    ? (price - p.entryPrice) / risk
    : (p.entryPrice - price) / risk;
}

/** Best R reached since entry. */
export function peakR(p: ManagedPosition, bestPrice: number): number {
  return currentR(p, bestPrice);
}

/**
 * THE CLAMP.
 *
 * Returns the proposed stop only if it reduces risk; otherwise the current one.
 * Every rule routes through this, so no rule can loosen a stop even by mistake.
 */
export function clampStop(
  direction: "long" | "short",
  currentStop: number | null,
  proposed: number,
): number | null {
  if (!Number.isFinite(proposed)) return currentStop;
  if (currentStop === null) return proposed;
  return direction === "long"
    ? Math.max(currentStop, proposed)
    : Math.min(currentStop, proposed);
}

/**
 * Decide the single next action for a position, or null to leave it alone.
 *
 * Returns ONE action at a time rather than a list: each modify needs to be
 * confirmed by the broker before the next decision is made, or the engine would
 * be reasoning about state it has not yet observed.
 *
 * Order is deliberate — flatten first, because a session deadline overrides
 * every other consideration; then scale-out, which changes size and therefore
 * every subsequent calculation; then stop moves.
 */
export function nextAction(
  p: ManagedPosition,
  rules: ManagementRules,
  market: MarketState,
): ManagementAction | null {
  const risk = initialRisk(p);
  if (!(risk > 0)) return null; // no valid R denominator — do nothing

  // --- 1. Session deadline -------------------------------------------------
  if (rules.flattenAtHour !== undefined && market.londonHour >= rules.flattenAtHour) {
    return {
      kind: "flatten",
      reason: `Session flatten at ${String(rules.flattenAtHour).padStart(2, "0")}:00 London`,
    };
  }

  const rNow = currentR(p, market.price);
  const rPeak = Math.max(rNow, peakR(p, market.bestPrice));

  // --- 2. Scale out, exactly once -----------------------------------------
  if (
    !p.scaledOut &&
    rules.scaleOutFraction !== undefined &&
    rules.scaleOutFraction > 0 &&
    rules.scaleOutAtR !== undefined &&
    rPeak >= rules.scaleOutAtR
  ) {
    const units = Math.trunc(Math.abs(p.initialUnits) * rules.scaleOutFraction);
    // Refuse a scale-out that would close the whole position or nothing at all;
    // both are better expressed as other actions.
    if (units > 0 && units < Math.abs(p.currentUnits)) {
      return {
        kind: "scaleOut",
        units: p.direction === "long" ? -units : units,
        reason: `Scale out ${Math.round(rules.scaleOutFraction * 100)}% at ${rPeak.toFixed(2)}R`,
      };
    }
  }

  // --- 3. Stop moves -------------------------------------------------------
  let proposed: number | null = null;
  let reason = "";

  // Trailing takes precedence over breakeven: once a trail is active it is
  // always at least as tight, so applying breakeven after it could only ever
  // loosen the stop — which the clamp would reject anyway, wasting a call.
  if (
    rules.trailAtR !== undefined &&
    rules.trailDistanceR !== undefined &&
    rPeak >= rules.trailAtR
  ) {
    const trailR = rPeak - rules.trailDistanceR;
    const candidate =
      p.direction === "long"
        ? p.entryPrice + trailR * risk
        : p.entryPrice - trailR * risk;
    proposed = candidate;
    reason = `Trail ${rules.trailDistanceR}R behind a ${rPeak.toFixed(2)}R peak`;
  } else if (rules.breakevenAtR !== undefined && rPeak >= rules.breakevenAtR) {
    proposed = p.entryPrice;
    reason = `Breakeven at ${rPeak.toFixed(2)}R`;
  }

  if (proposed === null) return null;

  const clamped = clampStop(p.direction, p.currentStop, proposed);
  if (clamped === null) return null;

  // Never propose a stop on the wrong side of the market — it would trigger
  // instantly at a price the market has not actually reached.
  const wouldTriggerNow =
    p.direction === "long" ? clamped >= market.price : clamped <= market.price;
  if (wouldTriggerNow) return null;

  // Only act on a move large enough to matter.
  const movedBy = p.currentStop === null ? Infinity : Math.abs(clamped - p.currentStop);
  if (movedBy < MIN_STOP_MOVE_R * risk) return null;

  return { kind: "moveStop", to: clamped, reason };
}
