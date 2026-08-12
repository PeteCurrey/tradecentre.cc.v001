/**
 * Books and horizons — two separate dimensions.
 *
 * ── BOOK = a real OANDA sub-account, organised by INSTRUMENT CLASS ──────────
 * Matches how Peter has actually named his sub-accounts (Primary, FX, Indices,
 * Commodities). Isolation is enforced by the broker rather than by tagging, so
 * a blown book cannot reach another's capital. Risk percentages apply to that
 * book's OWN equity.
 *
 * ── HORIZON = hold time, a per-TRADE tag ───────────────────────────────────
 * Peter trades all four horizons, and does so within each instrument book — so
 * horizon cannot be an account. It is inferred from hold time during derivation
 * and can be overridden per trade.
 *
 * Keeping these separate is what lets "how do I do on gold swings?" and "how do
 * I do on scalps generally?" both be answerable.
 */

export const BOOK_IDS = ["primary", "fx", "indices", "commodities"] as const;
export type BookId = (typeof BOOK_IDS)[number];

/** Scope of the account switcher: one book, the live roll-up, or a demo book. */
export type Scope = BookId | "all-live" | `demo:${BookId}`;

export type BookDef = {
  id: BookId;
  label: string;
  /** What this book trades, shown in the switcher for orientation. */
  covers: string;
  /** CSS var carrying this book's identity colour. */
  colorVar: string;
};

export const BOOKS: Record<BookId, BookDef> = {
  primary: {
    id: "primary",
    label: "Primary",
    covers: "Mixed — gold & FX majors",
    colorVar: "var(--color-book-primary)",
  },
  fx: {
    id: "fx",
    label: "FX",
    covers: "Currency pairs",
    colorVar: "var(--color-book-fx)",
  },
  indices: {
    id: "indices",
    label: "Indices",
    covers: "SPX500, NAS100, US30, UK100…",
    colorVar: "var(--color-book-indices)",
  },
  commodities: {
    id: "commodities",
    label: "Commodities",
    covers: "Gold, silver, oil, gas",
    colorVar: "var(--color-book-commodities)",
  },
};

export const BOOK_LIST: BookDef[] = BOOK_IDS.map((id) => BOOKS[id]);

/**
 * Demo never joins any aggregate. This is the guard every query path must
 * respect — the whole point of mirroring the structure rather than flagging
 * demo trades inside one pool.
 */
export function isDemo(scope: Scope): boolean {
  return scope.startsWith("demo:");
}

export function scopeLabel(scope: Scope): string {
  if (scope === "all-live") return "All Live";
  if (isDemo(scope)) {
    const book = scope.slice("demo:".length) as BookId;
    return `Demo · ${BOOKS[book].label}`;
  }
  return BOOKS[scope as BookId].label;
}

/** Which books a scope resolves to. Demo scopes resolve to exactly one. */
export function booksInScope(scope: Scope): BookId[] {
  if (scope === "all-live") return [...BOOK_IDS];
  if (isDemo(scope)) return [scope.slice("demo:".length) as BookId];
  return [scope as BookId];
}

/* -------------------------------------------------------------------------- */
/* Horizon — inferred from hold time                                           */
/* -------------------------------------------------------------------------- */

export const HORIZON_IDS = ["scalp", "intraday", "swing", "position"] as const;
export type HorizonId = (typeof HORIZON_IDS)[number];

export type HorizonDef = {
  id: HorizonId;
  label: string;
  description: string;
  colorVar: string;
};

export const HORIZONS: Record<HorizonId, HorizonDef> = {
  scalp: {
    id: "scalp",
    label: "Scalp",
    description: "Seconds to minutes",
    colorVar: "var(--color-horizon-scalp)",
  },
  intraday: {
    id: "intraday",
    label: "Intraday",
    description: "Flat by the close",
    colorVar: "var(--color-horizon-intraday)",
  },
  swing: {
    id: "swing",
    label: "Swing",
    description: "Days to weeks",
    colorVar: "var(--color-horizon-swing)",
  },
  position: {
    id: "position",
    label: "Position",
    description: "Weeks to months",
    colorVar: "var(--color-horizon-position)",
  },
};

export const HORIZON_LIST: HorizonDef[] = HORIZON_IDS.map((id) => HORIZONS[id]);

/**
 * Upper bound of each horizon, in minutes. A trade held longer than the swing
 * bound is a position trade.
 *
 * Defaults, not laws — they live in app config so Peter can tune them. The
 * intraday bound of 8h is deliberately shorter than a calendar day: a trade
 * opened in London and closed in New York is intraday, but one held 20 hours
 * has crossed a session boundary and behaves like a swing.
 */
export type HorizonThresholds = {
  scalpMaxMinutes: number;
  intradayMaxMinutes: number;
  swingMaxMinutes: number;
};

export const DEFAULT_HORIZON_THRESHOLDS: HorizonThresholds = {
  scalpMaxMinutes: 15,
  intradayMaxMinutes: 8 * 60,
  swingMaxMinutes: 21 * 24 * 60, // three weeks
};

export function inferHorizon(
  holdMs: number,
  t: HorizonThresholds = DEFAULT_HORIZON_THRESHOLDS,
): HorizonId {
  const minutes = holdMs / 60_000;
  if (minutes <= t.scalpMaxMinutes) return "scalp";
  if (minutes <= t.intradayMaxMinutes) return "intraday";
  if (minutes <= t.swingMaxMinutes) return "swing";
  return "position";
}

/* -------------------------------------------------------------------------- */
/* Conviction                                                                  */
/* -------------------------------------------------------------------------- */

export const CONVICTION_GRADES = ["A+", "A", "B", "C"] as const;
export type Conviction = (typeof CONVICTION_GRADES)[number];

/**
 * Risk multipliers applied to a book's base risk.
 *
 * Defaults only — they live in Settings and are Peter's to tune.
 *
 * Worth stating plainly: conviction-scaled sizing is only rational if
 * conviction actually predicts outcome. The app measures that correlation
 * directly, because if A+ setups don't beat B setups this table is losing money.
 */
export const DEFAULT_CONVICTION_MULTIPLIERS: Record<Conviction, number> = {
  "A+": 1.5,
  A: 1.0,
  B: 0.5,
  C: 0.25,
};

export const CONVICTION_COLOR_VAR: Record<Conviction, string> = {
  "A+": "var(--color-grade-aplus)",
  A: "var(--color-grade-a)",
  B: "var(--color-grade-b)",
  C: "var(--color-grade-c)",
};
