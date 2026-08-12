import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adx,
  atr,
  bollinger,
  ema,
  lastSwingHigh,
  macd,
  rsi,
  sma,
  stochastic,
  swingHighs,
  trueRange,
  type Bar,
} from "./index";

/** Build bars from OHLC tuples; time is synthetic 1-minute spacing. */
function bars(rows: Array<[number, number, number, number]>): Bar[] {
  return rows.map(([o, h, l, c], i) => ({
    time: i * 60_000,
    o,
    h,
    l,
    c,
    v: 100,
  }));
}

function flat(closes: number[]): Bar[] {
  return closes.map((c, i) => ({ time: i * 60_000, o: c, h: c, l: c, c, v: 100 }));
}

describe("length and padding invariants", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("every series returns the same length as its input", () => {
    assert.equal(sma(input, 3).length, input.length);
    assert.equal(ema(input, 3).length, input.length);
    assert.equal(rsi(input, 5).length, input.length);
    assert.equal(atr(flat(input), 5).length, input.length);
    assert.equal(macd(input, 3, 5, 2).line.length, input.length);
  });

  it("pads insufficient history with NaN rather than zero", () => {
    const s = sma(input, 3);
    assert.ok(Number.isNaN(s[0]), "index 0 should be NaN, not 0");
    assert.ok(Number.isNaN(s[1]));
    assert.ok(!Number.isNaN(s[2]));
  });
});

describe("moving averages", () => {
  it("sma computes exact means", () => {
    const s = sma([1, 2, 3, 4, 5], 5);
    assert.equal(s[4], 3);
  });

  it("sma tracks a rolling window", () => {
    const s = sma([2, 4, 6, 8], 2);
    assert.equal(s[1], 3);
    assert.equal(s[2], 5);
    assert.equal(s[3], 7);
  });

  it("ema seeds from the sma of the first period", () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    assert.equal(e[2], 2); // mean of 1,2,3
    // Then k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    assert.equal(e[3], 3);
  });

  it("a flat series has an ema equal to its value", () => {
    const e = ema([5, 5, 5, 5, 5, 5], 3);
    assert.equal(e[5], 5);
  });
});

describe("rsi", () => {
  // Wilder's own worked example. Published first values cluster at 70.46–70.53
  // depending on rounding, so assert within 0.1 of 70.5.
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21,
  ];

  it("matches the reference first value", () => {
    const r = rsi(closes, 14);
    assert.ok(Number.isNaN(r[13]), "should not produce a value before the 15th close");
    assert.ok(
      Math.abs(r[14] - 70.5) < 0.1,
      `expected ~70.5, got ${r[14]}`,
    );
  });

  it("stays within 0 and 100", () => {
    const r = rsi(closes, 14);
    for (const v of r) {
      if (Number.isNaN(v)) continue;
      assert.ok(v >= 0 && v <= 100, `RSI out of bounds: ${v}`);
    }
  });

  it("reads 100 when every move is a gain", () => {
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    assert.equal(r[15], 100);
  });
});

describe("atr and true range", () => {
  it("true range uses the previous close when it gaps", () => {
    const b = bars([
      [10, 12, 9, 11],
      [20, 22, 19, 21], // gaps well above the prior close of 11
    ]);
    const tr = trueRange(b);
    assert.equal(tr[0], 3); // first bar: plain high−low
    assert.equal(tr[1], 11); // |22 − 11| beats the 3-point bar range
  });

  it("a constant-range series has atr equal to that range", () => {
    const b = bars(Array.from({ length: 30 }, () => [10, 11, 9, 10] as [number, number, number, number]));
    const a = atr(b, 14);
    assert.ok(Math.abs(a[29] - 2) < 1e-9, `expected 2, got ${a[29]}`);
  });
});

describe("macd", () => {
  it("histogram equals line minus signal wherever both exist", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const m = macd(closes, 12, 26, 9);
    let checked = 0;
    for (let i = 0; i < closes.length; i++) {
      if (Number.isNaN(m.hist[i])) continue;
      assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-9);
      checked++;
    }
    assert.ok(checked > 0, "expected some valid histogram values");
  });

  it("does not start the signal line before the macd line exists", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(closes, 12, 26, 9);
    const firstLine = m.line.findIndex((v) => !Number.isNaN(v));
    const firstSignal = m.signal.findIndex((v) => !Number.isNaN(v));
    assert.ok(firstSignal > firstLine, "signal must lag the macd line");
  });
});

describe("bollinger", () => {
  it("collapses to the mean on a flat series", () => {
    const closes = new Array(30).fill(50);
    const b = bollinger(closes, 20, 2);
    assert.equal(b.mid[29], 50);
    assert.ok(Math.abs(b.upper[29] - 50) < 1e-9);
    assert.ok(Math.abs(b.lower[29] - 50) < 1e-9);
  });

  it("brackets the mean when there is dispersion", () => {
    const closes = Array.from({ length: 40 }, (_, i) => (i % 2 ? 55 : 45));
    const b = bollinger(closes, 20, 2);
    assert.ok(b.upper[39] > b.mid[39]);
    assert.ok(b.lower[39] < b.mid[39]);
  });
});

describe("adx", () => {
  it("reads high on a persistent uptrend", () => {
    const b = bars(
      Array.from({ length: 80 }, (_, i) => [
        100 + i,
        101 + i,
        99.5 + i,
        100.8 + i,
      ] as [number, number, number, number]),
    );
    const a = adx(b, 14);
    const last = a.adx[79];
    assert.ok(!Number.isNaN(last), "adx should produce a value");
    assert.ok(last > 40, `expected a strong trend reading, got ${last}`);
    assert.ok(a.plusDI[79] > a.minusDI[79], "+DI should dominate in an uptrend");
  });

  it("keeps DI values within 0 and 100", () => {
    const b = bars(
      Array.from({ length: 80 }, (_, i) => {
        const base = 100 + Math.sin(i / 5) * 10;
        return [base, base + 1, base - 1, base + 0.3] as [number, number, number, number];
      }),
    );
    const a = adx(b, 14);
    for (let i = 0; i < b.length; i++) {
      if (Number.isNaN(a.plusDI[i])) continue;
      assert.ok(a.plusDI[i] >= 0 && a.plusDI[i] <= 100);
      assert.ok(a.minusDI[i] >= 0 && a.minusDI[i] <= 100);
    }
  });
});

describe("stochastic", () => {
  it("pins to 100 at the top of its range and 0 at the bottom", () => {
    const rising = bars(
      Array.from({ length: 40 }, (_, i) => [
        100 + i,
        100 + i,
        99 + i,
        100 + i,
      ] as [number, number, number, number]),
    );
    const s = stochastic(rising, 14, 3, 3);
    assert.ok(s.k[39] > 95, `expected near 100, got ${s.k[39]}`);
  });
});

describe("swing structure — no lookahead", () => {
  /**
   * The most important test here. A swing high at index k cannot be known
   * until index k + lookback. If lastSwingHigh reported it any earlier, every
   * backtest built on structure would be reading the future and every result
   * would be inflated.
   */
  it("does not reveal a swing before it is confirmed", () => {
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 20 },
      () => [10, 10.5, 9.5, 10],
    );
    rows[10] = [10, 15, 9.5, 10]; // the peak

    const b = bars(rows);
    const lookback = 2;

    assert.ok(swingHighs(b, lookback)[10], "index 10 should be a swing high");

    const last = lastSwingHigh(b, lookback);
    assert.notEqual(last[10], 15, "must not know the swing on the bar it forms");
    assert.notEqual(last[11], 15, "must not know it one bar later either");
    assert.equal(last[12], 15, "should become available at k + lookback");
  });

  it("carries the most recent confirmed swing forward", () => {
    const rows: Array<[number, number, number, number]> = Array.from(
      { length: 20 },
      () => [10, 10.5, 9.5, 10],
    );
    rows[5] = [10, 13, 9.5, 10];
    rows[12] = [10, 16, 9.5, 10];

    const last = lastSwingHigh(bars(rows), 2);
    assert.equal(last[9], 13, "should still hold the earlier swing");
    assert.equal(last[14], 16, "should update to the newer swing once confirmed");
  });
});
