import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import { hashPassword } from "../../../scripts/hash-password.mjs";
import { parseStoredHash, verifyAgainst } from "./password";

/**
 * The dotenv-expansion trap, pinned.
 *
 * `.env` values are variable-expanded before the app sees them, and an
 * unescaped scrypt hash is destroyed by it: `scrypt$16384$8$1$…` has `$16384`,
 * `$8` and `$1` substituted away. Verification then fails at the parse, so
 * every password is rejected — including the correct one — while the login
 * screen says "Incorrect password".
 *
 * That cost real debugging time once. These tests exist so the unusable-hash
 * case stays distinguishable from the wrong-password case.
 *
 * Everything here tests the PURE functions, which is the reason they are pure:
 * `env()` memoises, so anything reading it directly could only be tested
 * against whichever value the process loaded first.
 */

const PASSWORD = "a-sufficiently-long-test-password";

/** What variable expansion actually does: eats `$` plus the identifier after it. */
function asDotenvWouldMangle(hash: string): string {
  return hash.replace(/\$[A-Za-z0-9_]*/g, "");
}

describe("parsing a stored hash", () => {
  it("accepts a hash straight from the generator", () => {
    assert.notEqual(parseStoredHash(hashPassword(PASSWORD)), null);
  });

  it("rejects a hash mangled by env-variable expansion", () => {
    const mangled = asDotenvWouldMangle(hashPassword(PASSWORD));
    // The exact failure that started this: it no longer has six fields.
    assert.notEqual(mangled.split("$").length, 6);
    assert.equal(parseStoredHash(mangled), null);
  });

  it("rejects other shapes that would silently reject every password", () => {
    for (const bad of [
      "",
      "not-a-hash",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==", // wrong scheme
      "scrypt$16384$8$1$c2FsdA==", // truncated
      "scrypt$16384$8$1$$aGFzaA==", // empty salt
      "scrypt$16384$8$1$c2FsdA==$", // empty key
      "scrypt$abc$8$1$c2FsdA==$aGFzaA==", // non-numeric cost
      "scrypt$0$8$1$c2FsdA==$aGFzaA==", // nonsensical cost
    ]) {
      assert.equal(parseStoredHash(bad), null, `should reject: ${bad}`);
    }
  });

  it("reads cost parameters rather than assuming them", () => {
    // A hash written at a lower cost factor must still parse, so raising the
    // factor later cannot lock anyone out.
    const parsed = parseStoredHash(
      `scrypt$1024$8$1$${randomBytes(16).toString("base64")}$${randomBytes(64).toString("base64")}`,
    );
    assert.equal(parsed?.N, 1024);
  });
});

describe("verifying a password", () => {
  it("accepts the correct password and rejects a wrong one", async () => {
    const stored = parseStoredHash(hashPassword(PASSWORD))!;
    assert.equal(await verifyAgainst(PASSWORD, stored), true);
    assert.equal(await verifyAgainst("wrong", stored), false);
    // Case and whitespace are not forgiven — this guards a broker connection.
    assert.equal(await verifyAgainst(PASSWORD.toUpperCase(), stored), false);
    assert.equal(await verifyAgainst(` ${PASSWORD}`, stored), false);
    assert.equal(await verifyAgainst("", stored), false);
  });

  it("verifies a hash written at a different cost factor", async () => {
    const salt = randomBytes(16);
    const key = scryptSync(PASSWORD, salt, 64, { N: 1024, r: 8, p: 1 });
    const stored = parseStoredHash(
      `scrypt$1024$8$1$${salt.toString("base64")}$${key.toString("base64")}`,
    )!;
    assert.equal(await verifyAgainst(PASSWORD, stored), true);
  });

  it("does not throw on absurd cost parameters", async () => {
    // scrypt rejects these internally; a thrown error would surface as a 500
    // on the login route rather than a clean refusal.
    const stored = parseStoredHash(
      `scrypt$3$8$1$${randomBytes(16).toString("base64")}$${randomBytes(64).toString("base64")}`,
    )!;
    assert.equal(await verifyAgainst(PASSWORD, stored), false);
  });
});
