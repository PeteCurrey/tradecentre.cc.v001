import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bar } from "@/lib/indicators";
import { BarContext, signalIndices } from "./evaluate";
import { C, S, type SeriesRef } from "./dsl";

/**
 * Hourly bars from Monday 8 Jan 2024 00:00 UTC.
 * January, so London is UTC+0 and local hour equals UTC hour — which keeps the
 * session assertions below readable.
 */
const START = Date.UTC(2024, 0, 8, 0, 0, 0);

function hourly(rows: Array<[number, number, number, number]>): Bar[] {
  return rows.map(([o, h, l, c], i) => ({
    time: START + i * 3_600_000,
    o,
    h,
    l,
    c,
    v: 100,
  }));
}

/** Flat bars with a given range, for building fixtures quickly. */
function flatBars(count: number, price = 100): Bar[] {
  return hourly(
    Array.from({ length: count }, () => [price, price + 0.5, price - 0.5, price]),
  );
}

describe("series basics", () => {
  it("compares two series", () => {
    const bars = hourly([
      [10, 11, 9, 10],
      [10, 11, 9, 12],
      [12, 13, 11, 11],
    ]);
    const ctx = new BarContext(bars);
    const r = ctx.evaluate(C.gt(S.close, S.n(10.5)));
    assert.deepEqual(r, [false, true, true]);
  });

  it("detects crosses only on the bar they occur", () => {
    const bars = hourly([
      [10, 11, 9, 9],
      [10, 11, 9, 9.5],
      [10, 11, 9, 11],
      [10, 12, 9, 12],
    ]);
    const ctx = new BarContext(bars);
    const r = ctx.evaluate(C.crossAbove(S.close, S.n(10)));
    assert.deepEqual(r, [false, false, true, false]);
  });

  it("offsets a series backwards", () => {
    const bars = hourly([
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
    ]);
    const ctx = new BarContext(bars);
    const shifted = ctx.series(S.ago(S.close, 1));
    assert.ok(Number.isNaN(shifted[0]));
    assert.equal(shifted[1], 1);
    assert.equal(shifted[2], 2);
  });

  it("supports arithmetic so ATR-relative thresholds work", () => {
    const bars = flatBars(40);
    const ctx = new BarContext(bars);
    const half = ctx.series(S.mul(S.atr(14), S.n(0.5)));
    const full = ctx.series(S.atr(14));
    assert.ok(Math.abs(half[39] - full[39] / 2) < 1e-9);
  });
});

describe("day extremes", () => {
  it("exposes the previous day's high only from the next day", () => {
    // 30 hourly bars: day 1 has a spike to 20, day 2 is flat.
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 30 },
      () => [10, 11, 9, 10],
    );
    rows[5] = [10, 20, 9, 10]; // day 1 spike
    const bars = hourly(rows);
    const ctx = new BarContext(bars);

    const prev = ctx.series(S.dayHigh("previous"));
    assert.ok(Number.isNaN(prev[10]), "no previous day exists on day one");
    assert.equal(prev[26], 20, "day two should see day one's high of 20");

    const cur = ctx.series(S.dayHigh("current"));
    assert.equal(cur[4], 11, "before the spike, the running high is 11");
    assert.equal(cur[5], 20, "the spike bar updates the running high");
  });
});

describe("session extremes", () => {
  it("publishes a completed session range only after the session ends", () => {
    // Tokyo runs 00:00–09:00 London. Put a spike inside it at 03:00.
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 24 },
      () => [10, 11, 9, 10],
    );
    rows[3] = [10, 18, 9, 10];
    const bars = hourly(rows);
    const ctx = new BarContext(bars);

    const completed = ctx.series(S.sessionHigh("tokyo", "completed"));

    assert.ok(
      Number.isNaN(completed[5]),
      "must not expose the range while the session is still running",
    );
    assert.ok(
      Number.isNaN(completed[8]),
      "still inside the session at 08:00 — not yet available",
    );
    assert.equal(completed[9], 18, "available on the first bar after the 09:00 close");
    assert.equal(completed[15], 18, "and stays available for the rest of the day");
  });

  it("reports the running high while a session is live", () => {
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 12 },
      () => [10, 11, 9, 10],
    );
    rows[2] = [10, 15, 9, 10];
    const ctx = new BarContext(hourly(rows));
    const current = ctx.series(S.sessionHigh("tokyo", "current"));
    assert.equal(current[1], 11);
    assert.equal(current[2], 15);
    assert.ok(Number.isNaN(current[10]), "outside the session there is no current range");
  });
});

describe("sweep and reclaim", () => {
  it("fires only when price took the level and closed back inside", () => {
    // Level = previous day high (20, from the day-one spike).
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 40 },
      () => [10, 11, 9, 10],
    );
    rows[5] = [10, 20, 9, 10]; // day one sets the high

    // Day two, bar 27: wick above 20 but close back below → sweep + reclaim.
    rows[27] = [19, 21, 18.5, 19];
    // Day two, bar 30: trades above and CLOSES above → not a reclaim.
    rows[30] = [20.5, 22, 20.2, 21.5];

    const ctx = new BarContext(hourly(rows));
    const fired = ctx.evaluate(C.sweepReclaim(S.dayHigh("previous"), "above", 3));

    assert.ok(fired[27], "wick through then close back below should fire");
    assert.ok(!fired[30], "closing above the level is a break, not a reclaim");
    assert.ok(!fired[20], "an untouched level should not fire");
  });
});

describe("composition", () => {
  it("consecutive requires an unbroken run", () => {
    const bars = hourly([
      [1, 1, 1, 11],
      [1, 1, 1, 12],
      [1, 1, 1, 9],
      [1, 1, 1, 12],
      [1, 1, 1, 13],
    ]);
    const ctx = new BarContext(bars);
    const r = ctx.evaluate(C.consecutive(C.gt(S.close, S.n(10)), 2));
    assert.deepEqual(r, [false, true, false, false, true]);
  });

  it("recently looks back over a window", () => {
    const bars = hourly([
      [1, 1, 1, 20],
      [1, 1, 1, 5],
      [1, 1, 1, 5],
      [1, 1, 1, 5],
    ]);
    const ctx = new BarContext(bars);
    const r = ctx.evaluate(C.recently(C.gt(S.close, S.n(10)), 3));
    assert.deepEqual(r, [true, true, true, false]);
  });

  it("all / any / not compose", () => {
    const bars = hourly([
      [1, 1, 1, 5],
      [1, 1, 1, 15],
    ]);
    const ctx = new BarContext(bars);
    assert.deepEqual(
      ctx.evaluate(C.all(C.gt(S.close, S.n(10)), C.lt(S.close, S.n(20)))),
      [false, true],
    );
    assert.deepEqual(ctx.evaluate(C.not(C.gt(S.close, S.n(10)))), [true, false]);
  });
});

describe("NO LOOKAHEAD — the property that makes backtests meaningful", () => {
  /**
   * The definitive test.
   *
   * A series evaluated over bars[0..k] must produce the same value at index k
   * as the same series evaluated over the full array. If it doesn't, the series
   * is using information that did not exist at bar k, and every backtest result
   * built on it is inflated.
   */
  const rows: Array<[number, number, number, number]> = Array.from(
    { length: 120 },
    (_, i) => {
      const base = 100 + Math.sin(i / 7) * 6 + i * 0.02;
      return [base, base + 1.2, base - 1.1, base + 0.3];
    },
  );
  rows[30] = [110, 125, 109, 111]; // a distinct swing high
  rows[70] = [105, 106, 92, 104]; // a distinct swing low

  const bars = hourly(rows);

  const refs: Array<[string, SeriesRef]> = [
    ["ema(20)", S.ema(20)],
    ["rsi(14)", S.rsi(14)],
    ["atr(14)", S.atr(14)],
    ["adx", S.adx("adx")],
    ["macd hist", S.macd("hist")],
    ["bb upper", S.bb("upper")],
    ["swingHigh", S.swingHigh(2)],
    ["swingLow", S.swingLow(2)],
    ["dayHigh previous", S.dayHigh("previous")],
    ["sessionHigh tokyo completed", S.sessionHigh("tokyo", "completed")],
    ["vwap day", S.vwap("day")],
  ];

  for (const [label, ref] of refs) {
    it(`${label} uses no future information`, () => {
      const full = new BarContext(bars).series(ref);
      // Sample across the series rather than every index, for speed.
      for (let k = 40; k < bars.length; k += 7) {
        const truncated = new BarContext(bars.slice(0, k + 1)).series(ref);
        const a = full[k];
        const b = truncated[k];
        if (Number.isNaN(a) && Number.isNaN(b)) continue;
        assert.ok(
          Math.abs(a - b) < 1e-9,
          `${label} at bar ${k}: full=${a} truncated=${b} — series is reading the future`,
        );
      }
    });
  }
});

describe("divergence", () => {
  it("detects bullish divergence and respects confirmation lag", () => {
    // Price makes a lower low; the oscillator proxy makes a higher low.
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 60 },
      () => [100, 100.5, 99.5, 100],
    );
    rows[20] = [100, 100.5, 90, 100]; // first swing low, deep
    rows[40] = [100, 100.5, 88, 100]; // second swing low, LOWER in price

    const bars = hourly(rows);
    const ctx = new BarContext(bars);

    // Use `low` itself inverted via arithmetic as a stand-in oscillator that
    // rises while price falls, guaranteeing the divergence condition.
    const rising = S.sub(S.n(200), S.low);
    const fired = ctx.evaluate(
      C.divergence("bullish", rising, { swingLookback: 2, validForBars: 3 }),
    );

    assert.ok(!fired[40], "must not fire on the bar the swing forms");
    assert.ok(!fired[41], "must not fire before the swing is confirmed");
    assert.ok(fired[42], "should fire when the second swing confirms");
    assert.ok(fired[44], "and stay live for validForBars");
    assert.ok(!fired[45], "then expire");
  });

  it("does not fire when price and indicator agree", () => {
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 60 },
      () => [100, 100.5, 99.5, 100],
    );
    rows[20] = [100, 100.5, 90, 100];
    rows[40] = [100, 100.5, 88, 100];

    const ctx = new BarContext(hourly(rows));
    // An oscillator that simply tracks price makes a lower low too — no divergence.
    const fired = ctx.evaluate(C.divergence("bullish", S.low, { swingLookback: 2 }));
    assert.ok(!fired.some(Boolean), "confirmation, not divergence, should not fire");
  });
});

describe("signalIndices", () => {
  it("returns the bars where a trigger fires", () => {
    const bars = hourly([
      [1, 1, 1, 5],
      [1, 1, 1, 15],
      [1, 1, 1, 5],
      [1, 1, 1, 25],
    ]);
    assert.deepEqual(signalIndices(bars, C.gt(S.close, S.n(10))), [1, 3]);
  });
});
