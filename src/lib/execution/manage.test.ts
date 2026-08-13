import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampStop,
  currentR,
  initialRisk,
  MIN_STOP_MOVE_R,
  nextAction,
  type ManagedPosition,
  type ManagementRules,
  type MarketState,
} from "./manage";

/**
 * Position management is the part of an autonomous system that acts most often
 * and does the most damage per line when wrong. Every test here describes a way
 * money could be lost through a bug rather than through a losing trade.
 */

const NOW = new Date("2026-08-12T14:00:00Z");

/** Long: entry 100, initial stop 90 → risk 10. So 1R = 10 points. */
function long(over: Partial<ManagedPosition> = {}): ManagedPosition {
  return {
    tradeId: "1",
    instrument: "XAU_USD",
    direction: "long",
    currentUnits: 100,
    initialUnits: 100,
    entryPrice: 100,
    currentStop: 90,
    initialStop: 90,
    scaledOut: false,
    openedAt: NOW,
    horizon: "intraday",
    ...over,
  };
}

/** Short: entry 100, initial stop 110 → risk 10. */
function short(over: Partial<ManagedPosition> = {}): ManagedPosition {
  return { ...long(), direction: "short", currentUnits: -100, initialUnits: -100, currentStop: 110, initialStop: 110, ...over };
}

function market(over: Partial<MarketState> = {}): MarketState {
  return { price: 100, bestPrice: 100, londonHour: 14, now: NOW, ...over };
}

describe("THE INVARIANT — a stop may only move to reduce risk", () => {
  it("a long stop can rise", () => {
    assert.equal(clampStop("long", 90, 95), 95);
  });

  it("a long stop can NEVER fall", () => {
    assert.equal(clampStop("long", 95, 90), 95, "loosened a long stop");
    assert.equal(clampStop("long", 95, 0), 95);
    assert.equal(clampStop("long", 95, -1000), 95);
  });

  it("a short stop can fall", () => {
    assert.equal(clampStop("short", 110, 105), 105);
  });

  it("a short stop can NEVER rise", () => {
    assert.equal(clampStop("short", 105, 110), 105, "loosened a short stop");
    assert.equal(clampStop("short", 105, 1e9), 105);
  });

  it("rejects a non-finite proposal rather than clearing the stop", () => {
    assert.equal(clampStop("long", 95, NaN), 95);
    assert.equal(clampStop("long", 95, Infinity), 95);
  });

  it("accepts any first stop when none is resting", () => {
    assert.equal(clampStop("long", null, 80), 80);
  });

  it("no rule can produce a risk-increasing stop, whatever the inputs", () => {
    // Property check across a grid: trailing, breakeven, longs, shorts, and
    // prices that have moved against the position.
    const rules: ManagementRules = {
      breakevenAtR: 1,
      trailAtR: 1.5,
      trailDistanceR: 1,
    };
    for (const dir of ["long", "short"] as const) {
      for (const price of [70, 85, 95, 100, 105, 115, 130]) {
        for (const best of [70, 100, 110, 140]) {
          const p = dir === "long" ? long() : short();
          const a = nextAction(p, rules, market({ price, bestPrice: best }));
          if (a?.kind !== "moveStop") continue;
          if (dir === "long") {
            assert.ok(a.to >= p.currentStop!, `long stop moved down to ${a.to}`);
          } else {
            assert.ok(a.to <= p.currentStop!, `short stop moved up to ${a.to}`);
          }
        }
      }
    }
  });
});

describe("R arithmetic", () => {
  it("computes initial risk from the opening stop", () => {
    assert.equal(initialRisk(long()), 10);
    assert.equal(initialRisk(short()), 10);
  });

  it("measures profit in R for both directions", () => {
    assert.equal(currentR(long(), 110), 1);
    assert.equal(currentR(long(), 90), -1);
    assert.equal(currentR(short(), 90), 1);
    assert.equal(currentR(short(), 110), -1);
  });

  it("uses the ORIGINAL stop as the denominator even after the stop moves", () => {
    // Otherwise R would shrink as the stop trails, and a 3R winner would
    // report as something else entirely.
    const p = long({ currentStop: 105 });
    assert.equal(initialRisk(p), 10);
    assert.equal(currentR(p, 120), 2);
  });
});

describe("breakeven", () => {
  it("moves the stop to entry once the trigger is reached", () => {
    const a = nextAction(long(), { breakevenAtR: 1 }, market({ price: 110, bestPrice: 110 }));
    assert.equal(a?.kind, "moveStop");
    assert.equal((a as { to: number }).to, 100);
  });

  it("does not act before the trigger", () => {
    assert.equal(nextAction(long(), { breakevenAtR: 1 }, market({ price: 105, bestPrice: 105 })), null);
  });

  it("triggers on the PEAK, not the current price", () => {
    // Ran to +1.5R then came back to +0.2R: breakeven should already be armed.
    const a = nextAction(long(), { breakevenAtR: 1 }, market({ price: 102, bestPrice: 115 }));
    assert.equal(a?.kind, "moveStop");
  });

  it("does nothing once the stop is already at entry", () => {
    const p = long({ currentStop: 100 });
    assert.equal(nextAction(p, { breakevenAtR: 1 }, market({ price: 110, bestPrice: 110 })), null);
  });
});

describe("trailing", () => {
  it("trails a fixed R distance behind the peak", () => {
    // Peak +3R, trail 1R behind → stop at +2R = 120.
    const a = nextAction(
      long(),
      { trailAtR: 1.5, trailDistanceR: 1 },
      market({ price: 128, bestPrice: 130 }),
    );
    assert.equal(a?.kind, "moveStop");
    assert.equal((a as { to: number }).to, 120);
  });

  it("trails a short downward", () => {
    const a = nextAction(
      short(),
      { trailAtR: 1.5, trailDistanceR: 1 },
      market({ price: 72, bestPrice: 70 }),
    );
    assert.equal(a?.kind, "moveStop");
    assert.equal((a as { to: number }).to, 80);
  });

  it("does not trail before the activation threshold", () => {
    assert.equal(
      nextAction(long(), { trailAtR: 2, trailDistanceR: 1 }, market({ price: 110, bestPrice: 112 })),
      null,
    );
  });

  it("never proposes a stop the market has already passed", () => {
    // Price fell back below where the trail would sit — sending that stop
    // would trigger instantly at a price the market never traded.
    const p = long({ currentStop: 100 });
    const a = nextAction(
      p,
      { trailAtR: 1, trailDistanceR: 0.1 },
      market({ price: 101, bestPrice: 140 }),
    );
    if (a?.kind === "moveStop") {
      assert.ok(a.to < 101, `stop ${a.to} is at or above the market price 101`);
    }
  });
});

describe("minimum move threshold", () => {
  it("ignores a move smaller than the threshold", () => {
    // Peak nudges the trail by a fraction of a point — not worth an API call.
    const p = long({ currentStop: 119.9 });
    const a = nextAction(
      p,
      { trailAtR: 1, trailDistanceR: 1 },
      market({ price: 128, bestPrice: 130 }),
    );
    assert.equal(a, null, "sent a modify for a trivial move");
  });

  it("acts once the move exceeds the threshold", () => {
    const p = long({ currentStop: 119.9 });
    const a = nextAction(
      p,
      { trailAtR: 1, trailDistanceR: 1 },
      // Peak 135 → trail to +2.5R = 125, a 5.1 point move against a 0.5 threshold.
      market({ price: 133, bestPrice: 135 }),
    );
    assert.equal(a?.kind, "moveStop");
  });

  it("threshold scales with the position's own risk", () => {
    assert.equal(MIN_STOP_MOVE_R * initialRisk(long()), 0.5);
  });

  it("does not throttle the FIRST stop when none is resting", () => {
    const p = long({ currentStop: null });
    const a = nextAction(p, { breakevenAtR: 1 }, market({ price: 110, bestPrice: 110 }));
    assert.equal(a?.kind, "moveStop");
  });
});

describe("scale out", () => {
  const rules: ManagementRules = { scaleOutFraction: 0.5, scaleOutAtR: 1 };

  it("takes the configured fraction at the trigger", () => {
    const a = nextAction(long(), rules, market({ price: 110, bestPrice: 110 }));
    assert.equal(a?.kind, "scaleOut");
    // Closing half a long means selling 50 units.
    assert.equal((a as { units: number }).units, -50);
  });

  it("closes a short by BUYING units back", () => {
    const a = nextAction(short(), rules, market({ price: 90, bestPrice: 90 }));
    assert.equal(a?.kind, "scaleOut");
    assert.equal((a as { units: number }).units, 50);
  });

  it("happens exactly once", () => {
    const p = long({ scaledOut: true, currentUnits: 50 });
    const a = nextAction(p, rules, market({ price: 120, bestPrice: 120 }));
    assert.notEqual(a?.kind, "scaleOut", "scaled out twice");
  });

  it("refuses a scale-out that would close the whole position", () => {
    // Half of the initial size is the entire remaining size — that is a
    // flatten, and dressing it up as a scale-out would leave nothing to manage.
    const p = long({ initialUnits: 100, currentUnits: 50 });
    const a = nextAction(p, rules, market({ price: 120, bestPrice: 120 }));
    assert.notEqual(a?.kind, "scaleOut");
  });

  it("refuses a fraction that rounds to zero units", () => {
    const p = long({ initialUnits: 1, currentUnits: 1 });
    const a = nextAction(p, { scaleOutFraction: 0.1, scaleOutAtR: 1 }, market({ price: 120, bestPrice: 120 }));
    assert.notEqual(a?.kind, "scaleOut");
  });
});

describe("session flatten", () => {
  it("overrides everything else", () => {
    // Deep in profit with a trail active — the deadline still wins.
    const a = nextAction(
      long(),
      { flattenAtHour: 21, trailAtR: 1, trailDistanceR: 1, scaleOutFraction: 0.5, scaleOutAtR: 1 },
      market({ price: 140, bestPrice: 140, londonHour: 21 }),
    );
    assert.equal(a?.kind, "flatten");
  });

  it("does nothing before the hour", () => {
    const a = nextAction(long(), { flattenAtHour: 21 }, market({ londonHour: 20 }));
    assert.equal(a, null);
  });

  it("flattens a losing position too", () => {
    const a = nextAction(long(), { flattenAtHour: 21 }, market({ price: 92, londonHour: 22 }));
    assert.equal(a?.kind, "flatten");
  });
});

describe("safety", () => {
  it("does nothing when there is no valid R denominator", () => {
    const p = long({ entryPrice: 100, initialStop: 100 });
    assert.equal(nextAction(p, { breakevenAtR: 1 }, market({ price: 120, bestPrice: 120 })), null);
  });

  it("does nothing with no rules configured", () => {
    assert.equal(nextAction(long(), {}, market({ price: 130, bestPrice: 130 })), null);
  });

  it("returns ONE action at a time", () => {
    // The engine must confirm each modify with the broker before deciding
    // again, or it reasons about state it has not observed.
    const a = nextAction(
      long(),
      { breakevenAtR: 1, trailAtR: 1, trailDistanceR: 0.5, scaleOutFraction: 0.5, scaleOutAtR: 1 },
      market({ price: 130, bestPrice: 130 }),
    );
    assert.ok(a && typeof a.kind === "string");
  });

  it("a losing position is never managed into more risk", () => {
    for (const price of [99, 95, 91, 90.1]) {
      const a = nextAction(
        long(),
        { breakevenAtR: 1, trailAtR: 1, trailDistanceR: 1 },
        market({ price, bestPrice: 100 }),
      );
      assert.equal(a, null, `acted on a losing position at ${price}`);
    }
  });
});
