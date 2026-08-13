import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bar } from "@/lib/indicators";
import { C, S, type PatternDef } from "@/lib/patterns/dsl";
import {
  DEFAULT_CRITERIA,
  benjaminiHochberg,
  bootstrapPValue,
  rng,
  runSegmented,
  screen,
  type Candidate,
} from "./gate";
import type { BacktestTrade } from "./engine";

const START = Date.UTC(2024, 0, 8, 0, 0, 0);

/** Random walk with optional drift, seeded so every test is reproducible. */
function walk(n: number, opts: { seed?: number; drift?: number; vol?: number } = {}): Bar[] {
  const next = rng(opts.seed ?? 7);
  const drift = opts.drift ?? 0;
  const vol = opts.vol ?? 1;
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const move = (next() - 0.5) * 2 * vol + drift;
    const c = o + move;
    const wick = Math.abs(move) * 0.5 + vol * 0.2;
    bars.push({
      time: START + i * 3_600_000,
      o,
      h: Math.max(o, c) + wick,
      l: Math.min(o, c) - wick,
      c,
      v: 100,
    });
    price = c;
  }
  return bars;
}

/** Fires on most bars, so the sample size is driven by the data not the trigger. */
function pattern(slug: string, over: Partial<PatternDef> = {}): PatternDef {
  return {
    slug,
    name: slug,
    summary: "",
    family: "price-action",
    horizon: "intraday",
    direction: "long",
    timeframe: "H1",
    instrumentClasses: ["fx"],
    trigger: C.gt(S.close, S.open),
    invalidation: "",
    stop: { kind: "atr", multiple: 1 },
    targets: [{ kind: "rMultiple", r: 2 }],
    contextNotes: [],
    ...over,
  };
}

function fakeTrades(rs: number[]): BacktestTrade[] {
  return rs.map((r, i) => ({
    entryIndex: i,
    exitIndex: i + 1,
    entryTime: START,
    exitTime: START,
    direction: "long" as const,
    entryPrice: 100,
    exitPrice: 100,
    stop: 99,
    target: null,
    r,
    reason: "target" as const,
    barsHeld: 1,
    maeR: 0,
    mfeR: 0,
  }));
}

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = Array.from({ length: 5 }, rng(42));
    const b = Array.from({ length: 5 }, rng(42));
    assert.deepEqual(a, b);
  });

  it("differs across seeds", () => {
    assert.notDeepEqual(Array.from({ length: 5 }, rng(1)), Array.from({ length: 5 }, rng(2)));
  });

  it("stays in [0, 1)", () => {
    const next = rng(3);
    for (let i = 0; i < 1000; i++) {
      const v = next();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });
});

describe("segmentation", () => {
  it("drops no bars — the final window absorbs the remainder", () => {
    // 1003 bars into 6 windows: 167 each, with the last taking 168.
    const bars = walk(1003);
    const r = runSegmented(pattern("p"), bars, "EUR_USD", { windows: 6 });
    const total = r.windows.reduce((s, w) => s + w.bars, 0);
    assert.equal(total, 1003);
    assert.equal(r.windows.length, 6);
  });

  it("pools every window's trades", () => {
    const bars = walk(1200, { drift: 0.02 });
    const r = runSegmented(pattern("p"), bars, "EUR_USD", { windows: 6 });
    const summed = r.windows.reduce((s, w) => s + w.stats.trades, 0);
    assert.equal(r.pooled.trades, summed);
    assert.equal(r.trades.length, summed);
  });

  it("counts consistency over windows that traded, not all windows", () => {
    const bars = walk(1200, { drift: 0.02 });
    const r = runSegmented(pattern("p"), bars, "EUR_USD", { windows: 6 });
    assert.ok(r.windowsWithTrades <= 6);
    assert.ok(r.windowsPositive <= r.windowsWithTrades);
    if (r.windowsWithTrades > 0) {
      assert.equal(r.consistency, r.windowsPositive / r.windowsWithTrades);
    }
  });

  it("reports zero consistency rather than NaN when nothing trades", () => {
    const flat = walk(200, { vol: 0 }); // never closes above open
    const r = runSegmented(pattern("p"), flat, "EUR_USD", { windows: 6 });
    assert.equal(r.pooled.trades, 0);
    assert.equal(r.consistency, 0);
    assert.ok(!Number.isNaN(r.consistency));
  });
});

describe("bootstrap significance", () => {
  it("returns p = 1 without testing when the mean is not positive", () => {
    const s = bootstrapPValue(fakeTrades([-1, -1, 2, -1]));
    assert.equal(s.pValue, 1);
    assert.equal(s.iterations, 0, "must not waste 10k iterations on a losing pattern");
  });

  it("never returns exactly zero", () => {
    // 200 wins and nothing else is as strong as a sample gets; p must still be
    // bounded away from 0, or it would clear any threshold unchallenged.
    const s = bootstrapPValue(fakeTrades(Array(200).fill(1)), { iterations: 1000 });
    assert.ok(s.pValue > 0, "p = 0 is not a conclusion a bootstrap can support");
    assert.ok(s.pValue <= 1 / 1001 + 1e-12);
  });

  it("is deterministic for a fixed seed", () => {
    const rs = [1, -1, 2, -1, 0.5, -1, 3, -1, 1, -1];
    const a = bootstrapPValue(fakeTrades(rs), { seed: 5, iterations: 2000 });
    const b = bootstrapPValue(fakeTrades(rs), { seed: 5, iterations: 2000 });
    assert.equal(a.pValue, b.pValue);
  });

  it("finds a marginal edge unconvincing on a small sample", () => {
    // Mean +0.1R over 10 trades — the shape of every overfitted backtest.
    const s = bootstrapPValue(fakeTrades([2, -1, 2, -1, -1, 2, -1, -1, 2, -1]), {
      iterations: 5000,
    });
    assert.ok(s.pValue > 0.1, `expected unconvincing, got p=${s.pValue}`);
  });

  it("grows more convinced as the same edge repeats over more trades", () => {
    const unit = [2, -1, 2, -1, -1, 2, -1, -1, 2, -1]; // mean +0.1R
    const small = bootstrapPValue(fakeTrades(unit), { iterations: 5000 });
    const large = bootstrapPValue(
      fakeTrades(Array.from({ length: 40 }, () => unit).flat()),
      { iterations: 5000 },
    );
    assert.ok(
      large.pValue < small.pValue,
      `400 trades (${large.pValue}) should beat 10 (${small.pValue})`,
    );
  });

  it("treats a pure random walk as unremarkable", () => {
    const bars = walk(3000, { seed: 11, drift: 0 });
    const r = runSegmented(pattern("noise"), bars, "EUR_USD");
    const s = bootstrapPValue(r.trades, { iterations: 5000 });
    assert.ok(s.pValue > 0.01, `noise should not look significant, got p=${s.pValue}`);
  });
});

describe("Benjamini–Hochberg", () => {
  it("handles the empty case", () => {
    assert.deepEqual(benjaminiHochberg([]), []);
  });

  it("leaves a single p-value unchanged", () => {
    assert.deepEqual(benjaminiHochberg([0.04]), [0.04]);
  });

  it("inflates p-values in proportion to how many were tested", () => {
    const alone = benjaminiHochberg([0.01])[0];
    const crowd = benjaminiHochberg([0.01, ...Array(99).fill(0.9)])[0];
    assert.ok(crowd > alone, "the same p must cost more when 100 things were tried");
    // Raw BH for rank 1 is 0.01 × 100 / 1 = 1.0, but the step-up pass caps it at
    // the smallest q above it — the 0.9s sit at rank 100, giving 0.9 × 100/100.
    // So 0.9, and the cap is what keeps q monotone in rank.
    assert.ok(Math.abs(crowd - 0.9) < 1e-9, `expected 0.9, got ${crowd}`);
  });

  it("is monotone in rank", () => {
    const ps = [0.001, 0.008, 0.02, 0.3, 0.5, 0.9];
    const qs = benjaminiHochberg(ps);
    const paired = ps.map((p, i) => ({ p, q: qs[i] })).sort((a, b) => a.p - b.p);
    for (let i = 1; i < paired.length; i++) {
      assert.ok(paired[i].q >= paired[i - 1].q, "q must not decrease as p increases");
    }
  });

  it("never exceeds 1", () => {
    for (const q of benjaminiHochberg([0.5, 0.9, 0.99])) assert.ok(q <= 1);
  });
});

describe("the gate", () => {
  const bars = walk(3000, { seed: 21, drift: 0.02 });

  it("records how many candidates were tested", () => {
    const cands: Candidate[] = [
      { pattern: pattern("a"), bars, instrument: "EUR_USD" },
      { pattern: pattern("b"), bars, instrument: "EUR_USD" },
    ];
    const r = screen(cands);
    assert.equal(r.testedCount, 2);
    assert.equal(r.passed.length + r.rejected.length, 2);
  });

  it("makes the SAME candidate harder to pass when more were tested", () => {
    // The property the whole module exists for. The candidate's own data and
    // trades are identical in both screens; only the company it keeps changes.
    const target: Candidate = { pattern: pattern("target"), bars, instrument: "EUR_USD" };
    const noise: Candidate[] = Array.from({ length: 60 }, (_, i) => ({
      pattern: pattern(`noise-${i}`),
      bars: walk(3000, { seed: 100 + i, drift: 0 }),
      instrument: "EUR_USD",
    }));

    const alone = screen([target]);
    const crowded = screen([target, ...noise]);

    const qAlone = alone.rejected.concat(alone.passed).find((v) => v.slug === "target")!;
    const qCrowded = crowded.rejected.concat(crowded.passed).find((v) => v.slug === "target")!;

    assert.equal(
      qAlone.significance.pValue,
      qCrowded.significance.pValue,
      "raw significance must not change — only the threshold does",
    );
    assert.ok(
      qCrowded.qValue >= qAlone.qValue,
      `q should rise with N: alone=${qAlone.qValue}, crowded=${qCrowded.qValue}`,
    );
  });

  it("rejects a candidate with too few trades, and says so", () => {
    const rare = pattern("rare", {
      // Fires only when close exceeds open by more than 5× ATR.
      trigger: C.gt(S.sub(S.close, S.open), S.mul(S.atr(14), S.n(5))),
    });
    const r = screen([{ pattern: rare, bars, instrument: "EUR_USD" }]);
    const v = r.rejected[0];
    assert.ok(v, "should be rejected");
    assert.match(v.reason, /trades < 30 minimum|traded in only/);
  });

  it("rejects a one-regime wonder on consistency", () => {
    // Trades only in the first sixth of the data, so it cannot clear the
    // minimum number of trading windows however well it did.
    const cutoff = bars[Math.floor(bars.length / 6)].time;
    const oneWindow = bars.map((b, i) =>
      b.time < cutoff ? b : { ...b, o: 100, h: 100, l: 100, c: 100 },
    );
    const r = screen([{ pattern: pattern("regime"), bars: oneWindow, instrument: "EUR_USD" }]);
    const v = r.rejected[0];
    assert.ok(v, "should be rejected");
    assert.match(v.reason, /traded in only|consistency/);
  });

  it("finds nothing in a field of pure noise", () => {
    // 40 random walks. Some will look good; none should survive the gate.
    const noise: Candidate[] = Array.from({ length: 40 }, (_, i) => ({
      pattern: pattern(`n${i}`),
      bars: walk(2400, { seed: 500 + i, drift: 0 }),
      instrument: "EUR_USD",
    }));
    const r = screen(noise);
    assert.equal(r.passed.length, 0, `noise passed the gate: ${r.passed.map((v) => v.slug)}`);
  });

  it("reports how many survivors are expected to be luck", () => {
    const r = screen([{ pattern: pattern("a"), bars, instrument: "EUR_USD" }]);
    assert.equal(r.expectedFalsePositives, r.passed.length * DEFAULT_CRITERIA.fdr);
  });

  it("always explains itself", () => {
    const r = screen([{ pattern: pattern("a"), bars, instrument: "EUR_USD" }]);
    for (const v of [...r.passed, ...r.rejected]) {
      assert.ok(v.reason.length > 0, `${v.slug} has no reason`);
    }
  });
});
