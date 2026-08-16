import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Tenant isolation, asserted at source level.
 *
 * The same technique as `no-write.test.ts`, for the same reason: a guarantee
 * that depends on everyone remembering is not a guarantee. Reviewing "did this
 * query name a user?" by eye across forty files fails silently and exactly
 * once, and the cost of that failure is one member reading another's ledger —
 * or arming their capital.
 *
 * These tests are intentionally crude. They read source text and look for a
 * scoping predicate near a query. That over-approximates, so a genuinely safe
 * query can be flagged — in which case ADD THE SCOPE OR ADD AN EXEMPTION WITH A
 * REASON. Do not loosen the pattern to make a failure go away; the whole value
 * is that it is annoying to bypass.
 */

const ROOT = process.cwd();

/** Tables that hold one member's data and must never be read unscoped. */
const TENANT_TABLES = [
  "trades",
  "accounts",
  "orderLog",
  "tradeAnnotations",
  "executionState",
  "transactionsRaw",
];

/**
 * Files allowed to query these tables without naming a user, each with the
 * reason it is safe. Anything not on this list must scope.
 */
const EXEMPT: Record<string, string> = {
  "src/lib/db/schema.ts": "defines the tables; queries nothing",
  "src/lib/identity/tenant.ts": "IS the scoping helper — ownedAccountIds builds the filter",
  "src/lib/desk/snapshot.ts": "takes userId as its first parameter and filters on it",
  "src/lib/desk/broadcast.ts": "builds per-user pushes; userId flows in from the hub",
  "src/lib/analytics/load.ts": "LoadOptions.userId is required and filters every query",
  "src/lib/execution/engine.ts": "scoped by the arm state's userId on every path",
  "src/lib/execution/actions.ts": "every action resolves actingUser() first",
  "src/lib/trades/rebuild.ts":
    "maintenance path: re-derives the whole ledger from transactions_raw for every account, by design",
  "src/lib/trades/sync-action.ts":
    "maintenance path: pulls the broker ledger for every configured account",
  "src/lib/oanda/sync.ts": "maintenance path: writes raw transactions per account it is handed",
  "src/instrumentation.ts": "boot: seeds owner rows only, before any request exists",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(ROOT, "src"));
const rel = (f: string) => f.replace(ROOT + "/", "");

/** Strip comments so prose about a table never counts as a query. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("tenant isolation", () => {
  it("finds source files to scan", () => {
    assert.ok(files.length > 50, `expected a populated src tree, got ${files.length}`);
  });

  it("every file querying a tenant table names a user", () => {
    const offenders: string[] = [];

    for (const f of files) {
      const name = rel(f);
      if (EXEMPT[name]) continue;

      const code = stripComments(readFileSync(f, "utf8"));

      const queries = TENANT_TABLES.some((t) =>
        new RegExp(`\\.from\\(\\s*${t}\\b`).test(code),
      );
      if (!queries) continue;

      /**
       * Scoped if it filters on a user column, or delegates to the helper that
       * does. `ownedAccountIds` is the sanctioned indirection — it exists so a
       * page does not have to spell out the account subquery each time.
       */
      const scoped =
        /ownedAccountIds\s*\(/.test(code) ||
        /\.userId\s*,/.test(code) ||
        /eq\(\s*\w+\.userId\b/.test(code);

      if (!scoped) offenders.push(name);
    }

    assert.deepEqual(
      offenders,
      [],
      "these read a tenant table without naming a user — scope them, or add an " +
        "entry to EXEMPT explaining why they are safe:\n  " +
        offenders.join("\n  "),
    );
  });

  it("the exemption list stays honest", () => {
    // An exemption for a file that no longer exists is how a list like this
    // rots into permission to do anything.
    const stale = Object.keys(EXEMPT).filter(
      (name) => !files.some((f) => rel(f) === name),
    );
    assert.deepEqual(stale, [], "EXEMPT names files that no longer exist");
  });

  it("execution state is keyed by member, not by book alone", () => {
    // `book` as a lone primary key made arm state global: one row saying
    // "commodities is armed" for everybody. This is the schema-level guarantee
    // that a per-member arm state is the only expressible kind.
    const schema = readFileSync(join(ROOT, "src/lib/db/schema.ts"), "utf8");
    const table = schema.slice(
      schema.indexOf('export const executionState'),
      schema.indexOf('export const orderOutcomeEnum'),
    );
    assert.match(
      table,
      /primaryKey\(\{\s*columns:\s*\[t\.userId,\s*t\.book\]/,
      "execution_state must be keyed on (userId, book)",
    );
    assert.doesNotMatch(
      table,
      /bookEnum\("book"\)\.primaryKey\(\)/,
      "execution_state must not key on book alone",
    );
  });

  it("accounts carry an owner, and it cannot be null", () => {
    const schema = readFileSync(join(ROOT, "src/lib/db/schema.ts"), "utf8");
    const table = schema.slice(
      schema.indexOf('export const accounts = pgTable'),
      schema.indexOf('export const books = pgTable'),
    );
    assert.match(table, /userId:\s*integer\("user_id"\)[\s\S]*?\.notNull\(\)/);
  });

  it("the live stream routes private events by owner", () => {
    // Ticks are public market data; desk, scan and engine frames are one
    // member's. The hub must refuse to hand out a subscription that does not
    // say whose it is.
    const hub = readFileSync(join(ROOT, "src/lib/stream/hub.ts"), "utf8");
    assert.match(
      hub,
      /subscribeFor\(userId:\s*number/,
      "hub must only expose a per-member subscribe",
    );
    assert.doesNotMatch(
      stripComments(hub),
      /^\s*subscribe\(fn:/m,
      "the unscoped subscribe() must not exist — it fans private data to everyone",
    );

    const route = readFileSync(join(ROOT, "src/app/api/stream/route.ts"), "utf8");
    assert.match(route, /subscribeFor\(/, "the SSE route must subscribe as a member");
  });
});
