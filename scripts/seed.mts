/**
 * Seed reference data.
 *
 * Idempotent — safe to re-run. Every insert upserts on its natural key, so
 * this can be run after adding accounts, after OANDA adds instruments, or
 * after editing the seed patterns.
 *
 *   node --conditions=react-server --import tsx scripts/seed.mts
 */

import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const { db } = await import("../src/lib/db/index.ts");
const { accounts, appConfig, books, instruments, patterns } = await import(
  "../src/lib/db/schema.ts"
);
const { oanda } = await import("../src/lib/oanda/client.ts");
const { ownerUser } = await import("../src/lib/identity/user.ts");
const { SEED_PATTERNS } = await import("../src/lib/patterns/seed.ts");
const {
  DEFAULT_CONVICTION_MULTIPLIERS,
  DEFAULT_HORIZON_THRESHOLDS,
  BOOK_LIST,
} = await import("../src/lib/books.ts");

const log = (s: string) => console.log(s);

/* ---- Books ------------------------------------------------------------- */
log("\n=== BOOKS ===");
for (const b of BOOK_LIST) {
  await db
    .insert(books)
    .values({
      id: b.id,
      label: b.label,
      // Peter chose 0.5–1% base risk; 0.75% sits mid-range as a starting point.
      baseRiskPct: "0.75",
      dailyLimitR: "3.00",
      convictionMultipliers: DEFAULT_CONVICTION_MULTIPLIERS,
    })
    .onConflictDoUpdate({
      target: books.id,
      // Preserve Peter's tuned risk settings on re-run; only refresh the label.
      set: { label: b.label },
    });
  log(`  ✓ ${b.label.padEnd(10)} base 0.75%  daily limit 3.00R`);
}

/* ---- Accounts ---------------------------------------------------------- */
log("\n=== ACCOUNTS ===");

/**
 * Map accounts to books by the ALIAS Peter gave them in OANDA.
 *
 * He named his sub-accounts by instrument class — Primary, FX, Indices,
 * Commodities — so the alias is the intent. Matching on it beats guessing from
 * position order, and spelling is handled loosely because the aliases contain
 * typos ("Indicies", "Commodoties") that shouldn't break the mapping.
 */
function bookFromAlias(alias: string | null | undefined, fallbackIndex: number): string {
  const a = (alias ?? "").toLowerCase();
  if (/indic|indice|index/.test(a)) return "indices";
  if (/commod|comod|metal|oil|gas|gold/.test(a)) return "commodities";
  if (/\bfx\b|forex|currenc/.test(a)) return "fx";
  if (/primary|main/.test(a)) return "primary";
  // No recognisable alias — fall back to position order, still changeable
  // from Settings.
  return (["primary", "fx", "indices", "commodities"] as const)[fallbackIndex % 4];
}

/**
 * Accounts discovered by seeding belong to the OWNER.
 *
 * Seeding runs from the command line with no session, and the tokens it reads
 * are Pete's own from the environment — so the only member these accounts could
 * belong to is him. A member's own accounts are attached through the app, under
 * their own session, never here.
 */
const owner = await ownerUser();

for (const environment of ["practice", "live"] as const) {
  const tokenSet =
    environment === "live"
      ? process.env.OANDA_LIVE_TOKEN
      : process.env.OANDA_PRACTICE_TOKEN ?? process.env.OANDA_API_KEY;

  if (!tokenSet) {
    log(`  · ${environment}: no token configured, skipping`);
    continue;
  }

  let list: Array<{ id: string }>;
  try {
    list = await oanda(environment).listAccounts();
  } catch (e) {
    log(`  ✗ ${environment}: ${(e as Error).message}`);
    continue;
  }

  // Suffix order, so -001 → scalp, -002 → intraday, and so on.
  const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));

  for (const [i, acc] of sorted.entries()) {
    let currency = "GBP";
    let alias: string | null = null;
    try {
      const s = await oanda(environment).accountSummary(acc.id);
      currency = s.currency;
      alias = s.alias ?? null;
    } catch {
      // 403 on a sub-account the token can't reach — record it anyway so it
      // shows in Settings as needing attention rather than vanishing.
    }

    const book = bookFromAlias(alias, i) as "primary" | "fx" | "indices" | "commodities";

    await db
      .insert(accounts)
      .values({ id: acc.id, userId: owner.id, book, environment, currency, alias })
      .onConflictDoUpdate({
        target: accounts.id,
        // Never clobber a mapping Peter has set in Settings.
        set: { currency, alias },
      });

    log(
      `  ✓ ${acc.id}  ${environment.padEnd(8)} → ${book.padEnd(12)} ` +
        `${currency}  (alias "${alias ?? "—"}")`,
    );
  }
}

/* ---- Instruments ------------------------------------------------------- */
log("\n=== INSTRUMENTS ===");

function assetClass(name: string, type: string): string {
  if (type === "METAL") return "metal";
  if (type === "CURRENCY") return "fx";
  if (/SPX|NAS|US30|UK100|DE30|DE40|JP225|CN50|HK33|AU200|EU50|FR40|SG30|TWIX|IN50|NL25|CH20|ESP35/.test(name))
    return "index";
  if (/WTICO|BCO|NATGAS|CORN|SUGAR|SOYBN|WHEAT|XCU|XPT|XPD/.test(name)) return "commodity";
  if (/BTC|ETH|LTC|BCH|XRP/.test(name)) return "crypto";
  return "cfd";
}

const anyAccount = await db.query.accounts.findFirst({
  where: (a, { eq }) => eq(a.environment, "practice"),
});

if (!anyAccount) {
  log("  · no practice account available, skipping");
} else {
  const list = await oanda("practice").instruments(anyAccount.id);
  const counts: Record<string, number> = {};

  for (const inst of list) {
    const cls = assetClass(inst.name, inst.type);
    counts[cls] = (counts[cls] ?? 0) + 1;
    await db
      .insert(instruments)
      .values({
        name: inst.name,
        displayName: inst.displayName,
        type: inst.type,
        pipLocation: inst.pipLocation,
        displayPrecision: inst.displayPrecision,
        marginRate: inst.marginRate ?? null,
        assetClass: cls,
      })
      .onConflictDoUpdate({
        target: instruments.name,
        set: {
          displayName: inst.displayName,
          pipLocation: inst.pipLocation,
          displayPrecision: inst.displayPrecision,
          marginRate: inst.marginRate ?? null,
          assetClass: cls,
        },
      });
  }
  log(`  ✓ ${list.length} instruments`);
  for (const [k, v] of Object.entries(counts).sort()) log(`      ${k.padEnd(10)} ${v}`);
}

/* ---- Patterns ---------------------------------------------------------- */
log("\n=== PATTERNS ===");
log("  All seeded as `incubating` — nothing reaches live capital untested.");
log("  Visibility `house` — the curated library every member can read.");

for (const p of SEED_PATTERNS) {
  await db
    .insert(patterns)
    .values({
      // The house library: userId null, readable by every member, editable by
      // the owner alone. Not attributed to Pete's user row on purpose — the
      // library is a property of the platform, not of one account.
      userId: null,
      visibility: "house",
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      tags: {
        // Horizon, not book: a pattern's hold time is a property of the setup,
        // while a book is an instrument-class account.
        horizons: [p.horizon],
        conditions: [p.family],
        instrumentClasses: p.instrumentClasses,
        timeframes: [p.timeframe],
      },
      triggerRules: [p.trigger],
      invalidation: p.invalidation,
      contextFilters: {
        direction: p.direction,
        timeframe: p.timeframe,
        notes: p.contextNotes,
        invalidationRule: p.invalidationRule ?? null,
        stop: p.stop,
        targets: p.targets,
        management: p.management ?? null,
      },
      targetLogic: p.targets.map((t) => JSON.stringify(t)).join(" then "),
      status: "incubating",
    })
    .onConflictDoUpdate({
      target: patterns.slug,
      set: {
        name: p.name,
        summary: p.summary,
        triggerRules: [p.trigger],
        invalidation: p.invalidation,
        // Deliberately NOT resetting `status` — a pattern Peter has promoted
        // to live must not be demoted by re-running the seed.
      },
    });
}

const byHorizon: Record<string, number> = {};
for (const p of SEED_PATTERNS) byHorizon[p.horizon] = (byHorizon[p.horizon] ?? 0) + 1;
log(`  ✓ ${SEED_PATTERNS.length} patterns`);
for (const [k, v] of Object.entries(byHorizon)) log(`      ${k.padEnd(10)} ${v}`);

/* ---- App config -------------------------------------------------------- */
log("\n=== CONFIG ===");
await db
  .insert(appConfig)
  .values({ id: 1, horizonThresholds: DEFAULT_HORIZON_THRESHOLDS })
  // Never overwrite thresholds Peter has tuned.
  .onConflictDoNothing();
const t = DEFAULT_HORIZON_THRESHOLDS;
log(
  `  ✓ horizon boundaries: scalp ≤${t.scalpMaxMinutes}m · ` +
    `intraday ≤${t.intradayMaxMinutes / 60}h · swing ≤${t.swingMaxMinutes / 1440}d · ` +
    `beyond that, position`,
);

log("\nSeed complete.\n");
process.exit(0);
