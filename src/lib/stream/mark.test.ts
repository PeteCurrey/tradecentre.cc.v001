import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markToMarket, positionProgress, type LivePosition } from "./events";

/**
 * Mark-to-market, checked against REAL broker figures.
 *
 * The numbers below were taken from a live OANDA practice account on
 * 16 Aug 2026 — entry, mark, the calibrated unit value and OANDA's own
 * unrealised P&L for the same position. That matters: this arithmetic is what
 * moves the hero's gauge and P&L between five-second broker pushes, and a unit
 * test written against invented numbers would prove only that the formula is
 * self-consistent, not that it agrees with the broker.
 *
 * The relationship being pinned down:
 *
 *   unrealizedPL = (mark − entry) × units × unitValue
 *   plPerPrice   = units × unitValue
 *
 * `unitValue` carries the quote-currency conversion, which for a GBP account
 * trading XAU_USD only OANDA can get right — so it is always derived from what
 * the broker reported, never assumed.
 */

/** XAU_USD, long 98 units, GBP account. Broker reported P&L of 3684.893. */
function goldUsd(): LivePosition {
  const units = 98;
  const unitValue = 0.7222617936917316;
  return {
    oandaTradeId: "1",
    book: "primary",
    instrument: "XAU_USD",
    direction: "long",
    units,
    entryPrice: 4513.44,
    currentStop: 4450,
    currentTarget: null,
    unrealizedPl: 3684.893,
    markPrice: 4565.5,
    plPerPrice: units * unitValue,
    riskR: 1,
    riskDistance: 4513.44 - 4450,
    openedAt: 0,
  };
}

describe("markToMarket against live broker figures", () => {
  it("reproduces OANDA's own unrealised P&L from entry, mark and unit value", () => {
    const p = goldUsd();
    const rebuilt = (p.markPrice - p.entryPrice) * p.plPerPrice;
    // Within a penny of what the broker reported for the same position.
    assert.ok(
      Math.abs(rebuilt - p.unrealizedPl) < 0.01,
      `rebuilt ${rebuilt} vs broker ${p.unrealizedPl}`,
    );
  });

  it("returns the broker's figure exactly at the mark", () => {
    // No drift at the moment of the push — the browser and the broker agree.
    const p = goldUsd();
    assert.equal(markToMarket(p, p.markPrice), p.unrealizedPl);
  });

  it("extrapolates a favourable tick upward by the conversion factor", () => {
    const p = goldUsd();
    const moved = markToMarket(p, p.markPrice + 1);
    assert.ok(Math.abs(moved - (p.unrealizedPl + p.plPerPrice)) < 1e-9);
    assert.ok(moved > p.unrealizedPl);
  });

  it("extrapolates an adverse tick downward", () => {
    const p = goldUsd();
    assert.ok(markToMarket(p, p.markPrice - 1) < p.unrealizedPl);
  });

  it("holds the broker's figure when no conversion could be calibrated", () => {
    // plPerPrice 0 is how broadcast.ts says "I could not derive this".
    // The row must then sit still rather than drift from a wrong factor.
    const p = { ...goldUsd(), plPerPrice: 0 };
    assert.equal(markToMarket(p, p.markPrice + 50), p.unrealizedPl);
  });

  it("ignores a non-finite price rather than poisoning the figure", () => {
    const p = goldUsd();
    assert.equal(markToMarket(p, Number.NaN), p.unrealizedPl);
  });

  it("measures progress in R from entry, not from the mark", () => {
    const p = goldUsd();
    // Risk is entry − stop = 63.44. One risk-distance above entry is exactly 1R.
    const oneR = p.entryPrice + p.riskDistance!;
    assert.ok(Math.abs(positionProgress(p, oneR) - 1) < 1e-9);
    assert.ok(Math.abs(positionProgress(p, p.entryPrice)) < 1e-9);
    assert.ok(positionProgress(p, p.entryPrice - p.riskDistance!) < 0);
  });

  it("mirrors progress for a short", () => {
    const short: LivePosition = {
      ...goldUsd(),
      direction: "short",
      units: -98,
      plPerPrice: -98 * 0.7222617936917316,
    };
    // Price falling is progress for a short.
    assert.ok(positionProgress(short, short.entryPrice - short.riskDistance!) > 0);
    assert.ok(positionProgress(short, short.entryPrice + short.riskDistance!) < 0);
  });

  it("reports no progress when the trade has no recorded risk", () => {
    // Without an opening stop there is no R denominator, and inventing one
    // would be fabricating the risk the trade was taken with.
    const p = { ...goldUsd(), riskDistance: null };
    assert.equal(positionProgress(p, 9999), 0);
  });
});
