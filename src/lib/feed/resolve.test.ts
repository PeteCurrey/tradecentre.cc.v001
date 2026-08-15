import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve } from "./resolve";
import { edgarCompany, fedImportance, parseFeed } from "./sources";

describe("instrument resolution", () => {
  it("tags a named pair in every spelling a wire uses", () => {
    for (const form of ["EUR/USD", "EURUSD", "EUR-USD"]) {
      assert.deepEqual(
        resolve(`${form} slipped on the open`).instruments,
        ["EUR_USD"],
        `failed on ${form}`,
      );
    }
  });

  it("maps commodities to the instruments Peter actually trades", () => {
    assert.deepEqual(resolve("Gold hits record high").instruments, ["XAU_USD"]);
    assert.deepEqual(resolve("Natural gas storage builds").instruments, ["NATGAS_USD"]);
    // OPEC moves both crude benchmarks, so both are tagged.
    assert.deepEqual(resolve("OPEC+ agrees output cut").instruments, [
      "BCO_USD",
      "WTICO_USD",
    ]);
  });

  it("maps a central bank to the pair that expresses it", () => {
    assert.deepEqual(resolve("ECB holds rates steady").instruments, ["EUR_USD"]);
    assert.deepEqual(resolve("Bank of England cuts").instruments, ["GBP_USD"]);
  });

  it("does NOT tag instruments on a Fed story", () => {
    // The reasoning is in resolve.ts: a Fed decision is true of every USD pair
    // at once, so seven chips would be noise rather than seven facts.
    const r = resolve("Fed holds rates, Powell signals patience");
    assert.deepEqual(r.instruments, []);
    assert.equal(r.isCentralBank, true);
    assert.equal(r.importance, 3);
  });

  it("resolves an ETF ticker to the tradeable instrument behind it", () => {
    assert.deepEqual(resolve("Fund flows surge", ["GLD"]).instruments, ["XAU_USD"]);
    assert.deepEqual(resolve("Fund flows surge", ["QQQ"]).instruments, ["NAS100_USD"]);
  });

  it("tags oil stories that never say the word 'price'", () => {
    // Both of these came off the live wire untagged before bare "oil" and
    // "Hormuz" were added.
    for (const headline of [
      "The US says more oil is leaving the Middle East, but is it really?",
      "Hormuz shipping traffic capped amid competing claims from US and Iran",
    ]) {
      assert.deepEqual(resolve(headline).instruments, ["BCO_USD", "WTICO_USD"], headline);
    }
  });

  it("respects word boundaries", () => {
    // "oilfield" and "soil" must not read as "oil" now that bare oil matches.
    assert.deepEqual(resolve("Oilfield services margins compress").instruments, []);
    // The exact failure this guards: a substring test put "Pirates" on the
    // macro calendar because it contains "rate".
    assert.equal(resolve("Pittsburgh Pirates beat the Marlins").importance, null);
    assert.deepEqual(resolve("Pittsburgh Pirates beat the Marlins").instruments, []);
    // "Goldman" must not read as "gold".
    assert.deepEqual(resolve("Goldman Sachs raises target").instruments, []);
    // "Soil" must not read as "oil".
    assert.deepEqual(resolve("Soil quality report published").instruments, []);
  });

  it("ignores a repeated currency code and untraded currencies", () => {
    assert.deepEqual(resolve("USD USD nonsense").instruments, []);
    assert.deepEqual(resolve("THB/IDR trading quietly").instruments, []);
  });

  it("returns instruments in a stable order regardless of input order", () => {
    const a = resolve("Brent and WTI both fell as OPEC met").instruments;
    const b = resolve("WTI and Brent both fell as OPEC met").instruments;
    assert.deepEqual(a, b);
  });

  it("does not leak regex state between calls", () => {
    // A shared /g regex with exec() would drop tags on every other call. The
    // symptom is intermittent and horrible to trace, so it is pinned here.
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(resolve("GBP/USD rallied").instruments, ["GBP_USD"]);
    }
  });
});

describe("feed parsing", () => {
  it("reads an RSS item", () => {
    const xml = `<rss><channel>
      <item>
        <title>FOMC statement</title>
        <link>https://example.gov/a</link>
        <description>&lt;p&gt;The Committee decided&lt;/p&gt;</description>
        <pubDate>Thu, 14 Aug 2026 18:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;

    const [e] = parseFeed(xml);
    assert.equal(e.title, "FOMC statement");
    assert.equal(e.link, "https://example.gov/a");
    assert.equal(e.summary, "The Committee decided");
    assert.ok(!Number.isNaN(new Date(e.date).getTime()));
  });

  it("reads an Atom entry, taking the link from its href attribute", () => {
    const xml = `<feed>
      <entry>
        <title>8-K - ACME CORP (0000123456) (Filer)</title>
        <link rel="alternate" href="https://sec.gov/x"/>
        <summary>Material event</summary>
        <updated>2026-08-14T18:00:00Z</updated>
      </entry>
    </feed>`;

    const [e] = parseFeed(xml);
    assert.equal(e.link, "https://sec.gov/x");
    assert.match(e.title, /ACME CORP/);
  });

  it("unwraps CDATA and decodes ampersands last", () => {
    const xml = `<rss><item>
      <title><![CDATA[Jones & Co]]></title>
      <description>AT&amp;T and &amp;lt;tag&amp;gt;</description>
      <pubDate>Thu, 14 Aug 2026 18:00:00 GMT</pubDate>
    </item></rss>`;

    const [e] = parseFeed(xml);
    assert.equal(e.title, "Jones & Co");
    // If & decoded first, "&amp;lt;" would collapse to "<" in two passes.
    assert.equal(e.summary, "AT&T and &lt;tag&gt;");
  });

  it("skips an entry with no title rather than inventing one", () => {
    assert.deepEqual(parseFeed(`<rss><item><link>x</link></item></rss>`), []);
  });
});

describe("EDGAR titles", () => {
  it("does not mistake the form type's own hyphen for the separator", () => {
    // The live feed rendered these as "Material event: K - CHEETAH NET…".
    assert.equal(
      edgarCompany("8-K - CHEETAH NET SUPPLY CHAIN SERVICE INC. (0001759186) (Filer)"),
      "CHEETAH NET SUPPLY CHAIN SERVICE INC.",
    );
    assert.equal(edgarCompany("8-K/A - Freenome, Inc. (0001832038) (Filer)"), "Freenome, Inc.");
  });

  it("handles a form type containing a space", () => {
    assert.equal(edgarCompany("SC 13D - ACME CORP (0000123456) (Filer)"), "ACME CORP");
  });

  it("falls back to the raw title rather than to an empty name", () => {
    assert.equal(edgarCompany("unexpected shape"), "unexpected shape");
  });
});

describe("Fed importance", () => {
  it("ranks monetary policy above supervisory business", () => {
    assert.equal(fedImportance("FOMC statement on monetary policy"), 3);
    assert.equal(fedImportance("Beige Book released"), 3);
    // Verified against the live feed: these were the four most recent items,
    // and marking them top importance would rank them above CPI.
    assert.equal(
      fedImportance("Federal Reserve Board announces approval of the application by FS Bancorp, Inc."),
      1,
    );
    assert.equal(
      fedImportance("Federal Reserve Board issues enforcement action with former employee"),
      1,
    );
  });
});
