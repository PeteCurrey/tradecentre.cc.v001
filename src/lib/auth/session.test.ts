import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createSession, verifySession, sessionCookieOptions } from "./session";

/**
 * Session tokens gate a live broker connection, so the rejection cases matter
 * more than the acceptance case.
 */

const REAL_SECRET = "test-secret-that-is-at-least-32-characters-long";

before(() => {
  process.env.AUTH_SECRET = REAL_SECRET;
});

describe("session tokens", () => {
  it("issues a token that verifies", async () => {
    assert.equal(await verifySession(await createSession()), true);
  });

  it("rejects a missing token", async () => {
    assert.equal(await verifySession(undefined), false);
    assert.equal(await verifySession(""), false);
  });

  it("rejects a tampered signature", async () => {
    const token = await createSession();
    assert.equal(await verifySession(token.slice(0, -4) + "AAAA"), false);
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await createSession()).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
    assert.equal(await verifySession(`${h}.${forged}.${s}`), false);
  });

  it("rejects anything that is not a token", async () => {
    for (const junk of ["not-a-jwt", "a.b.c", "{}", "null"]) {
      assert.equal(await verifySession(junk), false, `accepted junk: ${junk}`);
    }
  });

  it("rejects a token signed with a different secret", async () => {
    // Rotating AUTH_SECRET must invalidate every existing session.
    process.env.AUTH_SECRET = "a-completely-different-secret-of-sufficient-length";
    const foreign = await createSession();
    process.env.AUTH_SECRET = REAL_SECRET;
    assert.equal(await verifySession(foreign), false);
  });

  it("throws rather than falling back when AUTH_SECRET is absent", async () => {
    // A silent default here would sign every session with a guessable key.
    delete process.env.AUTH_SECRET;
    await assert.rejects(() => createSession(), /AUTH_SECRET/);
    process.env.AUTH_SECRET = REAL_SECRET;
  });
});

describe("session cookie", () => {
  it("is httpOnly and lax so it cannot be read by scripts or sent cross-site", () => {
    const o = sessionCookieOptions(true);
    assert.equal(o.httpOnly, true);
    assert.equal(o.sameSite, "lax");
    assert.equal(o.secure, true);
    assert.equal(o.path, "/");
  });

  it("allows insecure cookies only when explicitly asked (local http)", () => {
    assert.equal(sessionCookieOptions(false).secure, false);
  });
});
