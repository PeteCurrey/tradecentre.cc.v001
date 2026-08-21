import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPrivate, type HubEvent } from "./events";

/**
 * Which stream frames are private, and to whom.
 *
 * The hub fans one shared OANDA pricing connection out to every browser, so
 * "broadcast to all subscribers" was the correct design while the desk had one
 * trader. It is a data leak the moment there are two: a desk push carries a
 * member's positions, equity and P&L, and an engine frame announces their
 * fills.
 *
 * `isPrivate` is the single decision point — `subscribeFor` routes on it — so
 * it is pinned here. A new frame type that carries member data and is not
 * listed as private would be broadcast to everyone, and nothing else in the
 * system would object.
 */

const PUBLIC: HubEvent[] = [
  { type: "tick", tick: { instrument: "EUR_USD", bid: 1, ask: 1.1, mid: 1.05, time: "" } },
  { type: "status", state: "live" },
];

const PRIVATE: HubEvent[] = [
  { type: "desk", userId: 7, desk: { at: 0, books: [], degraded: [] } },
  {
    type: "scan",
    userId: 7,
    scan: {
      at: 0, durationMs: 0, nextAt: 0, evaluated: 0,
      candidates: [], books: [], marketOpen: true,
    },
  },
  {
    type: "engine",
    userId: 7,
    event: {
      at: 0, kind: "fill", book: "primary", instrument: "XAU_USD",
      headline: "", detail: null, oandaTradeId: null, patternName: null, sent: true,
    },
  },
  { type: "transaction", userId: 7, accountId: "a", transactionType: "ORDER_FILL", id: "1" },
];

/** The routing rule as `subscribeFor` applies it. */
function delivered(event: HubEvent, toUserId: number): boolean {
  return !(isPrivate(event) && event.userId !== toUserId);
}

describe("stream frame routing", () => {
  it("treats prices and connection status as public", () => {
    // Market data belongs to nobody — one stream serving everyone is the entire
    // reason the hub exists, and narrowing it would quadruple broker connections.
    for (const e of PUBLIC) {
      assert.equal(isPrivate(e), false, `${e.type} should be public`);
      assert.equal(delivered(e, 1), true);
      assert.equal(delivered(e, 999), true);
    }
  });

  it("treats desk, scan, engine and transaction frames as private", () => {
    for (const e of PRIVATE) {
      assert.equal(isPrivate(e), true, `${e.type} must be private`);
    }
  });

  it("delivers a private frame to its owner", () => {
    for (const e of PRIVATE) assert.equal(delivered(e, 7), true);
  });

  it("withholds every private frame from anyone else", () => {
    // The property that matters. A desk push carries positions and equity; an
    // engine frame announces a fill. Neither may reach another member.
    for (const e of PRIVATE) {
      assert.equal(delivered(e, 8), false, `${e.type} leaked to a non-owner`);
      assert.equal(delivered(e, 0), false, `${e.type} leaked to user 0`);
    }
  });

  it("covers every frame type the union defines", () => {
    // If someone adds a frame carrying member data, this fails until they
    // classify it — rather than it silently defaulting to public.
    const covered = new Set([...PUBLIC, ...PRIVATE].map((e) => e.type));
    assert.deepEqual(
      [...covered].sort(),
      ["desk", "engine", "scan", "status", "tick", "transaction"],
      "a HubEvent variant is unclassified — add it to PUBLIC or PRIVATE above",
    );
  });
});
