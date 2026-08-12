/**
 * Run the seed patterns against real OANDA history.
 *
 *   node --conditions=react-server --import tsx scripts/backtest.mts
 *
 * ⚠️ Read the results sceptically. Twenty patterns tested against one dataset
 * will produce winners by chance — with 20 tries, something clears p<0.05
 * roughly two times in three even if nothing works. That is why out-of-sample
 * is reported separately: a pattern that is strong in-sample and falls apart
 * out-of-sample has told you it was noise.
 */

import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const { oanda } = await import("../src/lib/oanda/client.ts");
const { SEED_PATTERNS } = await import("../src/lib/patterns/seed.ts");
const { backtest, defaultCosts } = await import("../src/lib/backtest/engine.ts");
type Bar = import("../src/lib/indicators/index.ts").Bar;

const log = (s = "") => console.log(s);

/** One instrument per asset class, so every pattern has somewhere to run. */
const INSTRUMENTS: Array<{ name: string; cls: string }> = [
  { name: "EUR_USD", cls: "fx" },
  { name: "XAU_USD", cls: "commodity" },
  { name: "SPX500_USD", cls: "index" },
  { name: "WTICO_USD", cls: "commodity" },
];

/** Bars per timeframe. OANDA caps a single request at 5000. */
const DEPTH: Record<string, number> = { M5: 25000, M15: 25000, H4: 8000, D: 4000 };

const client = oanda("practice");
const cache = new Map<string, Bar[]>();

async function candles(instrument: string, granularity: string): Promise<Bar[]> {
  const key = `${instrument}:${granularity}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const want = DEPTH[granularity] ?? 5000;
  const out: Bar[] = [];
  let to: string | undefined;

  // Page backwards from now until we have enough history.
  while (out.length < want) {
    const count = Math.min(5000, want - out.length);
    const res = await client.candles(instrument, {
      granularity: granularity as never,
      count,
      to,
      price: "M",
    });
    const page = (res.candles ?? [])
      .filter((c) => c.complete && c.mid)
      .map((c) => ({
        time: Date.parse(c.time),
        o: Number(c.mid!.o),
        h: Number(c.mid!.h),
        l: Number(c.mid!.l),
        c: Number(c.mid!.c),
        v: c.volume,
      }));
    if (page.length === 0) break;
    out.unshift(...page);
    to = new Date(page[0].time).toISOString();
    if (page.length < count) break;
  }

  cache.set(key, out);
  return out;
}

/* ---- Run ---------------------------------------------------------------- */

type Row = {
  slug: string;
  horizon: string;
  instrument: string;
  trades: number;
  winRate: number;
  avgR: number;
  totalR: number;
  pf: number;
  maxDd: number;
  isTrades: number;
  isAvgR: number;
  oosTrades: number;
  oosAvgR: number;
};

const rows: Row[] = [];

for (const pattern of SEED_PATTERNS) {
  const classes = new Set(pattern.instrumentClasses);
  const targets = INSTRUMENTS.filter((i) => classes.has(i.cls));
  if (targets.length === 0) continue;

  for (const inst of targets) {
    const bars = await candles(inst.name, pattern.timeframe);
    if (bars.length < 300) {
      log(`  · ${pattern.slug} on ${inst.name}: only ${bars.length} bars, skipping`);
      continue;
    }

    const r = backtest(pattern, bars, inst.name, { costs: defaultCosts(inst.name) });
    rows.push({
      slug: pattern.slug,
      horizon: pattern.horizon,
      instrument: inst.name,
      trades: r.stats.trades,
      winRate: r.stats.winRate,
      avgR: r.stats.avgR,
      totalR: r.stats.totalR,
      pf: r.stats.profitFactor,
      maxDd: r.stats.maxDrawdownR,
      isTrades: r.inSample.trades,
      isAvgR: r.inSample.avgR,
      oosTrades: r.outOfSample.trades,
      oosAvgR: r.outOfSample.avgR,
    });
  }
}

/* ---- Report ------------------------------------------------------------- */

const n = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pad = (s: string, w: number) => s.padEnd(w);
const padL = (s: string, w: number) => s.padStart(w);

log("\n" + "=".repeat(104));
log("BACKTEST — seed patterns on real OANDA history, costs included");
log("=".repeat(104));
log(
  pad("pattern", 30) + pad("instrument", 12) + padL("N", 6) +
  padL("win%", 7) + padL("avgR", 8) + padL("totR", 8) + padL("PF", 7) +
  padL("maxDD", 7) + padL("| isN", 7) + padL("isAvgR", 9) +
  padL("| oosN", 8) + padL("oosAvgR", 9),
);
log("-".repeat(104));

// Ranked by total R — but the in-sample / out-of-sample columns are the ones
// that matter. Strong in-sample and weak out-of-sample means noise.
for (const r of [...rows].sort((a, b) => b.totalR - a.totalR)) {
  log(
    pad(r.slug, 30) + pad(r.instrument, 12) + padL(String(r.trades), 6) +
    padL(n(r.winRate * 100, 1), 7) + padL(n(r.avgR, 3), 8) + padL(n(r.totalR, 1), 8) +
    padL(n(r.pf), 7) + padL(n(r.maxDd, 1), 7) +
    padL(String(r.isTrades), 7) + padL(n(r.isAvgR, 3), 9) +
    padL(String(r.oosTrades), 8) + padL(n(r.oosAvgR, 3), 9),
  );
}

const withSample = rows.filter((r) => r.isTrades >= 30);
const posInSample = withSample.filter((r) => r.isAvgR > 0);
const heldUp = posInSample.filter((r) => r.oosTrades >= 10 && r.oosAvgR > 0);

log("-".repeat(104));
log(`  ${rows.length} pattern/instrument combinations tested`);
log(`  ${withSample.length} with a usable in-sample count (30+ trades)`);
log(`  ${posInSample.length} positive IN-SAMPLE`);
log(`  ${heldUp.length} ALSO positive out-of-sample with 10+ OOS trades:`);
for (const r of heldUp.sort((a, b) => b.oosAvgR - a.oosAvgR)) {
  log(
    `      ${pad(r.slug, 30)} ${pad(r.instrument, 12)} ` +
      `in ${n(r.isAvgR, 3)}R × ${r.isTrades}   out ${n(r.oosAvgR, 3)}R × ${r.oosTrades}`,
  );
}

// Per-book roll-up: the clearest signal in this whole table.
log();
log("  BY HORIZON (in-sample average R, trades with a usable sample):");
for (const h of ["scalp", "intraday", "swing", "position"]) {
  const b = withSample.filter((r) => r.horizon === h);
  if (!b.length) {
    log(`      ${pad(h, 10)} no combination reached a usable sample`);
    continue;
  }
  const avg = b.reduce((s, r) => s + r.isAvgR, 0) / b.length;
  const pos = b.filter((r) => r.isAvgR > 0).length;
  log(`      ${pad(h, 10)} mean avgR ${padL(n(avg, 3), 7)}   ${pos}/${b.length} positive`);
}

log();
log("  Anything above is a CANDIDATE for demo forward-testing, not a result.");
log("  Twenty patterns on one dataset produce winners by chance alone.");
log();

process.exit(0);
