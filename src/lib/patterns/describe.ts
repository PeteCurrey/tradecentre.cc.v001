import type { Condition, SeriesRef, StopRule, TargetRule } from "./dsl";

/**
 * Renders the rule DSL as plain English.
 *
 * The point is interrogability. A pattern stored as JSON is precise but opaque,
 * and a rule you cannot read is a rule you end up trusting blindly — which is
 * exactly the failure this whole system exists to avoid. Every trigger shown in
 * the UI passes through here, so what you read is generated from the same
 * object the scanner and backtester evaluate, not a hand-written description
 * that can drift away from it.
 */

const SESSION_NAMES: Record<string, string> = {
  sydney: "Sydney",
  tokyo: "Asian",
  london: "London",
  newyork: "New York",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function describeSeries(ref: SeriesRef): string {
  switch (ref.s) {
    case "const":
      return String(ref.value);
    case "open":
      return "the open";
    case "high":
      return "the high";
    case "low":
      return "the low";
    case "close":
      return "the close";
    case "hl2":
      return "the midpoint";
    case "hlc3":
      return "the typical price";
    case "tickVolume":
      return "tick count";

    case "sma":
      return `SMA(${ref.period})`;
    case "ema":
      return `EMA(${ref.period})`;
    case "rsi":
      return `RSI(${ref.period})`;
    case "atr":
      return `ATR(${ref.period})`;
    case "cci":
      return `CCI(${ref.period})`;

    case "macd":
      return ref.line === "line" ? "MACD" : `MACD ${ref.line}`;
    case "bb":
      return `the ${ref.band} Bollinger Band`;
    case "keltner":
      return `the ${ref.band} Keltner Channel`;
    case "adx":
      return ref.line === "adx" ? `ADX(${ref.period ?? 14})` : ref.line.replace("DI", "-DI");
    case "stoch":
      return `Stochastic %${ref.line.toUpperCase()}`;

    case "swingHigh":
      return "the last confirmed swing high";
    case "swingLow":
      return "the last confirmed swing low";
    case "priorHigh":
      return `the ${ref.period}-bar high`;
    case "priorLow":
      return `the ${ref.period}-bar low`;

    case "dayHigh":
      return ref.which === "previous" ? "the previous day's high" : "today's high so far";
    case "dayLow":
      return ref.which === "previous" ? "the previous day's low" : "today's low so far";

    case "sessionHigh": {
      const name = SESSION_NAMES[ref.session] ?? ref.session;
      return ref.which === "completed"
        ? `the completed ${name} session high`
        : `the ${name} session high so far`;
    }
    case "sessionLow": {
      const name = SESSION_NAMES[ref.session] ?? ref.session;
      return ref.which === "completed"
        ? `the completed ${name} session low`
        : `the ${name} session low so far`;
    }

    case "vwap":
      return ref.anchor === "day" ? "the daily VWAP" : "the session VWAP";

    case "abs":
      return `the absolute value of ${describeSeries(ref.a)}`;

    case "offset":
      return `${describeSeries(ref.a)} ${ref.bars} ${ref.bars === 1 ? "bar" : "bars"} ago`;

    case "mul": {
      // Render "0.5 × ATR(14)" rather than "ATR(14) multiplied by 0.5".
      if (ref.a.s === "const") return `${ref.a.value} × ${describeSeries(ref.b)}`;
      if (ref.b.s === "const") return `${ref.b.value} × ${describeSeries(ref.a)}`;
      return `${describeSeries(ref.a)} × ${describeSeries(ref.b)}`;
    }
    case "add":
      return `${describeSeries(ref.a)} plus ${describeSeries(ref.b)}`;
    case "sub":
      return `${describeSeries(ref.a)} minus ${describeSeries(ref.b)}`;
    case "div":
      return `${describeSeries(ref.a)} divided by ${describeSeries(ref.b)}`;
    case "max": {
      // The inclusive-Donchian idiom reads badly spelled out literally, so name
      // it for what it is.
      if (ref.a.s === "priorHigh" && ref.b.s === "high") {
        return `the highest high of the last ${ref.a.period + 1} bars`;
      }
      return `the greater of ${describeSeries(ref.a)} and ${describeSeries(ref.b)}`;
    }
    case "min": {
      if (ref.a.s === "priorLow" && ref.b.s === "low") {
        return `the lowest low of the last ${ref.a.period + 1} bars`;
      }
      return `the lesser of ${describeSeries(ref.a)} and ${describeSeries(ref.b)}`;
    }
  }
}

const OPS: Record<string, string> = {
  ">": "is above",
  ">=": "is at or above",
  "<": "is below",
  "<=": "is at or below",
};

export function describeCondition(cond: Condition): string {
  switch (cond.c) {
    case "cmp":
      return `${describeSeries(cond.left)} ${OPS[cond.op]} ${describeSeries(cond.right)}`;

    case "cross":
      return `${describeSeries(cond.left)} crosses ${cond.dir} ${describeSeries(cond.right)}`;

    case "session": {
      const names = cond.sessions.map((s) => SESSION_NAMES[s] ?? s);
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
      return `during the ${list} session`;
    }

    case "timeOfDay":
      return `between ${String(cond.afterHour).padStart(2, "0")}:00 and ${String(
        cond.beforeHour,
      ).padStart(2, "0")}:00 London`;

    case "dayOfWeek": {
      const names = cond.days.map((d) => DAY_NAMES[d] ?? String(d));
      return `on ${names.join(" or ")}`;
    }

    case "within":
      return `${describeSeries(cond.a)} is within ${describeSeries(
        cond.tolerance,
      )} of ${describeSeries(cond.b)}`;

    case "sweepReclaim":
      return cond.dir === "above"
        ? `price traded above ${describeSeries(cond.level)} in the last ${cond.withinBars} bars, then closed back below it`
        : `price traded below ${describeSeries(cond.level)} in the last ${cond.withinBars} bars, then closed back above it`;

    case "divergence":
      return `${cond.kind} divergence between price and ${describeSeries(cond.indicator)}`;

    case "consecutive":
      return `${describeCondition(cond.of)} on each of the last ${cond.bars} bars`;

    case "withinBars":
      return `${describeCondition(cond.of)} at some point in the last ${cond.bars} bars`;

    case "not":
      return `NOT (${describeCondition(cond.of)})`;

    case "all":
    case "any":
      // Nested groups read badly inline; the UI flattens the top level instead.
      return cond.of
        .map(describeCondition)
        .join(cond.c === "all" ? " AND " : " OR ");
  }
}

/**
 * Top-level trigger flattened to a checklist. Reads far better than one long
 * sentence, and mirrors how the conditions are actually evaluated.
 */
export function describeTrigger(trigger: Condition): string[] {
  if (trigger.c === "all") return trigger.of.map(describeCondition);
  return [describeCondition(trigger)];
}

export function describeStop(rule: StopRule): string {
  if (rule.kind === "atr") return `${rule.multiple} × ATR(14) from entry`;
  const buffer = rule.bufferAtr ? `, with a ${rule.bufferAtr} × ATR buffer` : "";
  return `at ${describeSeries(rule.at)}${buffer}`;
}

export function describeTarget(rule: TargetRule): string {
  if (rule.kind === "rMultiple") return `take profit at ${rule.r}R`;
  if (rule.kind === "series") return `take profit at ${describeSeries(rule.at)}`;
  return `exit after ${rule.bars} bars regardless`;
}
