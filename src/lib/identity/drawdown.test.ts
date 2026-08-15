import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SignJWT } from "jose";
import { verifyDrawdownToken } from "./drawdown";

/**
 * The SSO boundary.
 *
 * This is the only thing standing between a stranger and a member session, so
 * every rejection path is asserted rather than assumed. A test that only
 * proves the happy path would pass just as well against a function that
 * returned an identity for any input at all.
 */

const SECRET = "test-secret-at-least-32-characters-long!!";
const OTHER_SECRET = "a-completely-different-secret-32-chars!!!";

function key(s: string) {
  return new TextEncoder().encode(s);
}

type Claims = {
  iss?: string;
  aud?: string;
  sub?: string;
  name?: string;
  iatOffsetSeconds?: number;
  expiresIn?: string;
  signWith?: string;
};

async function token(c: Claims = {}): Promise<string> {
  const iat = Math.floor(Date.now() / 1000) + (c.iatOffsetSeconds ?? 0);
  let jwt = new SignJWT({ name: c.name ?? "Jane Trader" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setIssuer(c.iss ?? "drawdown")
    .setAudience(c.aud ?? "trading-desk")
    .setExpirationTime(c.expiresIn ?? "5m");
  if (c.sub !== null) jwt = jwt.setSubject(c.sub ?? "user_123");
  return jwt.sign(key(c.signWith ?? SECRET));
}

describe("drawdown SSO token", () => {
  const prev = process.env.DRAWDOWN_JWT_SECRET;
  before(() => {
    process.env.DRAWDOWN_JWT_SECRET = SECRET;
  });
  after(() => {
    process.env.DRAWDOWN_JWT_SECRET = prev;
  });

  it("accepts a well-formed token and namespaces the external id", async () => {
    const id = await verifyDrawdownToken(await token());
    assert.deepEqual(id, { externalId: "drawdown:user_123", displayName: "Jane Trader" });
  });

  it("namespacing keeps a Drawdown id from ever colliding with the owner row", async () => {
    // Someone whose Drawdown id is literally "local:owner" must not become Peter.
    const id = await verifyDrawdownToken(await token({ sub: "local:owner" }));
    assert.equal(id?.externalId, "drawdown:local:owner");
    assert.notEqual(id?.externalId, "local:owner");
  });

  it("falls back to a neutral display name when none is supplied", async () => {
    const id = await verifyDrawdownToken(await token({ name: "" }));
    assert.equal(id?.displayName, "Member");
  });

  it("truncates an over-long display name rather than storing it", async () => {
    const id = await verifyDrawdownToken(await token({ name: "x".repeat(200) }));
    assert.equal(id?.displayName.length, 60);
  });

  it("rejects a token signed with the wrong secret", async () => {
    assert.equal(await verifyDrawdownToken(await token({ signWith: OTHER_SECRET })), null);
  });

  it("rejects a token minted for a different audience", async () => {
    // The courses site's own token must not open a desk session.
    assert.equal(await verifyDrawdownToken(await token({ aud: "courses" })), null);
  });

  it("rejects a token from a different issuer", async () => {
    assert.equal(await verifyDrawdownToken(await token({ iss: "somewhere-else" })), null);
  });

  it("rejects an expired token", async () => {
    assert.equal(await verifyDrawdownToken(await token({ expiresIn: "-60s" })), null);
  });

  it("allows a couple of seconds of clock skew, and no more", async () => {
    // Deliberate: two servers are never perfectly in step, and rejecting a
    // token that expired a moment ago would fail real sign-ins. The tolerance
    // is seconds, not minutes — asserted here so it cannot quietly grow.
    assert.notEqual(await verifyDrawdownToken(await token({ expiresIn: "-1s" })), null);
    assert.equal(await verifyDrawdownToken(await token({ expiresIn: "-10s" })), null);
  });

  it("rejects a token older than the max age even if its own expiry is generous", async () => {
    // The issuer setting a 30-day expiry must not create a 30-day session.
    const stale = await token({ iatOffsetSeconds: -600, expiresIn: "30d" });
    assert.equal(await verifyDrawdownToken(stale), null);
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await token()).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
    assert.equal(await verifyDrawdownToken(`${h}.${forged}.${s}`), null);
  });

  it("rejects an unsigned 'none' algorithm token", async () => {
    const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(
      JSON.stringify({ iss: "drawdown", aud: "trading-desk", sub: "user_123" }),
    ).toString("base64url");
    assert.equal(await verifyDrawdownToken(`${h}.${p}.`), null);
  });

  it("rejects nothing at all", async () => {
    assert.equal(await verifyDrawdownToken(undefined), null);
    assert.equal(await verifyDrawdownToken(""), null);
  });
});
