import {
  equityCurve,
  maxDrawdownR,
  summarise,
  type AnalyticsTrade,
} from "@/lib/analytics/stats";

/**
 * Scoring goals against the ledger.
 *
 * Pure, so every progress figure is testable without a database. The design
 * rule: a goal names a metric the app already computes, and progress is
 * measured rather than reported. A goal you tick off yourself is a note.
 */

export const GOAL_METRICS = [
  {
    id: "total_r",
    label: "Total R",
    hint: "Cumulative R over the period.",
    lowerIsBetter: false,
    format: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`,
  },
  {
    id: "expectancy_r",
    label: "Expectancy",
    hint: "Mean R per trade — the number that says whether there is an edge.",
    lowerIsBetter: false,
    format: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`,
  },
  {
    id: "win_rate",
    label: "Win rate",
    hint: "Percentage of closed trades in profit. Says little on its own.",
    lowerIsBetter: false,
    format: (v: number) => `${v.toFixed(1)}%`,
  },
  {
    id: "max_drawdown_r",
    label: "Max drawdown",
    hint: "A ceiling: met by staying above it. Reported as a positive depth.",
    lowerIsBetter: true,
    format: (v: number) => `${v.toFixed(1)}R`,
  },
  {
    id: "profit_factor",
    label: "Profit factor",
    hint: "Gross wins over gross losses.",
    lowerIsBetter: false,
    format: (v: number) => v.toFixed(2),
  },
  {
    id: "trade_count",
    label: "Trade count",
    hint: "Usually set as a ceiling, when overtrading is the leak.",
    lowerIsBetter: true,
    format: (v: number) => String(Math.round(v)),
  },
  {
    id: "adherence_pct",
    label: "Rule adherence",
    hint: "Mean adherence across the period's daily reviews.",
    lowerIsBetter: false,
    format: (v: number) => `${v.toFixed(0)}%`,
  },
] as const;

export type GoalMetric = (typeof GOAL_METRICS)[number]["id"];

export function metricDef(id: GoalMetric) {
  return GOAL_METRICS.find((m) => m.id === id)!;
}

/** Does an exit-dated trade fall inside "2026-08", "2026-Q3" or "2026"? */
export function inPeriod(period: string, dayKeyOfExit: string): boolean {
  if (/^\d{4}$/.test(period)) return dayKeyOfExit.startsWith(period);
  if (/^\d{4}-\d{2}$/.test(period)) return dayKeyOfExit.startsWith(period);

  const q = /^(\d{4})-?Q([1-4])$/i.exec(period);
  if (q) {
    const year = q[1];
    const quarter = Number(q[2]);
    if (!dayKeyOfExit.startsWith(year)) return false;
    const month = Number(dayKeyOfExit.slice(5, 7));
    return Math.ceil(month / 3) === quarter;
  }
  return false;
}

export type GoalProgress = {
  /** Null when the period has no trades — not zero, which would read as failure. */
  actual: number | null;
  /** 0–1, clamped. Null when there is nothing to measure. */
  fraction: number | null;
  met: boolean;
  /** Trades the figure is computed from, so a thin sample is visible. */
  sample: number;
  independentExits: number;
};

export function scoreGoal(
  metric: GoalMetric,
  target: number,
  trades: AnalyticsTrade[],
  adherence: number[] = [],
): GoalProgress {
  const def = metricDef(metric);
  const s = summarise(trades);

  let actual: number | null;
  switch (metric) {
    case "total_r":
      actual = trades.length ? s.totalR : null;
      break;
    case "expectancy_r":
      actual = s.expectancyR;
      break;
    case "win_rate":
      actual = trades.length ? s.winRate : null;
      break;
    case "max_drawdown_r":
      // Reported as a positive depth so "keep it under 5R" reads naturally.
      actual = trades.length ? Math.abs(maxDrawdownR(equityCurve(trades))) : null;
      break;
    case "profit_factor":
      actual = s.profitFactor;
      break;
    case "trade_count":
      actual = trades.length;
      break;
    case "adherence_pct":
      actual = adherence.length
        ? adherence.reduce((a, b) => a + b, 0) / adherence.length
        : null;
      break;
  }

  if (actual === null) {
    return { actual: null, fraction: null, met: false, sample: trades.length, independentExits: s.independentExits };
  }

  const met = def.lowerIsBetter ? actual <= target : actual >= target;

  // Progress toward a ceiling is "how much headroom is left", which is the
  // inverse of progress toward a floor. Both clamp to [0,1] so a bar cannot
  // overflow its track and imply more than 100%.
  const raw = def.lowerIsBetter
    ? target === 0
      ? actual === 0
        ? 1
        : 0
      : 1 - actual / target
    : target === 0
      ? actual >= 0
        ? 1
        : 0
      : actual / target;

  return {
    actual,
    fraction: Math.max(0, Math.min(1, raw)),
    met,
    sample: trades.length,
    independentExits: s.independentExits,
  };
}

/** Current period keys, for the "add a goal" defaults. */
export function currentPeriods(dayKeyToday: string): {
  month: string;
  quarter: string;
  year: string;
} {
  const year = dayKeyToday.slice(0, 4);
  const month = dayKeyToday.slice(0, 7);
  const q = Math.ceil(Number(dayKeyToday.slice(5, 7)) / 3);
  return { month, quarter: `${year}-Q${q}`, year };
}
