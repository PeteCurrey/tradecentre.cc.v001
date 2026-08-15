import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bar } from "@/lib/indicators";
import { rsi } from "@/lib/indicators";
import { S } from "./dsl";
import { BarContext } from "./evaluate";
import {
  DONCHIAN_LONG,
  EIGHT_DAY_RUN,
  HARVESTED_PATTERNS,
  RSI_MEAN_REVERSION_LONG,
  RSI_MEAN_REVERSION_SHORT,
} from "./harvested";

/**
 * Golden tests for translated Pine.
 *
 * The question these answer is narrow and important: does the PatternDef fire
 * where the ORIGINAL PINE would fire? Not "is the strategy any good" — that is
 * the gate's job — but "is this the same strategy". A translation that is
 * subtly wrong produces a screening result about a strategy nobody wrote.
 *
 * The reference is recomputed independently from the indicator library rather
 * than hard-coded, so these stay honest if RSI's implementation ever changes.
 */

const START = Date.UTC(2020, 0, 6, 0, 0, 0);

/** Deterministic oscillating series that drives RSI(3) across both thresholds. */
function oscillating(n: number): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    // Alternating runs of up and down closes, so RSI(3) sweeps its full range.
    const phase = Math.floor(i / 5) % 2;
    const step = phase === 0 ? 1.2 : -1.1;
    const o = p;
    const c = p + step;
    out.push({
      time: START + i * 14_400_000, // H4
      o,
      h: Math.max(o, c) + 0.3,
      l: Math.min(o, c) - 0.3,
      c,
      v: 100,
    });
    p = c;
  }
  return out;
}

describe("RSI Mean Reversion — translation fidelity", () => {
  const bars = oscillating(240);
  const closes = bars.map((b) => b.c);
  const r = rsi(closes, 3);
  const ctx = new BarContext(bars);

  /** Pine: ta.crossover(rsi, level) — was at/below on the prior bar, above now. */
  const crossedAbove = (level: number) =>
    closes.map((_, i) =>
      i > 0 &&
      Number.isFinite(r[i]) &&
      Number.isFinite(r[i - 1]) &&
      r[i - 1] <= level &&
      r[i] > level,
    );

  const crossedBelow = (level: number) =>
    closes.map((_, i) =>
      i > 0 &&
      Number.isFinite(r[i]) &&
      Number.isFinite(r[i - 1]) &&
      r[i - 1] >= level &&
      r[i] < level,
    );

  it("long trigger fires exactly on ta.crossover(rsi(3), 40)", () => {
    const fired = ctx.evaluate(RSI_MEAN_REVERSION_LONG.trigger);
    const expected = crossedAbove(40);
    assert.deepEqual(fired, expected);
    assert.ok(expected.some(Boolean), "test data must actually produce crossings");
  });

  it("short trigger fires exactly on ta.crossunder(rsi(3), 70)", () => {
    const fired = ctx.evaluate(RSI_MEAN_REVERSION_SHORT.trigger);
    assert.deepEqual(fired, crossedBelow(70));
  });

  it("each side's exit is the other side's entry — it is stop-and-reverse", () => {
    assert.deepEqual(
      ctx.evaluate(RSI_MEAN_REVERSION_LONG.exitRule!),
      ctx.evaluate(RSI_MEAN_REVERSION_SHORT.trigger),
    );
    assert.deepEqual(
      ctx.evaluate(RSI_MEAN_REVERSION_SHORT.exitRule!),
      ctx.evaluate(RSI_MEAN_REVERSION_LONG.trigger),
    );
  });

  it("uses RSI period 3 and the 40/70 pair the author published", () => {
    const json = JSON.stringify([
      RSI_MEAN_REVERSION_LONG.trigger,
      RSI_MEAN_REVERSION_LONG.exitRule,
    ]);
    assert.match(json, /"s":"rsi","period":3/);
    assert.match(json, /"value":40/);
    assert.match(json, /"value":70/);
  });
});

describe("Donchian — inclusive extremes, the off-by-one that matters", () => {
  const bars = oscillating(200);
  const ctx = new BarContext(bars);

  it("S.highestHigh(n) matches Pine's ta.highest(high, n), including this bar", () => {
    const got = ctx.series(S.highestHigh(10));
    for (let i = 12; i < bars.length; i++) {
      let want = -Infinity;
      for (let j = i - 9; j <= i; j++) want = Math.max(want, bars[j].h); // inclusive
      assert.ok(Math.abs(got[i] - want) < 1e-9, `bar ${i}: ${got[i]} vs ${want}`);
    }
  });

  it("S.lowestLow(n) matches ta.lowest(low, n)", () => {
    const got = ctx.series(S.lowestLow(10));
    for (let i = 12; i < bars.length; i++) {
      let want = Infinity;
      for (let j = i - 9; j <= i; j++) want = Math.min(want, bars[j].l);
      assert.ok(Math.abs(got[i] - want) < 1e-9, `bar ${i}: ${got[i]} vs ${want}`);
    }
  });

  it("is NOT the same as the exclusive priorHigh — the distinction is real", () => {
    const inclusive = ctx.series(S.highestHigh(10));
    const exclusive = ctx.series(S.priorHigh(10));
    assert.ok(
      inclusive.some((v, i) => Number.isFinite(v) && Number.isFinite(exclusive[i]) && v !== exclusive[i]),
      "if these never differ the test data is not exercising new highs",
    );
  });

  it("entry compares against the EXCLUSIVE prior extreme, as highest_high[1] does", () => {
    const prior = ctx.series(S.priorHigh(10));
    const fired = ctx.evaluate(DONCHIAN_LONG.trigger);
    for (let i = 12; i < bars.length; i++) {
      assert.equal(fired[i], bars[i].c > prior[i], `bar ${i}`);
    }
  });

  it("max/min propagate NaN rather than letting a cold indicator win", () => {
    const warm = ctx.series(S.max(S.atr(14), S.close));
    assert.ok(Number.isNaN(warm[0]), "ATR is not warm at bar 0, so max must be NaN");
  });
});

/**
 * Sustained runs with periodic pullbacks.
 *
 * `oscillating` flips every 5 bars, so a close can never hold above the 5-SMA
 * for the eight bars this pattern needs — it produced zero signals and made the
 * fidelity check vacuously true. The "actually produces signals" guard is what
 * caught that, which is why it is there.
 */
function trendingWithPullbacks(n: number): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const cycle = i % 18;
    // Fourteen up bars, then a sharp four-bar pullback through the average.
    const step = cycle < 14 ? 0.9 : -2.4;
    const o = p;
    const c = p + step;
    out.push({
      time: START + i * 86_400_000, // daily
      o,
      h: Math.max(o, c) + 0.4,
      l: Math.min(o, c) - 0.4,
      c,
      v: 100,
    });
    p = c;
  }
  return out;
}

describe("8 Day Run — barssince translated to explicit offsets", () => {
  const bars = trendingWithPullbacks(220);
  const ctx = new BarContext(bars);

  it("fires exactly where the original Pine would", () => {
    const closes = bars.map((b) => b.c);
    const sma5 = ctx.series(S.sma(5));
    const fired = ctx.evaluate(EIGHT_DAY_RUN.trigger);

    for (let i = 20; i < bars.length; i++) {
      // TriggerBuy[1]: close >= SMA on each of the 8 bars ending at i-1.
      let run = true;
      for (let k = 1; k <= 8; k++) {
        if (!(closes[i - k] >= sma5[i - k])) {
          run = false;
          break;
        }
      }
      const want = run && closes[i] <= sma5[i];
      assert.equal(fired[i], want, `bar ${i}`);
    }
  });

  it("the test series actually produces some signals", () => {
    assert.ok(ctx.evaluate(EIGHT_DAY_RUN.trigger).some(Boolean));
  });
});

describe("declared deviations from the originals", () => {
  it("carries a stop only because R requires one, and says so", () => {
    for (const p of HARVESTED_PATTERNS) {
      assert.equal(p.stop.kind, "atr");
      assert.ok(
        p.stop.kind === "atr" && p.stop.multiple >= 10,
        "a disaster stop must be wide enough to rarely bind",
      );
      assert.ok(
        p.contextNotes.some((n) => /NOT in the original/i.test(n)),
        `${p.slug} must declare the added stop`,
      );
    }
  });

  it("attributes every translation to its author", () => {
    for (const p of HARVESTED_PATTERNS) {
      assert.ok(
        p.contextNotes.some((n) => /Translated from TradingView/i.test(n)),
        `${p.slug} is missing attribution`,
      );
    }
  });

  it("declares no target, matching the originals", () => {
    for (const p of HARVESTED_PATTERNS) assert.equal(p.targets.length, 0);
  });
});
