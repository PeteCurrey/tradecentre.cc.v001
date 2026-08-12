import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { C, S } from "./dsl";
import { SEED_PATTERNS } from "./seed";
import {
  describeCondition,
  describeSeries,
  describeStop,
  describeTarget,
  describeTrigger,
} from "./describe";

describe("series descriptions", () => {
  it("names indicators with their periods", () => {
    assert.equal(describeSeries(S.ema(20)), "EMA(20)");
    assert.equal(describeSeries(S.rsi(14)), "RSI(14)");
    assert.equal(describeSeries(S.atr(14)), "ATR(14)");
  });

  it("puts the constant first in a multiplication", () => {
    // "0.5 × ATR(14)" reads as a trader would write it.
    assert.equal(describeSeries(S.mul(S.atr(14), S.n(0.5))), "0.5 × ATR(14)");
    assert.equal(describeSeries(S.mul(S.n(2), S.atr(14))), "2 × ATR(14)");
  });

  it("distinguishes completed session ranges from forming ones", () => {
    assert.equal(
      describeSeries(S.sessionHigh("tokyo", "completed")),
      "the completed Asian session high",
    );
    assert.equal(
      describeSeries(S.sessionHigh("tokyo", "current")),
      "the Asian session high so far",
    );
  });

  it("makes swing points explicitly confirmed", () => {
    // The lag is real and the wording should not hide it.
    assert.equal(describeSeries(S.swingLow(3)), "the last confirmed swing low");
  });

  it("describes offsets in bars", () => {
    assert.equal(describeSeries(S.ago(S.close, 1)), "the close 1 bar ago");
    assert.equal(describeSeries(S.ago(S.atr(14), 20)), "ATR(14) 20 bars ago");
  });
});

describe("condition descriptions", () => {
  it("reads comparisons naturally", () => {
    assert.equal(describeCondition(C.gt(S.close, S.ema(20))), "the close is above EMA(20)");
  });

  it("describes sweep and reclaim in both directions", () => {
    assert.match(
      describeCondition(C.sweepReclaim(S.dayHigh("previous"), "above", 4)),
      /traded above the previous day's high in the last 4 bars, then closed back below/,
    );
    assert.match(
      describeCondition(C.sweepReclaim(S.priorLow(60), "below", 3)),
      /traded below the 60-bar low in the last 3 bars, then closed back above/,
    );
  });

  it("names sessions in trader terms", () => {
    assert.equal(
      describeCondition(C.session("london", "newyork")),
      "during the London or New York session",
    );
  });

  it("formats time windows as London clock times", () => {
    assert.equal(describeCondition(C.timeOfDay(8, 13)), "between 08:00 and 13:00 London");
  });

  it("describes divergence", () => {
    assert.equal(
      describeCondition(C.divergence("bullish", S.rsi(14))),
      "bullish divergence between price and RSI(14)",
    );
  });
});

describe("trigger flattening", () => {
  it("splits a top-level AND into a checklist", () => {
    const lines = describeTrigger(
      C.all(C.session("london"), C.gt(S.close, S.ema(20)), C.lt(S.rsi(14), S.n(30))),
    );
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "during the London session");
  });

  it("returns a single line for a non-AND trigger", () => {
    assert.deepEqual(describeTrigger(C.gt(S.close, S.n(1))), ["the close is above 1"]);
  });
});

describe("stop and target descriptions", () => {
  it("describes ATR stops", () => {
    assert.equal(describeStop({ kind: "atr", multiple: 2 }), "2 × ATR(14) from entry");
  });

  it("mentions the buffer on a series stop", () => {
    assert.equal(
      describeStop({ kind: "series", at: S.swingLow(3), bufferAtr: 0.25 }),
      "at the last confirmed swing low, with a 0.25 × ATR buffer",
    );
  });

  it("describes each target kind", () => {
    assert.equal(describeTarget({ kind: "rMultiple", r: 2 }), "take profit at 2R");
    assert.equal(describeTarget({ kind: "timeStop", bars: 24 }), "exit after 24 bars regardless");
  });
});

describe("every seed pattern renders", () => {
  /**
   * Guards against a DSL node being added without a matching description,
   * which would surface in the UI as "undefined" inside a trading rule.
   */
  for (const p of SEED_PATTERNS) {
    it(`${p.slug} describes cleanly`, () => {
      const lines = describeTrigger(p.trigger);
      assert.ok(lines.length > 0);
      for (const line of lines) {
        assert.ok(line.length > 0, "empty description line");
        assert.ok(!/undefined|\[object|NaN/.test(line), `unrendered node: ${line}`);
      }
      const stop = describeStop(p.stop);
      assert.ok(!/undefined|\[object/.test(stop), `unrendered stop: ${stop}`);
      for (const t of p.targets) {
        const desc = describeTarget(t);
        assert.ok(!/undefined|\[object/.test(desc), `unrendered target: ${desc}`);
      }
    });
  }
});
