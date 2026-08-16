import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ==========================================================================
   ENUMS
   ========================================================================== */

/** A real OANDA sub-account, organised by instrument class. */
export const bookEnum = pgEnum("book", ["primary", "fx", "indices", "commodities"]);
/** Hold time. A per-trade tag, NOT an account — Peter trades all four in every book. */
export const horizonEnum = pgEnum("horizon", ["scalp", "intraday", "swing", "position"]);
export const envEnum = pgEnum("environment", ["live", "practice"]);
export const directionEnum = pgEnum("direction", ["long", "short"]);
export const tradeStateEnum = pgEnum("trade_state", ["open", "closed"]);
export const convictionEnum = pgEnum("conviction", ["A+", "A", "B", "C"]);
export const gradeEnum = pgEnum("process_grade", ["A", "B", "C", "D", "F"]);
export const patternStatusEnum = pgEnum("pattern_status", [
  "incubating",
  "live",
  "retired",
]);
export const opportunitySourceEnum = pgEnum("opportunity_source", [
  "spotted", // Peter saw it
  "ai", // the AI proposed it
  "engine", // deterministic pattern trigger fired
]);

/* ==========================================================================
   ACCOUNTS & BOOKS
   ========================================================================== */

/**
 * Eight OANDA accounts: four live books plus four mirrored practice books.
 *
 * Environment decides BOTH the host (api-fxtrade vs api-fxpractice) AND which
 * token authenticates the request — OANDA treats them as entirely separate
 * systems. Routing lives in the client, driven off this column.
 */
export const accounts = pgTable("accounts", {
  /** OANDA account id, e.g. "001-004-1234567-001". */
  id: text("id").primaryKey(),
  book: bookEnum("book").notNull(),
  environment: envEnum("environment").notNull(),
  currency: text("currency").notNull().default("GBP"),
  alias: text("alias"),
  active: boolean("active").notNull().default(true),
  lastSyncedTransactionId: text("last_synced_transaction_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-book risk configuration. Percentages apply to that book's OWN equity,
 * because each book is a separate sub-account.
 */
export const books = pgTable("books", {
  id: bookEnum("id").primaryKey(),
  label: text("label").notNull(),
  baseRiskPct: numeric("base_risk_pct", { precision: 6, scale: 4 })
    .notNull()
    .default("0.75"),
  dailyLimitR: numeric("daily_limit_r", { precision: 6, scale: 2 })
    .notNull()
    .default("3.00"),
  /** { "A+": 1.5, "A": 1.0, "B": 0.5, "C": 0.25 } */
  convictionMultipliers: jsonb("conviction_multipliers").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

/**
 * Global configuration, single row (id = 1).
 *
 * A table rather than constants so the horizon boundaries are tunable without a
 * deploy — Peter's idea of where a scalp ends is his to set, not mine.
 */
export const appConfig = pgTable("app_config", {
  id: smallint("id").primaryKey().default(1),
  /** { scalpMaxMinutes, intradayMaxMinutes, swingMaxMinutes } */
  horizonThresholds: jsonb("horizon_thresholds").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const instruments = pgTable("instruments", {
  /** OANDA name, e.g. "EUR_USD", "XAU_USD", "SPX500_USD". */
  name: text("name").primaryKey(),
  displayName: text("display_name").notNull(),
  type: text("type").notNull(), // CURRENCY | CFD | METAL
  pipLocation: smallint("pip_location").notNull(),
  displayPrecision: smallint("display_precision").notNull(),
  marginRate: numeric("margin_rate", { precision: 8, scale: 4 }),
  /** Loose grouping for analytics: fx | index | commodity | metal | crypto. */
  assetClass: text("asset_class").notNull().default("fx"),
});

/* ==========================================================================
   THE LEDGER — source of truth
   ========================================================================== */

/**
 * Raw OANDA transactions, stored verbatim and idempotently.
 *
 * Everything downstream is derived from this table and nothing else. That means
 * a bug in trade-building is fixed by replaying the ledger rather than by data
 * surgery, and a re-derive is always safe to run.
 */
export const transactionsRaw = pgTable(
  "transactions_raw",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** OANDA transaction id — monotonic per account. */
    id: text("id").notNull(),
    type: text("type").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index("tx_account_time_idx").on(t.accountId, t.time),
    index("tx_type_idx").on(t.type),
  ],
);

/* ==========================================================================
   TRADES — derived, never hand-edited
   ========================================================================== */

export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** OANDA's own trade id — stable across re-derivation. */
    oandaTradeId: text("oanda_trade_id").notNull(),
    book: bookEnum("book").notNull(),
    /**
     * Inferred from hold time at derivation. Nullable because an open trade has
     * no final hold time yet. An explicit override lives in trade_annotations
     * so a re-derive cannot overwrite Peter's judgement.
     */
    horizon: horizonEnum("horizon"),
    instrument: text("instrument").notNull(),
    direction: directionEnum("direction").notNull(),
    state: tradeStateEnum("state").notNull(),

    units: numeric("units", { precision: 20, scale: 6 }).notNull(),
    entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
    entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
    exitTime: timestamp("exit_time", { withTimezone: true }),
    exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),

    /**
     * From the attached stop order. Because Peter always uses hard stops, this
     * is present on effectively every trade — which is what makes R-multiples,
     * planned risk and MAE/MFE fully automatic with no manual entry.
     */
    plannedStop: numeric("planned_stop", { precision: 20, scale: 8 }),
    plannedTarget: numeric("planned_target", { precision: 20, scale: 8 }),
    /** Planned risk in account currency — the denominator of every R figure. */
    initialRisk: numeric("initial_risk", { precision: 20, scale: 6 }),

    realizedPl: numeric("realized_pl", { precision: 20, scale: 6 }),
    financing: numeric("financing", { precision: 20, scale: 6 }).notNull().default("0"),
    commission: numeric("commission", { precision: 20, scale: 6 }).notNull().default("0"),
    /**
     * Sum of OANDA's `halfSpreadCost` across entry and exit fills — the real,
     * broker-reported cost of crossing the spread. Kept separate from P&L so
     * "would this pattern clear costs?" is answerable directly, which matters
     * most on the scalp book where targets are smallest.
     */
    spreadCost: numeric("spread_cost", { precision: 20, scale: 6 }).notNull().default("0"),

    rMultiple: real("r_multiple"),
    /** Max adverse / favourable excursion, expressed in R. */
    maeR: real("mae_r"),
    mfeR: real("mfe_r"),

    derivedAt: timestamp("derived_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trade_account_oanda_idx").on(t.accountId, t.oandaTradeId),
    index("trade_entry_time_idx").on(t.entryTime),
    index("trade_book_state_idx").on(t.book, t.state),
    index("trade_instrument_idx").on(t.instrument),
  ],
);

/**
 * Peter's annotations, kept in a SEPARATE table keyed on the broker's trade id.
 *
 * This separation is deliberate and load-bearing: trades are wiped and rebuilt
 * whenever derivation logic changes, and annotations must survive that. Keying
 * on the broker id rather than the derived row id is what guarantees it.
 */
export const tradeAnnotations = pgTable(
  "trade_annotations",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    oandaTradeId: text("oanda_trade_id").notNull(),

    patternId: integer("pattern_id").references(() => patterns.id, {
      onDelete: "set null",
    }),
    /** What the engine proposed, kept even after Peter overrides it — the
     *  disagreement is itself a signal about pattern definition quality. */
    suggestedPatternId: integer("suggested_pattern_id").references(() => patterns.id, {
      onDelete: "set null",
    }),
    patternConfirmed: boolean("pattern_confirmed").notNull().default(false),

    conviction: convictionEnum("conviction"),
    /**
     * Overrides the inferred horizon. Kept here rather than on `trades` so a
     * wholesale re-derive can never discard it.
     */
    horizonOverride: horizonEnum("horizon_override"),
    /** Graded on PROCESS, deliberately independent of outcome. */
    processGrade: gradeEnum("process_grade"),
    /** ["entry.chased", "exit.cut_winner_early", ...] */
    mistakes: jsonb("mistakes").$type<string[]>().notNull().default([]),

    reasoning: text("reasoning"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.oandaTradeId] })],
);

/* ==========================================================================
   PATTERN LIBRARY
   ========================================================================== */

export const patterns = pgTable("patterns", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary"),

  /** Flat list + multi-dimensional tags: horizon, condition, class, timeframe. */
  tags: jsonb("tags")
    .$type<{
      horizons?: string[];
      conditions?: string[];
      instrumentClasses?: string[];
      timeframes?: string[];
    }>()
    .notNull()
    .default({}),

  /** Machine-checkable conditions the deterministic scanner evaluates. */
  triggerRules: jsonb("trigger_rules").$type<unknown[]>().notNull().default([]),
  invalidation: text("invalidation"),
  /** Session, volatility regime, trend state, news proximity. */
  contextFilters: jsonb("context_filters").$type<Record<string, unknown>>().notNull().default({}),
  /** Profit taking, scaling, trailing, breakeven rules. */
  targetLogic: text("target_logic"),

  status: patternStatusEnum("status").notNull().default("incubating"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const patternExamples = pgTable("pattern_examples", {
  id: serial("id").primaryKey(),
  patternId: integer("pattern_id")
    .notNull()
    .references(() => patterns.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  oandaTradeId: text("oanda_trade_id").notNull(),
  kind: text("kind").notNull().default("canonical"), // canonical | best | worst
  note: text("note"),
});

/* ==========================================================================
   THE DAILY LOOP
   ========================================================================== */

/**
 * Best Opportunities: everything spotted plus every AI candidate.
 *
 * The `source` column is what makes the three-way comparison possible —
 * what Peter spotted, what the AI spotted, and what was actually traded.
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    day: date("day").notNull(),
    instrument: text("instrument").notNull(),
    source: opportunitySourceEnum("source").notNull(),
    patternId: integer("pattern_id").references(() => patterns.id, {
      onDelete: "set null",
    }),
    book: bookEnum("book"),
    conviction: convictionEnum("conviction"),
    /** 0–100 conviction score from the scanner. */
    score: real("score"),
    /** Written rationale — must be interrogable, never a bare number. */
    reasoning: text("reasoning"),
    /** What would invalidate it, captured at spot time. */
    invalidation: text("invalidation"),
    taken: boolean("taken").notNull().default(false),
    linkedAccountId: text("linked_account_id"),
    linkedOandaTradeId: text("linked_oanda_trade_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("opp_day_idx").on(t.day), index("opp_source_idx").on(t.source)],
);

export const dailyPlans = pgTable("daily_plans", {
  day: date("day").primaryKey(),
  /** { "EUR_USD": "long above 1.0850", ... } */
  bias: jsonb("bias").$type<Record<string, string>>().notNull().default({}),
  levels: jsonb("levels").$type<Record<string, number[]>>().notNull().default({}),
  setupsHunted: jsonb("setups_hunted").$type<number[]>().notNull().default([]),
  notes: text("notes"),
  aiDraft: text("ai_draft"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyReviews = pgTable("daily_reviews", {
  day: date("day").primaryKey(),
  processGrade: gradeEnum("process_grade"),
  adherencePct: real("adherence_pct"),
  whatWorked: text("what_worked"),
  whatBroke: text("what_broke"),
  tomorrow: text("tomorrow"),
  notes: text("notes"),
  aiDraft: text("ai_draft"),
  aiModel: text("ai_model"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * State logging. Kept deliberately small — an unfilled field is worse than no
 * field, so this is only what can be completed in about ten seconds.
 */
export const stateLogs = pgTable("state_logs", {
  day: date("day").primaryKey(),
  sleep: smallint("sleep"), // 1–5
  energy: smallint("energy"),
  focus: smallint("focus"),
  emotionPre: text("emotion_pre"),
  emotionDuring: text("emotion_during"),
  emotionPost: text("emotion_post"),
  /** ["revenge_urge", "frustration", "boredom", "overconfidence"] */
  tiltMarkers: jsonb("tilt_markers").$type<string[]>().notNull().default([]),
  notes: text("notes"),
});

/**
 * Goals.
 *
 * Every goal names a metric the app already computes from the ledger, so
 * progress is measured rather than self-reported. That is the whole design
 * constraint: a goal whose progress you type in yourself is a note, and notes
 * belong in `daily_reviews`.
 *
 * `metric` is deliberately a small closed set for the same reason — an
 * arbitrary free-text target could not be scored against anything.
 */
export const goalMetricEnum = pgEnum("goal_metric", [
  "total_r", // cumulative R over the period
  "expectancy_r", // mean R per trade
  "win_rate", // percentage
  "max_drawdown_r", // a CEILING, not a floor — lower is better
  "profit_factor",
  "trade_count", // useful as a ceiling when overtrading is the problem
  "adherence_pct", // mean rule adherence from daily reviews
]);

export const goals = pgTable(
  "goals",
  {
    id: serial("id").primaryKey(),
    /** "2026-08" for a month, "2026-Q3" for a quarter, "2026" for a year. */
    period: text("period").notNull(),
    metric: goalMetricEnum("metric").notNull(),
    target: numeric("target", { precision: 12, scale: 4 }).notNull(),
    /**
     * True when the goal is met by staying BELOW the target — drawdown and
     * trade count. Without this the same comparison would score them backwards.
     */
    lowerIsBetter: boolean("lower_is_better").notNull().default(false),
    /** Null means every live book. */
    book: bookEnum("book"),
    note: text("note"),
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goal_period_idx").on(t.period)],
);

/* ==========================================================================
   MARKET DATA & CONTEXT
   ========================================================================== */

/**
 * Cached candle windows around every trade, kept permanently.
 *
 * This is what makes the journal durable: a chart from three years ago renders
 * instantly and identically, regardless of OANDA's history retention or any
 * subsequent data revision.
 */
export const candles = pgTable(
  "candles",
  {
    instrument: text("instrument").notNull(),
    granularity: text("granularity").notNull(), // M1, M5, M15, H1, D…
    time: timestamp("time", { withTimezone: true }).notNull(),
    o: numeric("o", { precision: 20, scale: 8 }).notNull(),
    h: numeric("h", { precision: 20, scale: 8 }).notNull(),
    l: numeric("l", { precision: 20, scale: 8 }).notNull(),
    c: numeric("c", { precision: 20, scale: 8 }).notNull(),
    /** ⚠️ Tick count, NOT traded volume — FX has no centralised volume. */
    tickVolume: integer("tick_volume").notNull().default(0),
    complete: boolean("complete").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.instrument, t.granularity, t.time] })],
);

export const watchlistLevels = pgTable("watchlist_levels", {
  id: serial("id").primaryKey(),
  instrument: text("instrument").notNull(),
  price: numeric("price", { precision: 20, scale: 8 }).notNull(),
  label: text("label"),
  kind: text("kind").notNull().default("level"), // level | support | resistance | target
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // level_approach | daily_limit | streak | pattern_trigger
  severity: text("severity").notNull().default("info"), // info | warn | critical
  /** Severity routes to channels: visual, sound, push, email. */
  channels: jsonb("channels").$type<string[]>().notNull().default(["visual"]),
  rule: jsonb("rule").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
});

export const macroEvents = pgTable(
  "macro_events",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(), // finnhub | twelvedata | fred | polymarket
    time: timestamp("time", { withTimezone: true }).notNull(),
    country: text("country"),
    title: text("title").notNull(),
    importance: smallint("importance"),
    actual: text("actual"),
    forecast: text("forecast"),
    previous: text("previous"),
    /** Market-implied probability from Polymarket, 0–1, when one maps to this event. */
    impliedProbability: real("implied_probability"),
    polymarketSlug: text("polymarket_slug"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("macro_time_idx").on(t.time)],
);

/**
 * The Wire — a flowing feed of what is happening, as opposed to the dated
 * schedule above.
 *
 * `macro_events` answers "what is due"; this answers "what just happened".
 * They stay separate tables because they have different shapes and different
 * lifetimes: a calendar entry is known days ahead and updated in place, while a
 * feed item is immutable once published and ages out.
 *
 * Persisted rather than fetched per render for three reasons: the stream must
 * survive a reload, two providers routinely carry the same wire story and need
 * deduping, and "since you last looked" is meaningless without history.
 */
export const feedItems = pgTable(
  "feed_items",
  {
    /** Source-prefixed and deterministic, e.g. "sec:0000320193-24-000123". */
    id: text("id").primaryKey(),
    source: text("source").notNull(), // polygon | finnhub | fed | sec | macro
    category: text("category").notNull(), // news | central_bank | economic | filing
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    headline: text("headline").notNull(),
    summary: text("summary"),
    url: text("url"),
    /**
     * Lead image as the provider gave it. Null is the common case, not an
     * error — SEC filings and Fed releases have no artwork, and the row is
     * laid out so an absent image reads as deliberate rather than broken. We
     * never substitute a stock photo: an illustration the publisher did not
     * choose is fabricated context on a story you may trade against.
     */
    imageUrl: text("image_url"),
    /** Equity symbols exactly as the provider gave them — Alpaca's universe. */
    tickers: text("tickers").array().notNull().default([]),
    /** Resolved to OANDA instrument names. See lib/feed/resolve.ts for the rules. */
    instruments: text("instruments").array().notNull().default([]),
    /**
     * 1–3, driving visual emphasis ONLY. It never reorders the feed: a stream
     * that rearranges itself is one you cannot trust to have shown you
     * something, so absence has to be meaningful.
     */
    importance: smallint("importance"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feed_published_idx").on(t.publishedAt)],
);

/* ==========================================================================
   AUTONOMOUS EXECUTION
   --------------------------------------------------------------------------
   Separate from everything above on purpose. The read path never touches these
   tables, and nothing here is required for the journal to work.
   ========================================================================== */

export const armStateEnum = pgEnum("arm_state", ["disarmed", "armed", "halted"]);

/**
 * Arm state, per book. Defaults to disarmed and stays that way until an
 * explicit action — there is no configuration that starts the engine trading.
 *
 * `halted` is distinct from `disarmed`: it means a guard tripped (usually the
 * daily loss limit) and requires deliberate re-arming rather than resuming on
 * its own at midnight.
 */
export const executionState = pgTable("execution_state", {
  book: bookEnum("book").primaryKey(),
  state: armStateEnum("state").notNull().default("disarmed"),
  /** Practice-only unless deliberately unlocked. Guards read this, not env. */
  allowLiveCapital: boolean("allow_live_capital").notNull().default(false),
  /**
   * When true the engine computes and logs every order without sending it.
   * Defaults true so the FIRST arming of a book is always harmless — going
   * live is a second, deliberate click rather than a consequence of arming.
   */
  dryRun: boolean("dry_run").notNull().default(true),
  /** Only these instruments may be traded. Empty = nothing is permitted. */
  instrumentAllowlist: jsonb("instrument_allowlist").$type<string[]>().notNull().default([]),
  maxOpenPositions: smallint("max_open_positions").notNull().default(2),
  /** Ceiling on a single order as a multiple of the book's base risk. */
  maxRiskMultiple: numeric("max_risk_multiple", { precision: 5, scale: 2 })
    .notNull()
    .default("1.50"),
  /** Which patterns this book is allowed to trade. Empty = none. */
  enabledPatternIds: jsonb("enabled_pattern_ids").$type<number[]>().notNull().default([]),
  haltedReason: text("halted_reason"),
  armedAt: timestamp("armed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderOutcomeEnum = pgEnum("order_outcome", [
  "rejected_by_guard",
  "dry_run",
  "submitted",
  "filled",
  "broker_rejected",
  "error",
]);

/**
 * Every order the engine considered — including the ones it refused to send.
 *
 * Rejections are recorded as deliberately as fills: "why did it NOT trade?" is
 * as important as "why did it trade?", and without the rejected attempts the
 * guards are unfalsifiable.
 */
export const orderLog = pgTable(
  "order_log",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id").notNull(),
    book: bookEnum("book").notNull(),
    patternId: integer("pattern_id").references(() => patterns.id, {
      onDelete: "set null",
    }),

    instrument: text("instrument").notNull(),
    direction: directionEnum("direction").notNull(),
    units: numeric("units", { precision: 20, scale: 6 }).notNull(),
    requestedStop: numeric("requested_stop", { precision: 20, scale: 8 }),
    requestedTarget: numeric("requested_target", { precision: 20, scale: 8 }),
    /** Intended risk in account currency at the moment of the decision. */
    intendedRisk: numeric("intended_risk", { precision: 20, scale: 6 }),

    outcome: orderOutcomeEnum("outcome").notNull(),
    /** Which guard refused it, when one did. */
    rejectedBy: text("rejected_by"),
    reason: text("reason"),

    /** OANDA's ids, once an order actually reaches the broker. */
    oandaOrderId: text("oanda_order_id"),
    oandaTradeId: text("oanda_trade_id"),
    /** Full request and response, for reconstructing any decision after the fact. */
    request: jsonb("request").$type<Record<string, unknown>>(),
    response: jsonb("response").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("order_log_created_idx").on(t.createdAt),
    index("order_log_book_idx").on(t.book),
    index("order_log_outcome_idx").on(t.outcome),
    // Supports the duplicate-order guard, which looks for a matching recent order.
    index("order_log_dedupe_idx").on(t.accountId, t.instrument, t.createdAt),
  ],
);

/* ==========================================================================
   AI
   ========================================================================== */

/**
 * Every AI call is logged with its cost. Spend should be visible in the app
 * from the first call rather than discovered later on a bill.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: serial("id").primaryKey(),
    task: text("task").notNull(), // eod_draft | grade | scan_context | meta | ask | premarket | pretrade
    provider: text("provider").notNull(), // anthropic | openai | google | xai
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_runs_created_idx").on(t.createdAt), index("ai_runs_task_idx").on(t.task)],
);

/* ==========================================================================
   MEMBERS AND CHAT
   --------------------------------------------------------------------------
   The first multi-tenant surface. Everything above this line belongs to one
   trader; everything below assumes many.
   ========================================================================== */

/**
 * A person who can use this platform.
 *
 * ── Identity lives at drawdown.trading, not here ──────────────────────────
 * This app never holds a password for a subscriber. Drawdown authenticates
 * them and issues a signed token; `externalId` is that system's user id and is
 * the only durable link between the two. Nothing here is a credential, so a
 * dump of this table cannot be used to log in anywhere.
 *
 * Peter's own single-password login continues to work and resolves to a row
 * here with a reserved `externalId`, so one code path serves both rather than
 * a permanent special case threaded through every query.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /** Drawdown's user id. Reserved value "local:owner" is the password login. */
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    /**
     * Chat is not available until the terms are accepted, and this records
     * WHEN rather than whether — an undated boolean cannot answer "which terms
     * did they agree to", which is the question that actually gets asked.
     */
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    /** Version of the terms accepted, so a re-acceptance can be required. */
    termsVersion: text("terms_version"),

    /* ---- Chat profile, set during onboarding ---- */

    /**
     * The name shown in chat, chosen by the member.
     *
     * Separate from `displayName`, which is whatever Drawdown calls them: a
     * real name is fine on an invoice and a poor thing to force onto a public
     * message. Unique, and compared lowercased so `Trader` cannot be minted
     * alongside `trader` to impersonate them.
     */
    username: text("username"),
    /** When it was last set. Drives the change cooldown — see lib/identity/profile.ts. */
    usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
    jobTitle: text("job_title"),
    /**
     * Avatar as a small `data:` URL rather than a link or an upload.
     *
     * No object storage is configured, and adding a bucket to put a 6KB
     * thumbnail somewhere would be the larger change. The image is resized and
     * re-encoded to JPEG in the browser before it is ever sent, which caps the
     * size and strips whatever the original was — including SVG, which can
     * carry script, and EXIF, which can carry the member's home address.
     * Validated again server-side; the browser is not the check.
     */
    avatar: text("avatar"),

    /**
     * The toggle. Distinct from having accepted the terms: acceptance is a
     * fact that happened once, this is a switch the member can turn off again
     * without it un-happening.
     */
    chatEnabled: boolean("chat_enabled").notNull().default(false),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_external_idx").on(t.externalId),
    // Partial: many rows legitimately have no username yet, and NULLs must not
    // collide with each other.
    uniqueIndex("users_username_idx")
      .on(sql`lower(${t.username})`)
      .where(sql`${t.username} is not null`),
  ],
);

/**
 * Every username a member has released.
 *
 * Two jobs, and the second is the reason the table exists rather than a column.
 *
 * It is the AUDIT TRAIL: message rows carry a user id, and the room renders
 * whatever name that user holds now — so a member who posts and then renames
 * relabels their own history. That is right for them and useless for anyone
 * asking "who was `gold_bug` in August", which is exactly the question a
 * moderation complaint asks.
 *
 * It is also the RESERVATION list. A freed name cannot be taken by someone else
 * for a while, because the confusion is not the rename — it is a second person
 * appearing under a name other members already associate with the first.
 */
export const usernameHistory = pgTable(
  "username_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The name as it was held, original casing preserved. */
    username: text("username").notNull(),
    heldFrom: timestamp("held_from", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("username_history_user_idx").on(t.userId),
    index("username_history_name_idx").on(sql`lower(${t.username})`),
  ],
);

/**
 * A chat room. Rooms rather than DMs — with a small membership, one busy room
 * beats a hundred silent private threads.
 */
export const chatRooms = pgTable(
  "chat_rooms",
  {
    /** URL-safe and stable, e.g. "xauusd". Rooms are addressed by slug. */
    slug: text("slug").primaryKey(),
    label: text("label").notNull(),
    topic: text("topic"),
    /** Optional OANDA instrument this room is about, for cross-linking. */
    instrument: text("instrument"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_rooms_archived_idx").on(t.archived)],
);

/**
 * A message.
 *
 * ── History is permanent ──────────────────────────────────────────────────
 * Deliberately NO retention cutoff, unlike `feed_items` which ages out. Two
 * reasons: a room's history is the archive of what people actually said as a
 * market moved, and a platform carrying trading discussion may need to produce
 * that record later. Deletion is therefore a moderation act with an audit
 * trail — `deletedAt` and `deletedBy` — never a row disappearing.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    roomSlug: text("room_slug")
      .notNull()
      .references(() => chatRooms.slug, { onDelete: "cascade" }),
    /**
     * No cascade on delete: removing a person must never silently rewrite a
     * conversation other people took part in.
     */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Moderation. The row stays; the body stops being shown. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: integer("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("chat_messages_room_idx").on(t.roomSlug, t.id)],
);
