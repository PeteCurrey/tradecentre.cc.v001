/**
 * The unit count on a trade close.
 *
 * Pure, and deliberately in its own module: `execution.ts` imports
 * `server-only` and so cannot be loaded by the test runner at all, yet this is
 * the calculation that decides whether a scale-out takes half off the table or
 * closes the lot. It belongs somewhere it can be pinned down directly.
 *
 * THE SIGNED/UNSIGNED BOUNDARY IS THE WHOLE POINT.
 *
 * `nextAction` returns units signed AGAINST the position — negative to close a
 * long — because that is how the rest of the engine reasons about size. OANDA's
 * close endpoint takes an UNSIGNED count and infers direction from the trade
 * itself. Passing the signed value straight through is rejected by the broker,
 * which leaves the position fully open while the order log records an attempt:
 * the worst kind of failure, because it looks like it worked.
 */

export type CloseUnits =
  | { ok: true; body: { units: string } }
  | { ok: false; error: string };

/**
 * @param units  magnitude to close, signed either way. Omit to close it all.
 */
export function closeUnitsBody(units?: number): CloseUnits {
  if (units === undefined) return { ok: true, body: { units: "ALL" } };

  const magnitude = Math.trunc(Math.abs(units));

  /**
   * Refused rather than sent.
   *
   * The dangerous failure this prevents is a falsy count quietly becoming
   * "ALL" — turning a request to scale out of a winner into a full exit. So
   * anything that does not resolve to a positive whole number of units is an
   * error here, not a fallback.
   */
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return {
      ok: false,
      error: `Refusing to close ${units} units — must be a positive whole number`,
    };
  }

  return { ok: true, body: { units: String(magnitude) } };
}
