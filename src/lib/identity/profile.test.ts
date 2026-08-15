import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AVATAR_MAX_CHARS,
  initials,
  validateAvatar,
  validateJobTitle,
  validateUsername,
} from "./profile";

describe("username", () => {
  it("accepts an ordinary name", () => {
    assert.deepEqual(validateUsername("gold_bug"), { ok: true, value: "gold_bug" });
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(validateUsername("  trader7  "), { ok: true, value: "trader7" });
  });

  it("refuses names that are too short or too long", () => {
    assert.equal(validateUsername("ab").ok, false);
    assert.equal(validateUsername("a".repeat(21)).ok, false);
  });

  it("refuses spaces and punctuation", () => {
    assert.equal(validateUsername("gold bug").ok, false);
    assert.equal(validateUsername("gold-bug").ok, false);
    assert.equal(validateUsername("gold.bug").ok, false);
  });

  it("refuses digits alone, so a name cannot pose as an id", () => {
    assert.equal(validateUsername("12345").ok, false);
  });

  it("refuses reserved staff names", () => {
    for (const name of ["admin", "Moderator", "SYSTEM", "support", "peter"]) {
      assert.equal(validateUsername(name).ok, false, `${name} should be reserved`);
    }
  });

  it("allows a reserved word as part of a longer name", () => {
    // "admin" is the impersonation risk; "administrative_al" is a person.
    assert.equal(validateUsername("admin_al").ok, true);
  });

  it("refuses unicode look-alikes", () => {
    // Cyrillic а — indistinguishable from Latin a, and the whole reason the
    // character set is narrow.
    assert.equal(validateUsername("trаder").ok, false);
  });
});

describe("job title", () => {
  it("accepts an ordinary title and collapses inner whitespace", () => {
    assert.deepEqual(validateJobTitle("  Prop   Trader "), {
      ok: true,
      value: "Prop Trader",
    });
  });

  it("treats empty as valid — a title is optional", () => {
    assert.deepEqual(validateJobTitle("   "), { ok: true, value: "" });
  });

  it("refuses newlines, which would let a title take over the message list", () => {
    assert.equal(validateJobTitle("Trader\n\n\nBIG TEXT").ok, false);
  });

  it("refuses an over-long title", () => {
    assert.equal(validateJobTitle("x".repeat(61)).ok, false);
  });
});

describe("avatar", () => {
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==";

  it("accepts a small jpeg data url", () => {
    assert.deepEqual(validateAvatar(jpeg), { ok: true, value: jpeg });
  });

  it("treats absent as valid", () => {
    assert.deepEqual(validateAvatar(null), { ok: true, value: "" });
    assert.deepEqual(validateAvatar(""), { ok: true, value: "" });
  });

  it("refuses SVG, which can carry script", () => {
    const svg = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=";
    assert.equal(validateAvatar(svg).ok, false);
  });

  it("refuses a remote url", () => {
    assert.equal(validateAvatar("https://example.com/me.jpg").ok, false);
  });

  it("refuses a javascript: payload", () => {
    assert.equal(validateAvatar("javascript:alert(1)").ok, false);
  });

  it("refuses base64 with characters that do not belong in it", () => {
    assert.equal(validateAvatar('data:image/jpeg;base64,abc"><script>').ok, false);
  });

  it("refuses an oversized image", () => {
    const huge = "data:image/jpeg;base64," + "A".repeat(AVATAR_MAX_CHARS);
    assert.equal(validateAvatar(huge).ok, false);
  });
});

describe("initials", () => {
  it("takes first and last for a multi-part name", () => {
    assert.equal(initials("gold_bug"), "GB");
    assert.equal(initials("Jane Trader"), "JT");
  });

  it("takes two letters from a single word", () => {
    assert.equal(initials("trader"), "TR");
  });

  it("never returns empty", () => {
    assert.equal(initials("   "), "?");
  });
});
