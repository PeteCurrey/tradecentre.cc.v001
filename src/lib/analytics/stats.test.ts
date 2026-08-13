import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convictionEdge,
  drawdowns,
  equityCurve,
  groupBy,
  independentExits,
  isClustered,
  maxDrawdownR,
  rHistogram,
  streaks,
  summarise,
  type AnalyticsTrade,
} from "./stats";

const MIN = 60_000;

function trade(over: Partial<AnalyticsTrade> & { id: number }): AnalyticsTrade {
  return {
    book: "primary",
    horizon: "intraday",
    instrument: "EUR_USD",
    direction: "long",
    entryTime: new Date(over.id * MIN),
    exitTime: new Date((over.id + 1) * MIN),
    realizedPl: 0,
    rMultiple: null,
    spreadCost: 0,
    financing: 0,
    patternId: null,
    conviction: null,
    processGrade: null,
    mistakes: [],
    ...over,
  };
}

describe("summarise", () => {
  it("excludes trades without an R from every R statistic", () => {
    const s = summarise([
      trade({ id: 1, realizedPl: 100, rMultiple: 2 }),
      trade({ id: 2, realizedPl: -50, rMultiple: -1 }),
      // No stop was attached, so this trade has no R denominator at all.
      trade({ id: 3, realizedPl: 900, rMultiple: null }),
    ]);

    assert.equal(s.trades, 3);
    assert.equal(s.totalR, 1);
    // Mean over the TWO trades that have an R, not over three.
    assert.equal(s.expectancyR, 0.5);
    // Cash still counts every trade — it is real money either way.
    assert.equal(s.netPl, 950);
  });

  it("treats a zero-P&L trade as neither a win nor a loss", () => {
    const s = summarise([
      trade({ id: 1, realizedPl: 10, rMultiple: 1 }),
      trade({ id: 2, realizedPl: 0, rMultiple: 0 }),
    ]);
    assert.equal(s.wins, 1);
    assert.equal(s.losses, 0);
    assert.equal(s.scratches, 1);
    assert.equal(s.winRate, 50);
  });

  it("reports no profit factor when nothing was lost, rather than infinity", () => {
    const s = summarise([trade({ id: 1, realizedPl: 10, rMultiple: 1 })]);
    assert.equal(s.profitFactor, null);
  });

  it("returns null expectancy for an empty set instead of zero", () => {
    // Zero would read as "no edge measured"; null reads as "not measured".
    assert.equal(summarise([]).expectancyR, null);
  });
});

describe("independent exits", () => {
  it("counts a basket closed in one minute as a single outcome", () => {
    const at = new Date("2026-03-02T10:00:30Z");
    const basket = [1, 2, 3, 4, 5].map((id) =>
      trade({ id, exitTime: at, realizedPl: 5, rMultiple: 0.2 }),
    );
    assert.equal(independentExits(basket), 1);
    assert.equal(isClustered(basket), true);
  });

  it("does not flag genuinely separate exits", () => {
    const spread = [1, 2, 3, 4].map((id) =>
      trade({ id, exitTime: new Date(id * 10 * MIN) }),
    );
    assert.equal(independentExits(spread), 4);
    assert.equal(isClustered(spread), false);
  });
});

describe("equity curve", () => {
  it("orders by exit time, not entry time", () => {
    // A swing opened first but closed last damages the account last.
    const swing = trade({
      id: 1,
      entryTime: new Date("2026-01-01T00:00:00Z"),
      exitTime: new Date("2026-06-01T00:00:00Z"),
      realizedPl: -100,
      rMultiple: -1,
    });
    const scalp = trade({
      id: 2,
      entryTime: new Date("2026-05-01T00:00:00Z"),
      exitTime: new Date("2026-05-01T01:00:00Z"),
      realizedPl: 100,
      rMultiple: 1,
    });

    const curve = equityCurve([swing, scalp]);
    assert.equal(curve[0].r, 1);
    assert.equal(curve[1].r, 0);
    assert.equal(maxDrawdownR(curve), -1);
  });

  it("never reports a positive drawdown", () => {
    const curve = equityCurve([
      trade({ id: 1, realizedPl: 10, rMultiple: 1 }),
      trade({ id: 2, realizedPl: 10, rMultiple: 2 }),
    ]);
    assert.ok(curve.every((p) => p.drawdownR <= 0));
    assert.equal(maxDrawdownR(curve), 0);
  });

  it("treats a trade with no R as flat on the R curve but not the cash curve", () => {
    const curve = equityCurve([trade({ id: 1, realizedPl: 500, rMultiple: null })]);
    assert.equal(curve[0].r, 0);
    assert.equal(curve[0].pl, 500);
  });
});

describe("drawdowns", () => {
  const curve = equityCurve([
    trade({ id: 1, realizedPl: 1, rMultiple: 1 }),
    trade({ id: 2, realizedPl: -1, rMultiple: -1 }),
    trade({ id: 3, realizedPl: -1, rMultiple: -1 }),
    trade({ id: 4, realizedPl: 3, rMultiple: 3 }),
  ]);

  it("measures depth from the running peak", () => {
    const [worst] = drawdowns(curve);
    assert.equal(worst.depthR, 2);
    assert.equal(worst.tradesUnderwater, 2);
  });

  it("records a recovery time once a new high is made", () => {
    const [worst] = drawdowns(curve);
    assert.notEqual(worst.endedAt, null);
    assert.notEqual(worst.recoveredInDays, null);
  });

  it("leaves an unrecovered drawdown open rather than closing it at the last trade", () => {
    const stillDown = equityCurve([
      trade({ id: 1, realizedPl: 1, rMultiple: 1 }),
      trade({ id: 2, realizedPl: -2, rMultiple: -2 }),
    ]);
    const [spell] = drawdowns(stillDown);
    assert.equal(spell.endedAt, null);
    assert.equal(spell.recoveredInDays, null);
  });
});

describe("streaks", () => {
  it("counts consecutive wins and losses", () => {
    const s = streaks([
      trade({ id: 1, realizedPl: 1 }),
      trade({ id: 2, realizedPl: 1 }),
      trade({ id: 3, realizedPl: -1 }),
      trade({ id: 4, realizedPl: -1 }),
      trade({ id: 5, realizedPl: -1 }),
    ]);
    assert.equal(s.longestWin, 2);
    assert.equal(s.longestLoss, 3);
    assert.equal(s.current, -3);
  });

  it("does not let a scratch break a streak", () => {
    const s = streaks([
      trade({ id: 1, realizedPl: 1 }),
      trade({ id: 2, realizedPl: 0 }),
      trade({ id: 3, realizedPl: 1 }),
    ]);
    assert.equal(s.longestWin, 2);
  });
});

describe("grouping and histogram", () => {
  it("drops trades whose key is null rather than bucketing them as 'none'", () => {
    const groups = groupBy(
      [trade({ id: 1, patternId: 7 }), trade({ id: 2, patternId: null })],
      (t) => t.patternId,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, 7);
  });

  it("puts every trade with an R in exactly one bucket", () => {
    const set = [-4, -1, -0.2, 0.4, 1, 9].map((r, i) =>
      trade({ id: i, rMultiple: r }),
    );
    const total = rHistogram(set).reduce((s, b) => s + b.count, 0);
    assert.equal(total, set.length);
  });
});

describe("conviction", () => {
  it("reports each grade separately so the multiplier table can be checked", () => {
    const rows = convictionEdge([
      trade({ id: 1, conviction: "A+", realizedPl: 3, rMultiple: 3 }),
      trade({ id: 2, conviction: "B", realizedPl: -1, rMultiple: -1 }),
      trade({ id: 3, conviction: "B", realizedPl: -1, rMultiple: -1 }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.conviction, r.n, r.expectancyR]),
      [
        ["A+", 1, 3],
        ["B", 2, -1],
      ],
    );
  });
});
