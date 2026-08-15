import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GUARD_NAMES,
  MANUAL_GUARD_NAMES,
  approveManualOrder,
  approveOrder,
  checkManualOrder,
  type AccountSnapshot,
  type ExecutionConfig,
  type GuardInput,
  type OrderIntent,
} from "./guards";

/**
 * The manual chain.
 *
 * Peter places these by hand, from a ticket opened off a news item, against a
 * LIVE account. The engine's guards are what make that survivable: a mis-click
 * on a headline must not be able to place a stopless order, exceed the risk
 * ceiling, or trade through the daily loss limit.
 *
 * So the thing most worth testing is not that manual orders work — it is that
 * they are refused for all the same reasons engine orders are.
 */

const NOW = new Date("2026-08-15T14:00:00Z");

const CONFIG: ExecutionConfig = {
  state: "disarmed", // the engine being off must not block a manual trade
  allowLiveCapital: true,
  instrumentAllowlist: ["EUR_USD", "XAU_USD"],
  maxOpenPositions: 3,
  maxRiskMultiple: 1.5,
  enabledPatternIds: [7],
  manualTradingEnabled: true,
};

const ACCOUNT: AccountSnapshot = {
  equity: 10_000,
  openPositions: 0,
  dailyR: 0,
  dailyLimitR: 3,
  baseRiskFraction: 0.0075,
};

const INTENT: OrderIntent = {
  book: "primary",
  accountId: "001-004-1234567-001",
  environment: "live",
  instrument: "XAU_USD",
  direction: "long",
  // Sized to sit UNDER the ceiling: 10k × 0.75% × 1.5 = 112.50, and a 50-point
  // stop on 2 units risks 100. Get this wrong and `sizing` refuses first,
  // masking whichever guard a test is actually aiming at.
  units: 2,
  stopPrice: 2400,
  targetPrice: 2500,
  entryPrice: 2450,
  patternId: null, // every manual order has one
  reason: "feed:polygon:abc123 — OPEC output cut",
};

function input(over: {
  config?: Partial<ExecutionConfig>;
  intent?: Partial<OrderIntent>;
  account?: Partial<AccountSnapshot>;
  recentOrders?: GuardInput["recentOrders"];
} = {}): GuardInput {
  return {
    config: { ...CONFIG, ...over.config },
    intent: { ...INTENT, ...over.intent },
    account: { ...ACCOUNT, ...over.account },
    recentOrders: over.recentOrders ?? [],
    now: NOW,
  };
}

describe("manual orders: the two deliberate substitutions", () => {
  it("does NOT require the autonomous engine to be armed", () => {
    // The engine is disarmed in the base config. This is the whole reason a
    // separate chain exists.
    const res = approveManualOrder(input());
    assert.equal(res.approved, true);
  });

  it("still refuses the same order through the engine chain", () => {
    // Proof the two chains are genuinely different rather than aliases.
    const res = approveOrder(input());
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "armed");
  });

  it("refuses when manual trading is not enabled", () => {
    const res = approveManualOrder(input({ config: { manualTradingEnabled: false } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "manualEnabled");
  });

  it("requires a reason, and treats blank as missing", () => {
    for (const reason of [null, undefined, "", "   "]) {
      const res = approveManualOrder(input({ intent: { reason } }));
      assert.equal(res.approved, false, `accepted reason: ${JSON.stringify(reason)}`);
      if (!res.approved) assert.equal(res.guard, "reasonRequired");
    }
  });

  it("does not require a pattern, which no manual order has", () => {
    const res = approveManualOrder(input({ intent: { patternId: null } }));
    assert.equal(res.approved, true);
  });
});

describe("manual orders inherit every other protection", () => {
  it("refuses an order with no stop", () => {
    const res = approveManualOrder(input({ intent: { stopPrice: null } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "stopRequired");
  });

  it("refuses a stop on the wrong side of entry", () => {
    const res = approveManualOrder(input({ intent: { stopPrice: 2460 } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "stopRequired");
  });

  it("refuses once the daily loss limit is reached", () => {
    const res = approveManualOrder(input({ account: { dailyR: -3 } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "dailyLossLimit");
  });

  it("refuses an order risking more than the ceiling", () => {
    // 10k equity × 0.75% × 1.5 = 112.50 ceiling. A 50-point stop on 100 units
    // risks 5,000.
    const res = approveManualOrder(input({ intent: { units: 100 } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "sizing");
  });

  it("refuses units whose sign contradicts the direction", () => {
    // The stop has to move above entry too, or `stopRequired` refuses first and
    // this stops testing what it claims to.
    const res = approveManualOrder(
      input({ intent: { direction: "short", units: 2, stopPrice: 2500, targetPrice: 2400 } }),
    );
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "sizing");
  });

  it("refuses an instrument that is not enabled", () => {
    const res = approveManualOrder(input({ intent: { instrument: "NAS100_USD" } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "instrumentAllowlist");
  });

  it("refuses live capital that has not been unlocked", () => {
    const res = approveManualOrder(input({ config: { allowLiveCapital: false } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "liveCapital");
  });

  it("refuses a duplicate of an order just placed", () => {
    const res = approveManualOrder(
      input({
        recentOrders: [
          {
            instrument: "XAU_USD",
            direction: "long",
            units: 10,
            createdAt: new Date(NOW.getTime() - 5_000),
          },
        ],
      }),
    );
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "duplicateOrder");
  });

  it("refuses past the rate limit", () => {
    const recentOrders = Array.from({ length: 6 }, (_, i) => ({
      instrument: "EUR_USD",
      direction: "long" as const,
      units: 1,
      createdAt: new Date(NOW.getTime() - 1_000 * (i + 1)),
    }));
    const res = approveManualOrder(input({ recentOrders }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "rateLimit");
  });

  it("refuses when the position cap is already met", () => {
    const res = approveManualOrder(input({ account: { openPositions: 3 } }));
    assert.equal(res.approved, false);
    if (!res.approved) assert.equal(res.guard, "openPositionCap");
  });
});

describe("the two chains cannot drift apart", () => {
  /**
   * The manual chain is built by substituting into the engine chain, so a guard
   * added to the engine protects manual orders automatically.
   *
   * This test exists to make that visible. If it fails because a guard was
   * added, the fix is to confirm the new guard makes sense for a hand-placed
   * order and then update this list — NOT to exclude manual orders from it.
   */
  it("differs from the engine chain in exactly two positions", () => {
    assert.equal(MANUAL_GUARD_NAMES.length, GUARD_NAMES.length);

    const differences = GUARD_NAMES.map((name, i) => [name, MANUAL_GUARD_NAMES[i]])
      .filter(([engine, manual]) => engine !== manual);

    assert.deepEqual(differences, [
      ["armed", "manualEnabled"],
      ["patternEnabled", "reasonRequired"],
    ]);
  });

  it("keeps the engine's evaluation order, so the reported refusal is the same", () => {
    assert.deepEqual(MANUAL_GUARD_NAMES, [
      "manualEnabled",
      "liveCapital",
      "dailyLossLimit",
      "openPositionCap",
      "instrumentAllowlist",
      "reasonRequired",
      "stopRequired",
      "sizing",
      "rateLimit",
      "duplicateOrder",
    ]);
  });

  it("checkManualOrder agrees with approveManualOrder", () => {
    const good = input();
    assert.equal(checkManualOrder(good).allowed, true);
    assert.equal(approveManualOrder(good).approved, true);

    const bad = input({ intent: { stopPrice: null } });
    const decision = checkManualOrder(bad);
    const approval = approveManualOrder(bad);
    assert.equal(decision.allowed, false);
    assert.equal(approval.approved, false);
    if (!decision.allowed && !approval.approved) {
      assert.equal(decision.guard, approval.guard);
    }
  });
});
