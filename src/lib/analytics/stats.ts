/**
 * Analytics primitives.
 *
 * Pure functions over a minimal trade shape, deliberately free of Drizzle,
 * React and dates-as-strings, so every number on an analytics screen can be
 * tested without a database.
 *
 * Two rules run through all of it:
 *
 *   1. R IS THE UNIT. Cash is not comparable across a 100-unit EURUSD trade and
 *      a 1-unit gold trade; R is. Cash totals are reported, but every ranking
 *      and every average is in R.
 *   2. NOTHING IS INVENTED. A trade without an R is excluded from R statistics
 *      rather than counted as zero — counting it drags every average toward
 *      nothing and silently understates both edge and damage.
 */

export type AnalyticsTrade = {
  id: number;
  book: string;
  horizon: string | null;
  instrument: string;
  direction: "long" | "short";
  entryTime: Date;
  exitTime: Date | null;
  realizedPl: number;
  rMultiple: number | null;
  spreadCost: number;
  financing: number;
  patternId: number | null;
  conviction: string | null;
  processGrade: string | null;
  mistakes: string[];
};

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

export type Summary = {
  trades: number;
  /** Exits sharing a minute are ONE decision — see independentExits below. */
  independentExits: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  netPl: number;
  totalR: number;
  /** Mean R per trade. The single number that says whether this has an edge. */
  expectancyR: number | null;
  profitFactor: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  largestWinR: number | null;
  largestLossR: number | null;
  spreadPaid: number;
  financing: number;
};

export function summarise(trades: AnalyticsTrade[]): Summary {
  const wins = trades.filter((t) => t.realizedPl > 0);
  const losses = trades.filter((t) => t.realizedPl < 0);
  const withR = trades.filter((t) => t.rMultiple !== null);
  const rs = withR.map((t) => t.rMultiple!);

  const grossWin = wins.reduce((s, t) => s + t.realizedPl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPl, 0));

  const winRs = rs.filter((r) => r > 0);
  const lossRs = rs.filter((r) => r < 0);

  return {
    trades: trades.length,
    independentExits: independentExits(trades),
    wins: wins.length,
    losses: losses.length,
    scratches: trades.length - wins.length - losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    netPl: trades.reduce((s, t) => s + t.realizedPl, 0),
    totalR: rs.reduce((s, r) => s + r, 0),
    expectancyR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWinR: winRs.length ? winRs.reduce((s, r) => s + r, 0) / winRs.length : null,
    avgLossR: lossRs.length ? lossRs.reduce((s, r) => s + r, 0) / lossRs.length : null,
    largestWinR: winRs.length ? Math.max(...winRs) : null,
    largestLossR: lossRs.length ? Math.min(...lossRs) : null,
    spreadPaid: trades.reduce((s, t) => s + t.spreadCost, 0),
    financing: trades.reduce((s, t) => s + t.financing, 0),
  };
}

/**
 * Exits sharing a minute count once.
 *
 * Peter's ledger contains baskets closed together: fifty positions shut in the
 * same minute is ONE outcome, not fifty independent samples. Every confidence
 * statement on an analytics screen is really about this number, so it travels
 * alongside the trade count everywhere rather than being buried.
 */
export function independentExits(trades: AnalyticsTrade[]): number {
  const minutes = new Set<number>();
  for (const t of trades) {
    if (t.exitTime) minutes.add(Math.floor(t.exitTime.getTime() / 60_000));
  }
  return minutes.size;
}

/** True when the sample is dominated by clustered exits and reads as more data than it is. */
export function isClustered(trades: AnalyticsTrade[]): boolean {
  if (trades.length === 0) return false;
  return independentExits(trades) < trades.length * 0.5;
}

/* -------------------------------------------------------------------------- */
/* Equity & drawdown                                                           */
/* -------------------------------------------------------------------------- */

export type EquityPoint = {
  index: number;
  time: Date;
  /** Cumulative R after this trade. */
  r: number;
  /** Cumulative cash after this trade. */
  pl: number;
  /** Distance below the running peak, in R. Zero at a new high. */
  drawdownR: number;
};

/**
 * Equity curve, ordered by EXIT time.
 *
 * Ordering by exit rather than entry is what makes the drawdown real: a swing
 * trade opened in March and closed in June damages the account in June, and an
 * entry-ordered curve would show the loss before it happened.
 */
export function equityCurve(trades: AnalyticsTrade[]): EquityPoint[] {
  const ordered = [...trades]
    .filter((t) => t.exitTime)
    .sort((a, b) => a.exitTime!.getTime() - b.exitTime!.getTime());

  let r = 0;
  let pl = 0;
  let peak = 0;

  return ordered.map((t, index) => {
    r += t.rMultiple ?? 0;
    pl += t.realizedPl;
    peak = Math.max(peak, r);
    return { index, time: t.exitTime!, r, pl, drawdownR: r - peak };
  });
}

export type DrawdownSpell = {
  startedAt: Date;
  endedAt: Date | null;
  /** Depth in R, reported positive. */
  depthR: number;
  troughAt: Date;
  tradesUnderwater: number;
  /** Null while still underwater — an unrecovered drawdown has no duration yet. */
  recoveredInDays: number | null;
};

/** Every distinct spell below the running peak, deepest first. */
export function drawdowns(curve: EquityPoint[]): DrawdownSpell[] {
  const spells: DrawdownSpell[] = [];
  let current: (DrawdownSpell & { open: true }) | null = null;

  for (const p of curve) {
    if (p.drawdownR < 0) {
      if (!current) {
        current = {
          open: true,
          startedAt: p.time,
          endedAt: null,
          depthR: -p.drawdownR,
          troughAt: p.time,
          tradesUnderwater: 1,
          recoveredInDays: null,
        };
      } else {
        current.tradesUnderwater++;
        if (-p.drawdownR > current.depthR) {
          current.depthR = -p.drawdownR;
          current.troughAt = p.time;
        }
      }
    } else if (current) {
      current.endedAt = p.time;
      current.recoveredInDays =
        (p.time.getTime() - current.startedAt.getTime()) / 86_400_000;
      spells.push(current);
      current = null;
    }
  }

  // An open spell is included, and its lack of a recovery time is the point.
  if (current) spells.push(current);

  return spells.sort((a, b) => b.depthR - a.depthR);
}

export function maxDrawdownR(curve: EquityPoint[]): number {
  return curve.reduce((worst, p) => Math.min(worst, p.drawdownR), 0);
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                    */
/* -------------------------------------------------------------------------- */

export type Group<K> = { key: K; trades: AnalyticsTrade[]; summary: Summary };

export function groupBy<K>(
  trades: AnalyticsTrade[],
  keyOf: (t: AnalyticsTrade) => K | null,
): Group<K>[] {
  const map = new Map<string, { key: K; trades: AnalyticsTrade[] }>();
  for (const t of trades) {
    const key = keyOf(t);
    if (key === null) continue;
    const id = JSON.stringify(key);
    const entry = map.get(id) ?? { key, trades: [] };
    entry.trades.push(t);
    map.set(id, entry);
  }
  return [...map.values()].map((g) => ({ ...g, summary: summarise(g.trades) }));
}

/**
 * Buckets for an R histogram.
 *
 * Edges are on whole and half R because that is how the outcomes actually
 * cluster — a full stop out at −1, a scratch near 0, a target at +1 or +2.
 */
export function rHistogram(
  trades: AnalyticsTrade[],
  edges: number[] = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3],
): Array<{ from: number; to: number; count: number }> {
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r !== null);
  const buckets: Array<{ from: number; to: number; count: number }> = [];

  const bounds = [-Infinity, ...edges, Infinity];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i];
    const to = bounds[i + 1];
    buckets.push({
      from,
      to,
      count: rs.filter((r) => r >= from && r < to).length,
    });
  }
  return buckets;
}

/* -------------------------------------------------------------------------- */
/* Streaks                                                                     */
/* -------------------------------------------------------------------------- */

export type Streaks = {
  longestWin: number;
  longestLoss: number;
  /** Positive for a live winning streak, negative for a losing one. */
  current: number;
};

export function streaks(trades: AnalyticsTrade[]): Streaks {
  const ordered = [...trades]
    .filter((t) => t.exitTime)
    .sort((a, b) => a.exitTime!.getTime() - b.exitTime!.getTime());

  let longestWin = 0;
  let longestLoss = 0;
  let run = 0;

  for (const t of ordered) {
    // A scratch breaks neither streak — it is not evidence either way.
    if (t.realizedPl === 0) continue;
    const win = t.realizedPl > 0;
    run = win ? (run > 0 ? run + 1 : 1) : run < 0 ? run - 1 : -1;
    longestWin = Math.max(longestWin, run);
    longestLoss = Math.min(longestLoss, run);
  }

  return { longestWin, longestLoss: Math.abs(longestLoss), current: run };
}

/**
 * Does conviction actually predict outcome?
 *
 * Conviction-scaled sizing is only rational if it does. If A+ setups do not
 * beat B setups, the multiplier table is losing money and needs to be flat —
 * so this is measured rather than assumed.
 */
export function convictionEdge(
  trades: AnalyticsTrade[],
): Array<{ conviction: string; n: number; expectancyR: number | null }> {
  const order = ["A+", "A", "B", "C"];
  return order
    .map((c) => {
      const set = trades.filter((t) => t.conviction === c);
      const s = summarise(set);
      return { conviction: c, n: set.length, expectancyR: s.expectancyR };
    })
    .filter((g) => g.n > 0);
}
