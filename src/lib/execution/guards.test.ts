import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkOrder,
  DUPLICATE_WINDOW_MS,
  GUARD_NAMES,
  RATE_LIMIT_MAX,
  type ExecutionConfig,
  type GuardInput,
} from "./guards";

/**
 * These tests are the safety case for autonomous execution.
 *
 * Every one describes a way the engine could lose money through a bug rather
 * than through a losing trade. A failure here is not a cosmetic regression.
 */

const NOW = new Date("2026-08-12T14:00:00Z");

const CONFIG: ExecutionConfig = {
  state: "armed",
  allowLiveCapital: false,
  instrumentAllowlist: ["EUR_USD", "XAU_USD"],
  maxOpenPositions: 2,
  maxRiskMultiple: 1.5,
  enabledPatternIds: [7],
};

/** A valid long: entry 1.10, stop 1.09, 1000 units → risk 10 against a 11.25 ceiling. */
function input(over: Partial<GuardInput> = {}): GuardInput {
  return {
    config: { ...CONFIG, ...(over.config ?? {}) },
    intent: {
      book: "fx",
      accountId: "101-004-1",
      environment: "practice",
      instrument: "EUR_USD",
      direction: "long",
      units: 1000,
      entryPrice: 1.1,
      stopPrice: 1.09,
      targetPrice: 1.12,
      patternId: 7,
      ...(over.intent ?? {}),
    },
    account: {
      equity: 1000,
      openPositions: 0,
      dailyR: 0,
      dailyLimitR: 3,
      baseRiskFraction: 0.0075,
      ...(over.account ?? {}),
    },
    recentOrders: over.recentOrders ?? [],
    now: over.now ?? NOW,
  };
}

function denial(over: Partial<GuardInput>) {
  const d = checkOrder(input(over));
  assert.equal(d.allowed, false, "expected the order to be refused");
  return d as { allowed: false; guard: string; reason: string };
}

describe("baseline", () => {
  it("allows a well-formed order", () => {
    assert.deepEqual(checkOrder(input()), { allowed: true });
  });

  it("evaluates guards most-fundamental first", () => {
    // Disarmed AND oversized: the reported reason must be the disarm, since
    // that is the more fundamental refusal.
    const d = denial({
      config: { ...CONFIG, state: "disarmed" },
      intent: { ...input().intent, units: 999_999 },
    });
    assert.equal(d.guard, "armed");
  });
});

describe("arming", () => {
  it("refuses when disarmed", () => {
    assert.equal(denial({ config: { ...CONFIG, state: "disarmed" } }).guard, "armed");
  });

  it("refuses when halted, and says re-arming is deliberate", () => {
    const d = denial({ config: { ...CONFIG, state: "halted" } });
    assert.equal(d.guard, "armed");
    assert.match(d.reason, /halted/i);
  });
});

describe("live capital", () => {
  it("refuses a live account unless explicitly unlocked", () => {
    const d = denial({ intent: { ...input().intent, environment: "live" } });
    assert.equal(d.guard, "liveCapital");
  });

  it("permits live only when unlocked", () => {
    const r = checkOrder(
      input({
        config: { ...CONFIG, allowLiveCapital: true },
        intent: { ...input().intent, environment: "live" },
      }),
    );
    assert.equal(r.allowed, true);
  });

  it("practice is unaffected by the live lock", () => {
    assert.equal(checkOrder(input()).allowed, true);
  });
});

describe("daily loss limit", () => {
  it("refuses once the limit is reached", () => {
    const d = denial({ account: { ...input().account, dailyR: -3 } });
    assert.equal(d.guard, "dailyLossLimit");
  });

  it("refuses beyond the limit", () => {
    assert.equal(denial({ account: { ...input().account, dailyR: -4.2 } }).guard, "dailyLossLimit");
  });

  it("allows while inside the limit", () => {
    assert.equal(checkOrder(input({ account: { ...input().account, dailyR: -2.9 } })).allowed, true);
  });

  it("is unaffected by a profitable day", () => {
    assert.equal(checkOrder(input({ account: { ...input().account, dailyR: 5 } })).allowed, true);
  });

  it("refuses when daily R is unknown rather than assuming zero", () => {
    const d = denial({ account: { ...input().account, dailyR: NaN } });
    assert.equal(d.guard, "dailyLossLimit");
  });
});

describe("open position cap", () => {
  it("refuses at the cap", () => {
    assert.equal(denial({ account: { ...input().account, openPositions: 2 } }).guard, "openPositionCap");
  });

  it("allows below it", () => {
    assert.equal(checkOrder(input({ account: { ...input().account, openPositions: 1 } })).allowed, true);
  });
});

describe("instrument allowlist", () => {
  it("refuses an instrument that is not enabled", () => {
    const d = denial({ intent: { ...input().intent, instrument: "GBP_JPY" } });
    assert.equal(d.guard, "instrumentAllowlist");
  });

  it("an EMPTY allowlist permits nothing", () => {
    // Deny-by-default: an unfilled list must not mean "trade everything".
    const d = denial({ config: { ...CONFIG, instrumentAllowlist: [] } });
    assert.equal(d.guard, "instrumentAllowlist");
  });
});

describe("pattern gating", () => {
  it("refuses an order with no originating pattern", () => {
    assert.equal(denial({ intent: { ...input().intent, patternId: null } }).guard, "patternEnabled");
  });

  it("refuses a pattern that is not enabled", () => {
    assert.equal(denial({ intent: { ...input().intent, patternId: 99 } }).guard, "patternEnabled");
  });
});

describe("mandatory stop", () => {
  it("refuses an order with no stop", () => {
    assert.equal(denial({ intent: { ...input().intent, stopPrice: null } }).guard, "stopRequired");
  });

  it("refuses a stop above entry on a long", () => {
    assert.equal(denial({ intent: { ...input().intent, stopPrice: 1.11 } }).guard, "stopRequired");
  });

  it("refuses a stop at entry", () => {
    assert.equal(denial({ intent: { ...input().intent, stopPrice: 1.1 } }).guard, "stopRequired");
  });

  it("refuses a stop below entry on a short", () => {
    const d = denial({
      intent: { ...input().intent, direction: "short", units: -1000, stopPrice: 1.09 },
    });
    assert.equal(d.guard, "stopRequired");
  });

  it("accepts a correct short", () => {
    const r = checkOrder(
      input({
        intent: { ...input().intent, direction: "short", units: -1000, stopPrice: 1.11 },
      }),
    );
    assert.equal(r.allowed, true);
  });
});

describe("sizing", () => {
  it("refuses an order risking more than the ceiling", () => {
    // 10x units → risk 100 against a ceiling of 1000 × 0.0075 × 1.5 = 11.25.
    const d = denial({ intent: { ...input().intent, units: 10_000 } });
    assert.equal(d.guard, "sizing");
  });

  it("catches a sizing bug that inflates units 100x", () => {
    // The classic way automated systems cause real damage.
    const d = denial({ intent: { ...input().intent, units: 100_000 } });
    assert.equal(d.guard, "sizing");
    assert.match(d.reason, /ceiling/);
  });

  it("refuses when units and direction disagree", () => {
    // Positive units on a short would trade the opposite way to the signal.
    const d = denial({ intent: { ...input().intent, direction: "short", units: 1000, stopPrice: 1.11 } });
    assert.equal(d.guard, "sizing");
  });

  it("refuses zero units", () => {
    assert.equal(denial({ intent: { ...input().intent, units: 0 } }).guard, "sizing");
  });

  it("refuses when equity is unknown", () => {
    assert.equal(denial({ account: { ...input().account, equity: 0 } }).guard, "sizing");
  });

  it("scales the ceiling with equity", () => {
    // Ten times the equity permits ten times the size.
    const r = checkOrder(
      input({
        account: { ...input().account, equity: 10_000 },
        intent: { ...input().intent, units: 10_000 },
      }),
    );
    assert.equal(r.allowed, true);
  });
});

describe("rate limit", () => {
  it("refuses once the window is full", () => {
    const recentOrders = Array.from({ length: RATE_LIMIT_MAX }, (_, i) => ({
      instrument: "XAU_USD",
      direction: "long" as const,
      units: 1,
      createdAt: new Date(NOW.getTime() - (i + 1) * 1000),
    }));
    assert.equal(denial({ recentOrders }).guard, "rateLimit");
  });

  it("ignores orders outside the window", () => {
    const recentOrders = Array.from({ length: RATE_LIMIT_MAX }, () => ({
      instrument: "XAU_USD",
      direction: "long" as const,
      units: 1,
      createdAt: new Date(NOW.getTime() - 120_000),
    }));
    assert.equal(checkOrder(input({ recentOrders })).allowed, true);
  });

  it("stops a runaway loop", () => {
    // Simulate a retry storm: the guard must refuse well before 40 orders land.
    let placed = 0;
    const recentOrders: Array<{
      instrument: string;
      direction: "long";
      units: number;
      createdAt: Date;
    }> = [];
    for (let i = 0; i < 40; i++) {
      const now = new Date(NOW.getTime() + i * 100);
      const d = checkOrder(
        input({
          recentOrders,
          now,
          // Vary the instrument so the duplicate guard is not what stops it.
          intent: {
            ...input().intent,
            instrument: i % 2 ? "EUR_USD" : "XAU_USD",
          },
        }),
      );
      if (d.allowed) {
        placed++;
        recentOrders.push({
          instrument: i % 2 ? "EUR_USD" : "XAU_USD",
          direction: "long",
          units: 1000,
          createdAt: now,
        });
      }
    }
    assert.ok(placed <= RATE_LIMIT_MAX, `${placed} orders got through a runaway loop`);
  });
});

describe("duplicate orders", () => {
  it("refuses the same instrument and direction inside the window", () => {
    const d = denial({
      recentOrders: [
        {
          instrument: "EUR_USD",
          direction: "long",
          units: 1000,
          createdAt: new Date(NOW.getTime() - 5_000),
        },
      ],
    });
    assert.equal(d.guard, "duplicateOrder");
  });

  it("allows the same instrument in the opposite direction", () => {
    const r = checkOrder(
      input({
        recentOrders: [
          {
            instrument: "EUR_USD",
            direction: "short",
            units: -1000,
            createdAt: new Date(NOW.getTime() - 5_000),
          },
        ],
      }),
    );
    assert.equal(r.allowed, true);
  });

  it("allows once the window has passed", () => {
    const r = checkOrder(
      input({
        recentOrders: [
          {
            instrument: "EUR_USD",
            direction: "long",
            units: 1000,
            createdAt: new Date(NOW.getTime() - DUPLICATE_WINDOW_MS - 1_000),
          },
        ],
      }),
    );
    assert.equal(r.allowed, true);
  });
});

describe("guard inventory", () => {
  it("has every expected guard, in severity order", () => {
    // Order matters: it determines which reason gets reported and logged.
    assert.deepEqual(GUARD_NAMES, [
      "armed",
      "liveCapital",
      "dailyLossLimit",
      "openPositionCap",
      "instrumentAllowlist",
      "patternEnabled",
      "stopRequired",
      "sizing",
      "rateLimit",
      "duplicateOrder",
    ]);
  });
});
