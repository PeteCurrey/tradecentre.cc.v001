import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CANDLES_PER_REQUEST,
  MAX_PAGES,
  collectPages,
  expectedBarsPerYear,
  type PageFetcher,
  type RawCandle,
} from "./pagination";

const H1 = 3_600_000;
const START = Date.UTC(2021, 0, 4, 0, 0, 0);

function candle(t: number, complete = true): RawCandle {
  return {
    time: new Date(t).toISOString(),
    complete,
    volume: 10,
    mid: { o: "1", h: "2", l: "0.5", c: "1.5" },
  };
}

/**
 * A fetcher over a fixed history, behaving like OANDA: returns up to `count`
 * candles at or after `from`.
 */
function fakeOanda(history: number[], log?: string[]): PageFetcher {
  return async ({ from, count }) => {
    log?.push(from);
    const fromMs = Date.parse(from);
    return history.filter((t) => t >= fromMs).slice(0, count).map((t) => candle(t));
  };
}

function series(n: number, step = H1, start = START): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("pagination — the happy path", () => {
  it("walks multiple pages and returns every candle exactly once", async () => {
    const history = series(1200);
    const r = await collectPages(fakeOanda(history), {
      instrument: "EUR_USD",
      granularity: "H1",
      from: new Date(START),
      to: new Date(START + 1200 * H1),
      countPerPage: 500,
    });

    assert.equal(r.candles.length, 1200);
    // 3 full pages, plus one empty page to learn history ended. A short page is
    // deliberately not treated as the end — see the note in collectPages.
    assert.equal(r.pages, 4, "1200 candles at 500/page, plus the terminating request");
    const times = r.candles.map((c) => Date.parse(c.time));
    assert.deepEqual(times, history, "order preserved, nothing duplicated or dropped");
    assert.equal(new Set(times).size, 1200);
  });

  it("advances the cursor to one ms past the newest candle", async () => {
    const log: string[] = [];
    const history = series(1000);
    await collectPages(fakeOanda(history, log), {
      instrument: "EUR_USD",
      granularity: "H1",
      from: new Date(START),
      to: new Date(START + 1000 * H1),
      countPerPage: 400,
    });

    assert.equal(Date.parse(log[0]), START);
    assert.equal(Date.parse(log[1]), START + 399 * H1 + 1, "one ms past page 1's newest");
    assert.equal(Date.parse(log[2]), START + 799 * H1 + 1);
  });

  it("stops cleanly when history runs out mid-page", async () => {
    const history = series(150);
    const r = await collectPages(fakeOanda(history), {
      instrument: "EUR_USD",
      granularity: "H1",
      from: new Date(START),
      to: new Date(START + 10_000 * H1), // asking well past the end
      countPerPage: 100,
    });
    assert.equal(r.candles.length, 150);
    assert.equal(r.truncated, false);
  });
});

describe("pagination — termination", () => {
  it("stops on an empty first page", async () => {
    let calls = 0;
    const r = await collectPages(
      async () => {
        calls++;
        return [];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + 1000 * H1),
      },
    );
    assert.equal(calls, 1);
    assert.equal(r.candles.length, 0);
  });

  it("does NOT loop forever when the cursor cannot advance", async () => {
    // The failure mode that matters: a server that keeps returning the same
    // candle. Without the newest<=cursor guard this spins until MAX_PAGES.
    let calls = 0;
    const r = await collectPages(
      async () => {
        calls++;
        return [candle(START)]; // always the same candle
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + 100_000 * H1),
      },
    );
    assert.equal(calls, 1, "one wasted request, then stop");
    assert.equal(r.candles.length, 1);
    assert.ok(r.pages < MAX_PAGES);
  });

  it("stops when a page contains only candles older than the cursor", async () => {
    let calls = 0;
    const r = await collectPages(
      async ({ from }) => {
        calls++;
        // Always answers with something before the requested cursor.
        return [candle(Date.parse(from) - 5 * H1)];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + 100_000 * H1),
      },
    );
    assert.equal(calls, 1);
    assert.ok(r.pages < MAX_PAGES);
  });

  it("gives up at MAX_PAGES and flags the result truncated", async () => {
    // A server that advances by exactly one candle per page: legitimate
    // progress, but far too slow to ever finish. Must bail and SAY it bailed.
    const r = await collectPages(
      // One candle per page, each genuinely newer — real progress, far too slow.
      async ({ from }) => [candle(Date.parse(from) + H1)],
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + 100_000 * H1),
      },
    );
    assert.equal(r.pages, MAX_PAGES);
    assert.equal(r.truncated, true, "a truncated walk must not look like a complete one");
    assert.equal(r.reachedEnd, false);
  });
});

describe("pagination — boundaries", () => {
  it("never returns a candle past `to`", async () => {
    const history = series(1000);
    const cutoff = START + 300 * H1;
    const r = await collectPages(fakeOanda(history), {
      instrument: "EUR_USD",
      granularity: "H1",
      from: new Date(START),
      to: new Date(cutoff),
      countPerPage: 250,
    });

    assert.ok(r.candles.length > 0);
    for (const c of r.candles) {
      assert.ok(Date.parse(c.time) <= cutoff, `${c.time} is past the requested end`);
    }
    assert.equal(r.reachedEnd, true);
  });

  it("returns nothing when `to` precedes `from`", async () => {
    let calls = 0;
    const r = await collectPages(
      async () => {
        calls++;
        return [candle(START)];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START + 10 * H1),
        to: new Date(START),
      },
    );
    assert.equal(calls, 0, "must not call the API at all");
    assert.equal(r.candles.length, 0);
    assert.equal(r.reachedEnd, true);
  });

  it("clamps the page size to OANDA's ceiling", async () => {
    let asked = 0;
    await collectPages(
      async ({ count }) => {
        asked = count;
        return [];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + H1),
        countPerPage: 99_999,
      },
    );
    assert.equal(asked, MAX_CANDLES_PER_REQUEST);
  });

  it("defaults to the maximum page size", async () => {
    let asked = 0;
    await collectPages(
      async ({ count }) => {
        asked = count;
        return [];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + H1),
      },
    );
    assert.equal(asked, MAX_CANDLES_PER_REQUEST);
  });
});

describe("pagination — malformed data", () => {
  it("skips an unparseable timestamp without stopping the walk", async () => {
    const good = series(3);
    let page = 0;
    const r = await collectPages(
      async () => {
        page++;
        if (page === 1) {
          return [
            { time: "not-a-date", complete: true, volume: 1 },
            candle(good[0]),
            candle(good[1]),
          ];
        }
        if (page === 2) return [candle(good[2])];
        return [];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + 100 * H1),
      },
    );
    assert.equal(r.candles.length, 3, "the two good candles plus the next page's one");
    for (const c of r.candles) assert.ok(!Number.isNaN(Date.parse(c.time)));
  });

  it("passes incomplete candles through — the storage layer drops them", async () => {
    // Separation of concerns: pagination reports what the API said. Deciding
    // that a forming candle must not be persisted belongs to backfill.ts.
    const r = await collectPages(
      async ({ from }) => {
        const t = Date.parse(from);
        return t === START ? [candle(START, true), candle(START + H1, false)] : [];
      },
      {
        instrument: "EUR_USD",
        granularity: "H1",
        from: new Date(START),
        to: new Date(START + 10 * H1),
      },
    );
    assert.equal(r.candles.length, 2);
    assert.equal(r.candles.filter((c) => !c.complete).length, 1);
  });
});

describe("resume start", () => {
  const from = new Date(START);

  it("starts at `from` when nothing is stored", () => {
    const r = resolveResumeStart({ from, oldest: null, newest: null });
    assert.equal(r.start.getTime(), START);
    assert.equal(r.resumed, false);
  });

  it("resumes past the newest candle when storage reaches back to `from`", () => {
    const newest = new Date(START + 1000 * H1);
    const r = resolveResumeStart({ from, oldest: new Date(START - H1), newest });
    assert.equal(r.start.getTime(), newest.getTime() + 1);
    assert.equal(r.resumed, true);
  });

  it("RESTARTS from `from` when stored history is a sparse recent window", () => {
    // The bug this function exists to prevent. A trade-chart cache holding a
    // week of recent candles must not convince the backfill that the preceding
    // seven years are already stored.
    const r = resolveResumeStart({
      from,
      oldest: new Date(START + 60_000 * H1), // years after `from`
      newest: new Date(START + 60_100 * H1),
    });
    assert.equal(r.start.getTime(), START, "must not skip the unstored years");
    assert.equal(r.resumed, false);
  });

  it("starts at `from` when all stored history predates it", () => {
    const r = resolveResumeStart({
      from,
      oldest: new Date(START - 1000 * H1),
      newest: new Date(START - 10 * H1),
    });
    assert.equal(r.start.getTime(), START);
    assert.equal(r.resumed, false);
  });

  it("treats storage starting exactly at `from` as resumable", () => {
    const newest = new Date(START + 500 * H1);
    const r = resolveResumeStart({ from, oldest: from, newest });
    assert.equal(r.resumed, true);
    assert.equal(r.start.getTime(), newest.getTime() + 1);
  });
});

describe("expectedBarsPerYear", () => {
  it("assumes a five-day week, not a seven-day one", () => {
    const h1 = expectedBarsPerYear("H1");
    assert.ok(h1 > 6000 && h1 < 6400, `expected ~6260 H1 bars/year, got ${h1}`);
    assert.ok(h1 < 8760, "must not assume the market never closes");
  });

  it("scales with granularity", () => {
    assert.ok(expectedBarsPerYear("M15") > expectedBarsPerYear("H1"));
    assert.ok(expectedBarsPerYear("H1") > expectedBarsPerYear("D"));
  });

  it("gives five years of H1 as roughly 30k bars", () => {
    const fiveYears = expectedBarsPerYear("H1") * 5;
    assert.ok(fiveYears > 30_000 && fiveYears < 32_000, `got ${fiveYears}`);
  });
});
