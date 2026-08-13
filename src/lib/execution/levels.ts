import type { BarContext } from "@/lib/patterns/evaluate";
import type { StopRule, TargetRule } from "@/lib/patterns/dsl";

/**
 * Turning a pattern's stop and target RULES into actual prices.
 *
 * Deliberately kept out of `engine.ts`, which imports `server-only` and so
 * cannot be loaded by the test runner at all. These two functions decide levels
 * that get attached to real orders — they are the last place in the system
 * where a bad number becomes a live stop — so they belong somewhere they can be
 * tested directly, alongside `guards.ts` and `manage.ts`.
 *
 * Both refuse rather than guess. A null here costs one missed trade; a wrong
 * level costs whatever the position was worth.
 */

/**
 * Resolve a stop rule to a price.
 *
 * A stop on the wrong side of entry is refused here as well as by the guard,
 * so a bad pattern definition produces no order rather than a log full of
 * rejections.
 */
export function resolveStop(
  rule: StopRule | undefined,
  ctx: BarContext,
  i: number,
  entry: number,
  direction: "long" | "short",
): number | null {
  if (!rule) return null;
  const atr = ctx.series({ s: "atr", period: 14 })[i];

  if (rule.kind === "atr") {
    if (!Number.isFinite(atr)) return null;
    return direction === "long" ? entry - rule.multiple * atr : entry + rule.multiple * atr;
  }

  const base = ctx.series(rule.at)[i];
  if (!Number.isFinite(base)) return null;
  const buffer = (rule.bufferAtr ?? 0) * (Number.isFinite(atr) ? atr : 0);
  const stop = direction === "long" ? base - buffer : base + buffer;

  if (direction === "long" && stop >= entry) return null;
  if (direction === "short" && stop <= entry) return null;
  return stop;
}

/**
 * Resolve the pattern's first target into a take-profit price.
 *
 * Only the FIRST target is attached to the order. Later targets are what the
 * management rules scale out into, and attaching them all would close the whole
 * position at the nearest one — the opposite of the intent.
 *
 * `timeStop` deliberately yields no price: "exit after N bars" is not a level,
 * and inventing one to satisfy the order payload would attach a take-profit the
 * pattern never asked for. Those patterns run stop-only and exit through the
 * management rules, which is what a time stop means.
 *
 * A target on the wrong side of entry is refused rather than sent. OANDA would
 * reject it anyway, but rejecting here means the order still goes out with its
 * stop attached instead of failing wholesale over the optional half.
 */
export function resolveTarget(
  rule: TargetRule | undefined,
  ctx: BarContext,
  i: number,
  entry: number,
  stopPrice: number,
  direction: "long" | "short",
): number | null {
  if (!rule) return null;

  let target: number;
  if (rule.kind === "rMultiple") {
    const risk = Math.abs(entry - stopPrice);
    if (!(risk > 0)) return null;
    target = direction === "long" ? entry + rule.r * risk : entry - rule.r * risk;
  } else if (rule.kind === "series") {
    const value = ctx.series(rule.at)[i];
    if (!Number.isFinite(value)) return null;
    target = value;
  } else {
    return null;
  }

  if (direction === "long" && target <= entry) return null;
  if (direction === "short" && target >= entry) return null;
  return target;
}
