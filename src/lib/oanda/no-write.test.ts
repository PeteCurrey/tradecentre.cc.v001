import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * The single most important test in this codebase.
 *
 * OANDA personal access tokens are full trading credentials — the v20 API has
 * no read-only scope. The app's only protection against placing a real order
 * is that the client is structurally incapable of doing so.
 *
 * These are source-level assertions on purpose. A behavioural test could pass
 * while a write path sat unused in the module; this fails the build the moment
 * one is introduced.
 */

const CLIENT_SRC = readFileSync(
  join(process.cwd(), "src/lib/oanda/client.ts"),
  "utf8",
);

/** Strip comments so documentation mentioning these terms doesn't trip the test. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(CLIENT_SRC);

describe("OANDA client is read-only by construction", () => {
  it("issues no HTTP method other than GET", () => {
    const methods = [...CODE.matchAll(/method:\s*["'`](\w+)["'`]/g)].map(
      (m) => m[1].toUpperCase(),
    );
    assert.ok(methods.length > 0, "expected to find at least one fetch call");
    for (const m of methods) {
      assert.equal(m, "GET", `found a non-GET request (${m}) in the OANDA client`);
    }
  });

  it("never targets an order-placement or position-closing endpoint", () => {
    const forbidden = [
      "/orders",
      "/close",
      "/cancel",
      "clientExtensions",
      "MARKET_ORDER",
      "LIMIT_ORDER",
    ];
    for (const frag of forbidden) {
      assert.ok(
        !CODE.includes(frag),
        `OANDA client references a write-capable path or payload: ${frag}`,
      );
    }
  });

  it("exposes no write-shaped methods", () => {
    const banned = /\b(?:async\s+)?(post|put|patch|delete|createOrder|closeTrade|closePosition|modifyTrade)\s*[(<]/i;
    assert.ok(
      !banned.test(CODE),
      "OANDA client exposes a method whose name implies a write",
    );
  });

  it("is guarded against ever reaching the browser bundle", () => {
    assert.ok(
      /^import\s+["']server-only["'];/m.test(CLIENT_SRC),
      "client.ts must import 'server-only' so a client-component import fails the build",
    );
  });
});

describe("environment secrets are never publicly exposed", () => {
  const ENV_SRC = readFileSync(join(process.cwd(), "src/lib/env.ts"), "utf8");

  it("declares no NEXT_PUBLIC_ variables", () => {
    // Comments are stripped first: the file deliberately *documents* the rule,
    // and the prohibition applies to code, not to the warning about it.
    assert.ok(
      !stripComments(ENV_SRC).includes("NEXT_PUBLIC_"),
      "env.ts must not declare NEXT_PUBLIC_ variables — they ship to the browser",
    );
  });

  it("imports server-only", () => {
    assert.ok(/^import\s+["']server-only["'];/m.test(ENV_SRC));
  });
});

describe("all data access is server-side", () => {
  /**
   * Decision: the browser never talks to Postgres directly. Everything goes
   * through server routes, exactly as the OANDA token does.
   *
   * One security model for the whole app means there is no RLS policy that can
   * be misconfigured into exposing the trade history — because the browser has
   * no credential to query with in the first place.
   */
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      // Test files never reach the browser bundle, and this one necessarily
      // contains the very string it is scanning for.
      else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  const files = walk(join(process.cwd(), "src"));

  it("finds source files to scan", () => {
    assert.ok(files.length > 10, `expected a populated src tree, found ${files.length}`);
  });

  it("declares no NEXT_PUBLIC_ variables anywhere in src", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      if (code.includes("NEXT_PUBLIC_")) {
        offenders.push(f.replace(process.cwd() + "/", ""));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `NEXT_PUBLIC_ vars are compiled into the browser bundle. Found in: ${offenders.join(", ")}`,
    );
  });

  it("never imports the db client from a client component", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const isClient = /^\s*["']use client["']/m.test(src);
      if (!isClient) continue;
      if (/from\s+["']@\/lib\/db/.test(src) || /from\s+["']@\/lib\/env/.test(src)) {
        offenders.push(f.replace(process.cwd() + "/", ""));
      }
    }
    assert.deepEqual(offenders, [], `client components importing server modules: ${offenders.join(", ")}`);
  });
});
