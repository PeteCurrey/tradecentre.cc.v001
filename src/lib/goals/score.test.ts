import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentPeriods, inPeriod, metricDef, scoreGoal } from "./score";
import type { AnalyticsTrade } from "@/lib/analytics/stats";

function trade(over: Partial<AnalyticsTrade> & { id: number }): AnalyticsTrade {
  return {
    book: "primary",
    horizon: "intraday",
    instrument: "EUR_USD",
    direction: "long",
    entryTime: new Date(over.id * 60_000),
    exitTime: new Date((over.id + 1) * 60_000),
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

describe("period matching", () => {
  it("matches months, quarters and years", () => {
    assert.equal(inPeriod("2026-08", "2026-08-13"), true);
    assert.equal(inPeriod("2026-08", "2026-09-01"), false);
    assert.equal(inPeriod("2026", "2026-12-31"), true);
    assert.equal(inPeriod("2026-Q3", "2026-08-13"), true);
    assert.equal(inPeriod("2026-Q3", "2026-10-01"), false);
    assert.equal(inPeriod("2026-Q1", "2026-03-31"), true);
  });

  it("rejects a malformed period rather than matching everything", () => {
    assert.equal(inPeriod("august", "2026-08-13"), false);
    assert.equal(inPeriod("", "2026-08-13"), false);
  });

  it("derives the current month, quarter and year", () => {
    assert.deepEqual(currentPeriods("2026-08-13"), {
      month: "2026-08",
      quarter: "2026-Q3",
      year: "2026",
    });
  });
});

describe("scoring", () => {
  const winners = [
    trade({ id: 1, realizedPl: 100, rMultiple: 2 }),
    trade({ id: 2, realizedPl: -50, rMultiple: -1 }),
    trade({ id: 3, realizedPl: 100, rMultiple: 2 }),
  ];

  it("returns null rather than zero when there is nothing to measure", () => {
    // Zero would render as "failed"; null renders as "not measured yet".
    const p = scoreGoal("total_r", 10, []);
    assert.equal(p.actual, null);
    assert.equal(p.fraction, null);
    assert.equal(p.met, false);
  });

  it("scores a floor goal by progress toward the target", () => {
    const p = scoreGoal("total_r", 6, winners);
    assert.equal(p.actual, 3);
    assert.equal(p.fraction, 0.5);
    assert.equal(p.met, false);
  });

  it("marks a floor goal met once reached", () => {
    assert.equal(scoreGoal("total_r", 3, winners).met, true);
  });

  it("scores a ceiling goal as remaining headroom, not raw progress", () => {
    // Drawdown of 1R against a 5R ceiling is 80% headroom left, and met.
    const p = scoreGoal("max_drawdown_r", 5, winners);
    assert.equal(p.actual, 1);
    assert.equal(p.met, true);
    assert.ok(p.fraction !== null && Math.abs(p.fraction - 0.8) < 1e-9);
  });

  it("fails a ceiling goal once exceeded, and never reports negative progress", () => {
    const p = scoreGoal("max_drawdown_r", 0.5, winners);
    assert.equal(p.met, false);
    assert.equal(p.fraction, 0);
  });

  it("never reports more than complete", () => {
    const p = scoreGoal("total_r", 1, winners);
    assert.equal(p.fraction, 1);
  });

  it("averages adherence from reviews rather than from trades", () => {
    const p = scoreGoal("adherence_pct", 80, winners, [70, 90]);
    assert.equal(p.actual, 80);
    assert.equal(p.met, true);
  });

  it("reports independent exits so a clustered sample is visible", () => {
    const at = new Date("2026-08-13T10:00:00Z");
    const basket = [1, 2, 3].map((id) =>
      trade({ id, exitTime: at, realizedPl: 10, rMultiple: 1 }),
    );
    const p = scoreGoal("total_r", 3, basket);
    assert.equal(p.sample, 3);
    assert.equal(p.independentExits, 1);
  });
});

describe("metric definitions", () => {
  it("marks drawdown and trade count as lower-is-better", () => {
    assert.equal(metricDef("max_drawdown_r").lowerIsBetter, true);
    assert.equal(metricDef("trade_count").lowerIsBetter, true);
    assert.equal(metricDef("total_r").lowerIsBetter, false);
  });
});
