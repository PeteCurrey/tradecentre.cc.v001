import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bar } from "@/lib/indicators";
import { BarContext } from "./evaluate";
import { SEED_PATTERNS } from "./seed";

/**
 * Deterministic pseudo-random walk with trends, ranges and volatility clusters.
 *
 * Seeded so the suite is reproducible — a flaky pattern test would be worse
 * than none, because you'd learn to ignore it.
 */
function syntheticBars(count: number): Bar[] {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const bars: Bar[] = [];
  let price = 100;
  let drift = 0;
  let vol = 0.4;
  const start = Date.UTC(2023, 0, 2, 0, 0, 0); // a Monday

  for (let i = 0; i < count; i++) {
    // Regime changes roughly every 200 bars: trend direction and volatility.
    if (i % 200 === 0) {
      drift = (rand() - 0.5) * 0.08;
      vol = 0.15 + rand() * 0.8;
    }
    const move = drift + (rand() - 0.5) * vol;
    const o = price;
    const c = price + move;
    const wick = vol * (0.3 + rand() * 0.9);
    const h = Math.max(o, c) + wick * rand();
    const l = Math.min(o, c) - wick * rand();
    price = c;

    bars.push({
      time: start + i * 3_600_000,
      o,
      h,
      l,
      c,
      v: Math.round(50 + rand() * 300),
    });
  }
  return bars;
}

const BARS = syntheticBars(6000); // ~250 days of hourly data

describe("seed pattern library", () => {
  it("has 20 patterns, five per horizon", () => {
    assert.equal(SEED_PATTERNS.length, 20);
    for (const h of ["scalp", "intraday", "swing", "position"]) {
      const n = SEED_PATTERNS.filter((p) => p.horizon === h).length;
      assert.equal(n, 5, `expected 5 patterns for ${h}, got ${n}`);
    }
  });

  it("uses unique slugs", () => {
    const slugs = SEED_PATTERNS.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length, "duplicate slug found");
  });

  it("covers all four families", () => {
    const families = new Set(SEED_PATTERNS.map((p) => p.family));
    assert.deepEqual(
      [...families].sort(),
      ["indicator", "liquidity", "price-action", "session"],
    );
  });

  it("gives every pattern a stop, at least one target and context notes", () => {
    for (const p of SEED_PATTERNS) {
      assert.ok(p.stop, `${p.slug} has no stop rule`);
      assert.ok(p.targets.length > 0, `${p.slug} has no target`);
      assert.ok(p.invalidation.length > 0, `${p.slug} has no invalidation`);
      assert.ok(
        p.contextNotes.length > 0,
        `${p.slug} has no context notes — every pattern should carry its caveats`,
      );
    }
  });

  it("seeds nothing as live — everything must earn promotion", () => {
    // The seed file describes hypotheses; status is applied at insert time.
    // This asserts the definitions themselves make no claim of being proven.
    for (const p of SEED_PATTERNS) {
      assert.ok(
        !("status" in p) || (p as { status?: string }).status === "incubating",
        `${p.slug} must not declare itself live`,
      );
    }
  });
});

describe("every seed pattern is evaluable", () => {
  const ctx = new BarContext(BARS);

  for (const p of SEED_PATTERNS) {
    it(`${p.slug} evaluates without throwing`, () => {
      const fired = ctx.evaluate(p.trigger);
      assert.equal(fired.length, BARS.length);
    });
  }

  /**
   * A pattern whose conditions can never all hold is a silent bug — it would
   * simply never appear in results and nobody would notice.
   */
  it("every pattern fires at least once on varied data", () => {
    const dead: string[] = [];
    const counts: Array<[string, number]> = [];

    for (const p of SEED_PATTERNS) {
      const fired = ctx.evaluate(p.trigger);
      const n = fired.filter(Boolean).length;
      counts.push([p.slug, n]);
      if (n === 0) dead.push(p.slug);
    }

    // Surface the distribution regardless — a pattern firing 2000 times is as
    // suspicious as one firing zero times.
    //
    // ⚠️ These counts are NOT frequency estimates. Every pattern is evaluated
    // on the same hourly series regardless of its declared timeframe, and the
    // data is a synthetic random walk. Read this as "can it fire at all", not
    // as "how often will I see this". Real frequencies come from the backtester.
    console.log(
      "\n  signal counts over 6000 synthetic bars (smoke test only — see note):\n" +
        counts
          .sort((a, b) => b[1] - a[1])
          .map(([s, n]) => `    ${String(n).padStart(5)}  ${s}`)
          .join("\n"),
    );

    assert.deepEqual(dead, [], `patterns that can never fire: ${dead.join(", ")}`);
  });
});
