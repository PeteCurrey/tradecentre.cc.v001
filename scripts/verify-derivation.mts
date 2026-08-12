/**
 * Verification for the trade derivation.
 *
 *   node --conditions=react-server --import tsx scripts/verify-derivation.mts
 *
 * Three questions, in order of importance:
 *   1. Does derived P&L reconcile with the broker's own account balance?
 *   2. Is derivation idempotent — does replaying produce identical output?
 *   3. Do the resulting numbers pass basic sanity checks?
 *
 * If (1) fails, every analytics screen in the app is wrong.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const { db } = await import("../src/lib/db/index.ts");
const { transactionsRaw } = await import("../src/lib/db/schema.ts");
const { deriveTrades } = await import("../src/lib/trades/derive.ts");
const { oanda } = await import("../src/lib/oanda/client.ts");
const { eq, asc } = await import("drizzle-orm");

const ACCOUNT = "101-004-39906540-001";
const log = (s = "") => console.log(s);

const rows = await db
  .select()
  .from(transactionsRaw)
  .where(eq(transactionsRaw.accountId, ACCOUNT))
  .orderBy(asc(transactionsRaw.id));

const payloads = rows.map((r) => r.payload as never);

/* ---- 1. Reconciliation -------------------------------------------------- */
log("=== 1. RECONCILIATION vs BROKER ===");

const trades = deriveTrades(payloads);
const derivedPl = trades.reduce((s, t) => s + t.realizedPl, 0);
const derivedFin = trades.reduce((s, t) => s + t.financing, 0);
const derivedComm = trades.reduce((s, t) => s + t.commission, 0);

// Ground truth straight from the ledger, independent of any trade grouping.
let ledgerPl = 0;
let ledgerFin = 0;
let ledgerComm = 0;
let deposits = 0;
for (const r of rows) {
  const p = r.payload as Record<string, unknown>;
  if (p.type === "ORDER_FILL") {
    ledgerPl += Number(p.pl ?? 0);
    ledgerFin += Number(p.financing ?? 0);
    ledgerComm += Number(p.commission ?? 0);
  }
  if (p.type === "DAILY_FINANCING") ledgerFin += Number(p.financing ?? 0);
  if (p.type === "TRANSFER_FUNDS") deposits += Number(p.amount ?? 0);
}

const summary = await oanda("practice").accountSummary(ACCOUNT);
const brokerBalance = Number(summary.balance);
const expected = deposits + ledgerPl + ledgerFin + ledgerComm;

const f = (n: number) => (n < 0 ? "" : "+") + n.toFixed(4);

log(`  deposits              ${f(deposits)}`);
log(`  ledger realized P&L   ${f(ledgerPl)}`);
log(`  ledger financing      ${f(ledgerFin)}`);
log(`  ledger commission     ${f(ledgerComm)}`);
log(`  ─────────────────────────────────`);
log(`  computed balance      ${expected.toFixed(4)}`);
log(`  broker balance        ${brokerBalance.toFixed(4)}`);
const balDiff = Math.abs(expected - brokerBalance);
log(`  difference            ${balDiff.toFixed(6)}  ${balDiff < 0.01 ? "✓ reconciles" : "✗ MISMATCH"}`);

log();
log(`  derived P&L (trades)  ${f(derivedPl)}`);
log(`  ledger P&L            ${f(ledgerPl)}`);
const plDiff = Math.abs(derivedPl - ledgerPl);
log(
  `  difference            ${plDiff.toFixed(6)}  ` +
    `${plDiff < 0.01 ? "✓ every fill accounted for" : "✗ trades are losing P&L"}`,
);

/* ---- 2. Idempotency ----------------------------------------------------- */
log("\n=== 2. IDEMPOTENCY ===");

const hash = (t: unknown) =>
  createHash("sha256").update(JSON.stringify(t)).digest("hex");

const a = hash(deriveTrades(payloads));
const b = hash(deriveTrades(payloads));
// Shuffled input: ledger order must be reconstructed from ids, not assumed.
const shuffled = [...payloads].sort(() => Math.random() - 0.5);
const c = hash(deriveTrades(shuffled));

log(`  replay identical          ${a === b ? "✓" : "✗"}`);
log(`  order-independent         ${a === c ? "✓" : "✗ derivation depends on input order"}`);

/* ---- 3. Sanity ---------------------------------------------------------- */
log("\n=== 3. SANITY ===");

const closed = trades.filter((t) => t.state === "closed");
const withR = closed.filter((t) => t.rMultiple !== null);
const wins = closed.filter((t) => t.realizedPl > 0).length;
const losses = closed.filter((t) => t.realizedPl < 0).length;
const scratches = closed.length - wins - losses;

const rs = withR.map((t) => t.rMultiple!).sort((x, y) => x - y);
const avgR = rs.reduce((s, r) => s + r, 0) / (rs.length || 1);
const grossWin = closed.filter((t) => t.realizedPl > 0).reduce((s, t) => s + t.realizedPl, 0);
const grossLoss = Math.abs(
  closed.filter((t) => t.realizedPl < 0).reduce((s, t) => s + t.realizedPl, 0),
);
const spread = trades.reduce((s, t) => s + t.spreadCost, 0);

log(`  trades                ${trades.length} (${closed.length} closed)`);
log(`  win / loss / scratch  ${wins} / ${losses} / ${scratches}`);
log(`  win rate              ${((wins / (closed.length || 1)) * 100).toFixed(1)}%`);
log(`  average R             ${avgR.toFixed(3)}`);
log(`  R range               ${rs[0]?.toFixed(2)} … ${rs[rs.length - 1]?.toFixed(2)}`);
log(`  median R              ${rs[Math.floor(rs.length / 2)]?.toFixed(2)}`);
log(`  profit factor         ${grossLoss ? (grossWin / grossLoss).toFixed(3) : "n/a"}`);
log(`  spread cost paid      ${spread.toFixed(2)}`);
log(`  spread as % of gross  ${grossWin ? ((spread / grossWin) * 100).toFixed(1) + "%" : "n/a"}`);

// Outliers are how derivation bugs announce themselves.
const extreme = withR.filter((t) => Math.abs(t.rMultiple!) > 10);
log(`  |R| > 10 outliers     ${extreme.length}${extreme.length ? "  ⚠ inspect these" : "  ✓"}`);
for (const t of extreme.slice(0, 5)) {
  log(
    `      trade ${t.oandaTradeId} ${t.instrument} ${t.direction} ` +
      `R=${t.rMultiple!.toFixed(1)} pl=${t.realizedPl.toFixed(2)} risk=${t.initialRisk?.toFixed(2)}` +
      `${t.stopFromTrailing ? " (trailing-derived stop)" : ""}`,
  );
}

const noStop = trades.filter((t) => t.plannedStop === null);
log(`  trades without a stop ${noStop.length}`);
for (const t of noStop.slice(0, 5)) {
  log(`      trade ${t.oandaTradeId} ${t.instrument} entered ${t.entryTime}`);
}

log();
process.exit(0);
