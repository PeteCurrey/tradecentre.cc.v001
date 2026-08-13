/**
 * The wire format between the server hub and the browser.
 *
 * Deliberately NOT in `hub.ts`: that module imports `server-only`, and while a
 * type-only import of it is erased at compile time, one accidental value import
 * from a client component would fail the build with an error pointing at the
 * wrong file. Keeping the shapes in a module with no runtime dependencies means
 * both sides can import it plainly and the compiler checks that they agree.
 *
 * Everything here crosses a process boundary as JSON, so: no Dates, no Maps,
 * no class instances. Timestamps are epoch milliseconds — ISO strings would
 * survive the trip but need re-parsing on every render.
 */

export type ConnectionState = "connecting" | "live" | "stale" | "offline";

export type Tick = {
  instrument: string;
  bid: number;
  ask: number;
  mid: number;
  time: string;
};

/* ==========================================================================
   DESK — the broker's own numbers, pushed periodically
   ========================================================================== */

/**
 * One open position, as the browser needs it to mark to market.
 *
 * `unrealizedPl` and `plPerUnit` come as a pair on purpose. The browser cannot
 * recompute P&L from price alone — that needs the instrument's quote currency
 * converted into the account currency, which only the broker knows reliably.
 * So the server sends the conversion factor it just observed, and the browser
 * multiplies the price delta by it. Between pushes that is an approximation,
 * and the next push corrects it.
 */
export type LivePosition = {
  oandaTradeId: string;
  book: string;
  instrument: string;
  direction: "long" | "short";
  units: number;
  entryPrice: number;
  currentStop: number | null;
  currentTarget: number | null;
  /** Broker-reported unrealised P&L in account currency at push time. */
  unrealizedPl: number;
  /** The price the broker's figure was computed against. */
  markPrice: number;
  /**
   * Account-currency P&L per 1.0 of price movement, in the trade's direction.
   * Derived from the broker's own numbers so no FX assumption is invented here.
   */
  plPerPrice: number;
  /** Risk still on the table, in R. Zero once the stop is at or past entry. */
  riskR: number;
  /** Original risk distance in price terms — lets the browser recompute R live. */
  riskDistance: number | null;
  openedAt: number;
};

export type LiveBook = {
  book: string;
  currency: string;
  live: boolean;
  equity: number | null;
  balance: number | null;
  marginUsed: number | null;
  marginAvailable: number | null;
  unrealizedPl: number;
  todayPl: number;
  todayR: number;
  todayTrades: number;
  openRiskR: number;
  dailyLimitR: number;
  positions: LivePosition[];
  /** Execution state, so the shell can show armed status on every page. */
  armState: "disarmed" | "armed" | "halted";
  dryRun: boolean;
};

export type DeskPush = {
  at: number;
  books: LiveBook[];
  /** Books whose broker call failed — the UI must say so rather than imply live. */
  degraded: string[];
};

/* ==========================================================================
   SCAN — what the engine is thinking between trades
   ========================================================================== */

export type ScanCondition = {
  /** Prose from `describeCondition`, so the UI never re-implements the DSL. */
  label: string;
  met: boolean;
};

/**
 * One instrument/pattern pair the engine evaluated on the last tick.
 *
 * This is the answer to "it's armed and flat — is it actually doing anything?".
 * It is derived from the same evaluator that decides real entries, so it cannot
 * drift from what the engine will actually do.
 */
export type ScanCandidate = {
  book: string;
  instrument: string;
  patternId: number;
  patternName: string;
  direction: "long" | "short";
  /** How many of the trigger's top-level conditions currently hold. */
  met: number;
  total: number;
  conditions: ScanCondition[];
  /**
   * Set when every condition held but the order was still not placed — the
   * guard that refused it. A candidate at 3/3 with no reason is a live entry.
   */
  blockedBy: string | null;
  blockedReason: string | null;
  /** Bar close the evaluation was made against. */
  barTime: number;
};

export type ScanPush = {
  at: number;
  /** How long the tick took, in ms. */
  durationMs: number;
  /** When the next tick is due, so the UI can run a countdown. */
  nextAt: number;
  /** Instrument/pattern pairs evaluated, including the ones nowhere near firing. */
  evaluated: number;
  /** Only the candidates worth showing — see NEAR_MISS_FLOOR in telemetry.ts. */
  candidates: ScanCandidate[];
  /** Books that ticked. Empty means nothing was armed. */
  books: string[];
  marketOpen: boolean;
};

/* ==========================================================================
   ENGINE — discrete things that happened
   ========================================================================== */

export type EngineEvent = {
  at: number;
  kind: "fill" | "rejected" | "managed" | "armed" | "disarmed" | "halted" | "dry_run";
  book: string;
  instrument: string | null;
  /** Human-readable, already formatted server-side. */
  headline: string;
  detail: string | null;
  /** Present on fills, so a toast can link straight to the trade. */
  oandaTradeId: string | null;
  patternName: string | null;
  /** True when this reached the broker; false for dry run and rejections. */
  sent: boolean;
};

/* ==========================================================================
   HUB EVENT UNION
   ========================================================================== */

export type HubEvent =
  | { type: "tick"; tick: Tick }
  | { type: "transaction"; accountId: string; transactionType: string; id: string }
  | { type: "status"; state: ConnectionState; detail?: string }
  | { type: "desk"; desk: DeskPush }
  | { type: "scan"; scan: ScanPush }
  | { type: "engine"; event: EngineEvent };

/**
 * Mark a position to market from a tick.
 *
 * Returns the P&L the position would show at `price`, using the conversion the
 * broker last reported. Kept here rather than in a component so the hero, the
 * positions table and the ribbons cannot disagree about the same number.
 */
export function markToMarket(p: LivePosition, price: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(p.plPerPrice)) return p.unrealizedPl;
  return p.unrealizedPl + (price - p.markPrice) * p.plPerPrice;
}

/**
 * Progress from entry, in R.
 *
 * Negative is toward the stop, positive is toward the target. This is the value
 * the ribbons and the position rows animate on, so it lives beside
 * `markToMarket` rather than being re-derived per component.
 */
export function positionProgress(p: LivePosition, price: number): number {
  if (!Number.isFinite(price) || !p.riskDistance || p.riskDistance <= 0) return 0;
  const delta = p.direction === "long" ? price - p.entryPrice : p.entryPrice - price;
  return delta / p.riskDistance;
}
