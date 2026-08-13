import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget } from "./levels";
import { BarContext } from "@/lib/patterns/evaluate";
import type { Bar } from "@/lib/indicators";

/**
 * Take-profit resolution.
 *
 * This function decides a price that gets attached to REAL orders, so it is
 * tested directly rather than only through a tick that would need a broker.
 * The cases that matter are the refusals: a target on the wrong side of entry
 * is worse than no target at all, because it would close the position instantly
 * at a loss.
 */

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: Date.UTC(2026, 0, 5, 9, 0) + i * 300_000,
    o: c,
    h: c + 0.5,
    l: c - 0.5,
    c,
    v: 100,
  }));
}

const ctx = new BarContext(bars([100, 101, 102, 103, 104, 105]));
const LAST = 5;

describe("resolveTarget", () => {
  it("places an R-multiple target the right distance beyond entry", () => {
    // Entry 100, stop 98 → 1R is 2. A 2R target sits at 104.
    const long = resolveTarget({ kind: "rMultiple", r: 2 }, ctx, LAST, 100, 98, "long");
    assert.equal(long, 104);

    // Shorts mirror: entry 100, stop 102 → 2R target at 96.
    const short = resolveTarget({ kind: "rMultiple", r: 2 }, ctx, LAST, 100, 102, "short");
    assert.equal(short, 96);
  });

  it("returns null when no target rule is defined", () => {
    // A pattern with no targets runs stop-only. It must not invent a level.
    assert.equal(resolveTarget(undefined, ctx, LAST, 100, 98, "long"), null);
  });

  it("returns null for a time stop, which is not a price", () => {
    // "Exit after N bars" has no level. Fabricating one would attach a
    // take-profit the pattern never asked for.
    assert.equal(
      resolveTarget({ kind: "timeStop", bars: 10 }, ctx, LAST, 100, 98, "long"),
      null,
    );
  });

  it("refuses a target on the wrong side of entry", () => {
    // A series target that resolves BELOW entry on a long would close the trade
    // immediately at a loss. Refused, so the order still goes out stop-only.
    const belowEntry = resolveTarget(
      { kind: "series", at: { s: "const", value: 90 } },
      ctx,
      LAST,
      100,
      98,
      "long",
    );
    assert.equal(belowEntry, null);

    const aboveEntry = resolveTarget(
      { kind: "series", at: { s: "const", value: 110 } },
      ctx,
      LAST,
      100,
      102,
      "short",
    );
    assert.equal(aboveEntry, null);
  });

  it("refuses an R-multiple target when the stop is at entry", () => {
    // Zero risk means no R to multiply. Division would yield the entry price
    // itself, which is not a target.
    assert.equal(
      resolveTarget({ kind: "rMultiple", r: 2 }, ctx, LAST, 100, 100, "long"),
      null,
    );
  });

  it("refuses a series target that evaluates to NaN", () => {
    // An indicator with insufficient history yields NaN. Sending NaN as a price
    // would be rejected by the broker at best.
    const notEnoughBars = resolveTarget(
      { kind: "series", at: { s: "sma", period: 200 } },
      ctx,
      LAST,
      100,
      98,
      "long",
    );
    assert.equal(notEnoughBars, null);
  });

  it("accepts a valid series target", () => {
    const target = resolveTarget(
      { kind: "series", at: { s: "const", value: 108 } },
      ctx,
      LAST,
      100,
      98,
      "long",
    );
    assert.equal(target, 108);
  });
});
