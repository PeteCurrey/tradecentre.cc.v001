/**
 * Sync the OANDA ledger and derive trades from it.
 *
 *   npm run sync            incremental
 *   npm run sync -- --rebuild   re-fetch the whole ledger and rebuild every trade
 *
 * --rebuild is safe by construction: the ledger is immutable and trades are
 * derived, so this is how a derivation bug gets fixed — never data surgery on
 * the trades table.
 *
 * The actual work lives in src/lib/trades/rebuild.ts, shared with the in-app
 * sync button so the two can never drift apart.
 */

import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const rebuild = process.argv.includes("--rebuild");
const { syncAndDerive } = await import("../src/lib/trades/rebuild.ts");

const summary = await syncAndDerive({ fromScratch: rebuild });

console.log(`\n=== SYNC ${rebuild ? "(full rebuild)" : "(incremental)"} ===`);
for (const r of summary.results) {
  const s = r.stats;
  const pct = (n: number) => (s.total ? `${((n / s.total) * 100).toFixed(0)}%` : "—");
  console.log(
    `  ✓ ${r.accountId} (${r.book})\n` +
      `      ${r.inserted} new transactions → ${s.total} trades ` +
      `(${s.closed} closed, ${s.open} open, ${s.instruments} instruments)\n` +
      `      planned stop ${s.withPlannedStop} (${pct(s.withPlannedStop)})   ` +
      `R computed ${s.withRMultiple} (${pct(s.withRMultiple)})   ` +
      `trailing-derived ${s.trailingStops}`,
  );
}

if (summary.errors.length > 0) {
  console.log("\n  errors:");
  for (const e of summary.errors) console.log(`    ✗ ${e}`);
}

console.log(
  `\n  ${summary.totalNew} new transactions, ${summary.totalTrades} trades total, ` +
    `${(summary.durationMs / 1000).toFixed(1)}s\n`,
);

process.exit(0);
