import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeUnitsBody } from "./close-units";

/**
 * Partial-close unit handling.
 *
 * `closeTrade` is the only path that reduces an open position, and the unit
 * count it sends is the difference between taking half off the table and
 * closing the lot. Every case here is exercised WITHOUT contacting the broker:
 * the dry-run and validation branches both return before any fetch, which is
 * exactly why they are the ones worth pinning down.
 *
 * The signed/unsigned boundary is the trap. `nextAction` returns units signed
 * AGAINST the position (negative to close a long) because that is how the rest
 * of the engine reasons about size, while OANDA takes an unsigned count and
 * infers direction from the trade. Sending the signed value straight through
 * would be rejected, leaving the position fully open while the log claims an
 * attempt was made.
 */

describe("closeTrade unit handling", () => {
  it("closes everything when no unit count is given", () => {
    const r = closeUnitsBody();
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.body, { units: "ALL" });
  });

  it("sends the MAGNITUDE when closing part of a long", () => {
    // A long scales out with negative units — the magnitude is what goes over
    // the wire. "-500" would be refused by OANDA outright.
    const r = closeUnitsBody(-500);
    assert.deepEqual(r.ok && r.body, { units: "500" });
  });

  it("sends the magnitude when closing part of a short", () => {
    // A short scales out with positive units. Same magnitude, same string.
    const r = closeUnitsBody(500);
    assert.deepEqual(r.ok && r.body, { units: "500" });
  });

  it("never sends ALL when a partial count was asked for", () => {
    const r = closeUnitsBody(-1);
    assert.deepEqual(r.ok && r.body, { units: "1" });
  });

  it("refuses zero units rather than closing the whole position", () => {
    // The dangerous failure mode: a falsy unit count silently becoming "ALL"
    // would turn a scale-out into a full exit.
    const r = closeUnitsBody(0);
    assert.equal(r.ok, false);
    assert.match((!r.ok && r.error) || "", /positive whole number/);
  });

  it("refuses a fractional count that truncates to nothing", () => {
    const r = closeUnitsBody(0.4);
    assert.equal(r.ok, false);
  });

  it("refuses NaN", () => {
    const r = closeUnitsBody(Number.NaN);
    assert.equal(r.ok, false);
  });

  it("truncates a fractional count rather than sending a decimal", () => {
    const r = closeUnitsBody(-500.9);
    assert.deepEqual(r.ok && r.body, { units: "500" });
  });

});
