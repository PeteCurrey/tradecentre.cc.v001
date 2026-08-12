import type { BookId } from "@/lib/books";
import type { OandaEnvironment } from "@/lib/oanda/types";

/**
 * Execution guards.
 *
 * Hard limits the engine physically cannot exceed — not settings it consults
 * and may ignore. Every one is a pure function so each refusal path is testable
 * without a broker, a database or a network.
 *
 * Design rules:
 *   • DENY BY DEFAULT. Missing, unknown or unparseable input is a refusal, not
 *     a pass. An engine that trades when its own state is unclear is the exact
 *     failure this module exists to prevent.
 *   • Guards run in order of severity, and the FIRST refusal wins, so the
 *     reason recorded is the most fundamental one rather than an incidental
 *     later check.
 *   • Every refusal names the guard, so the order log says why.
 */

export type GuardDecision =
  | { allowed: true }
  | { allowed: false; guard: string; reason: string };

const allow: GuardDecision = { allowed: true };
const deny = (guard: string, reason: string): GuardDecision => ({
  allowed: false,
  guard,
  reason,
});

export type ExecutionConfig = {
  state: "disarmed" | "armed" | "halted";
  allowLiveCapital: boolean;
  instrumentAllowlist: string[];
  maxOpenPositions: number;
  maxRiskMultiple: number;
  enabledPatternIds: number[];
};

export type OrderIntent = {
  book: BookId;
  accountId: string;
  environment: OandaEnvironment;
  instrument: string;
  direction: "long" | "short";
  units: number;
  /** Absolute stop price. Required — an order without one is always refused. */
  stopPrice: number | null;
  targetPrice: number | null;
  entryPrice: number;
  patternId: number | null;
};

export type AccountSnapshot = {
  equity: number;
  openPositions: number;
  /** Today's realised R for this book. Negative is a loss. */
  dailyR: number;
  dailyLimitR: number;
  /** Base risk as a fraction of equity, e.g. 0.0075 for 0.75%. */
  baseRiskFraction: number;
};

export type RecentOrder = {
  instrument: string;
  direction: "long" | "short";
  units: number;
  createdAt: Date;
};

export type GuardInput = {
  config: ExecutionConfig;
  intent: OrderIntent;
  account: AccountSnapshot;
  recentOrders: RecentOrder[];
  now: Date;
};

/** Orders per rolling window, across all instruments. */
export const RATE_LIMIT_MAX = 6;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** A same-instrument, same-direction order inside this window is a duplicate. */
export const DUPLICATE_WINDOW_MS = 30_000;

/* -------------------------------------------------------------------------- */

export function checkOrder(input: GuardInput): GuardDecision {
  for (const guard of GUARDS) {
    const decision = guard(input);
    if (!decision.allowed) return decision;
  }
  return allow;
}

declare const approvalBrand: unique symbol;

/**
 * Proof that an intent passed every guard.
 *
 * The execution client will not accept a bare OrderIntent — it requires one of
 * these, and only `approveOrder()` can produce one. Bypassing the guards is
 * therefore a type error rather than a code review someone has to catch.
 */
export type GuardApproval = {
  readonly [approvalBrand]: true;
  readonly intent: OrderIntent;
  readonly approvedAt: Date;
};

export type ApprovalResult =
  | { approved: true; approval: GuardApproval }
  | { approved: false; guard: string; reason: string };

export function approveOrder(input: GuardInput): ApprovalResult {
  const decision = checkOrder(input);
  if (!decision.allowed) {
    return { approved: false, guard: decision.guard, reason: decision.reason };
  }
  return {
    approved: true,
    approval: {
      intent: input.intent,
      approvedAt: input.now,
    } as GuardApproval,
  };
}

type Guard = (input: GuardInput) => GuardDecision;

/** Ordered most-fundamental first: the first refusal is the one reported. */
const GUARDS: Guard[] = [
  function armed({ config }) {
    if (config.state === "halted") {
      return deny("armed", "Engine is halted and needs deliberate re-arming");
    }
    if (config.state !== "armed") {
      return deny("armed", "Engine is disarmed");
    }
    return allow;
  },

  function liveCapital({ config, intent }) {
    // Practice unless explicitly unlocked. Deliberately reads stored config
    // rather than an env var, so unlocking is an auditable action.
    if (intent.environment === "live" && !config.allowLiveCapital) {
      return deny(
        "liveCapital",
        "Live capital is not unlocked for this book; practice accounts only",
      );
    }
    return allow;
  },

  function dailyLossLimit({ account }) {
    if (!Number.isFinite(account.dailyR) || !Number.isFinite(account.dailyLimitR)) {
      return deny("dailyLossLimit", "Daily R is unknown");
    }
    // dailyLimitR is a positive magnitude; a loss is negative R.
    if (account.dailyR <= -Math.abs(account.dailyLimitR)) {
      return deny(
        "dailyLossLimit",
        `Daily loss limit reached (${account.dailyR.toFixed(2)}R of −${Math.abs(
          account.dailyLimitR,
        ).toFixed(2)}R)`,
      );
    }
    return allow;
  },

  function openPositionCap({ config, account }) {
    if (account.openPositions >= config.maxOpenPositions) {
      return deny(
        "openPositionCap",
        `${account.openPositions} positions open, cap is ${config.maxOpenPositions}`,
      );
    }
    return allow;
  },

  function instrumentAllowlist({ config, intent }) {
    // Empty allowlist permits nothing. An engine that trades everything by
    // default because a list was never filled in is not acceptable.
    if (config.instrumentAllowlist.length === 0) {
      return deny("instrumentAllowlist", "No instruments are enabled");
    }
    if (!config.instrumentAllowlist.includes(intent.instrument)) {
      return deny("instrumentAllowlist", `${intent.instrument} is not enabled`);
    }
    return allow;
  },

  function patternEnabled({ config, intent }) {
    if (intent.patternId === null) {
      return deny("patternEnabled", "Order has no originating pattern");
    }
    if (!config.enabledPatternIds.includes(intent.patternId)) {
      return deny("patternEnabled", `Pattern ${intent.patternId} is not enabled`);
    }
    return allow;
  },

  function stopRequired({ intent }) {
    if (intent.stopPrice === null || !Number.isFinite(intent.stopPrice)) {
      return deny("stopRequired", "No stop price — every order must carry a stop");
    }
    // A stop on the wrong side of entry is not a stop; it would fill instantly
    // and, worse, produce a nonsensical R denominator.
    const long = intent.direction === "long";
    if (long && intent.stopPrice >= intent.entryPrice) {
      return deny("stopRequired", "Stop is at or above entry on a long");
    }
    if (!long && intent.stopPrice <= intent.entryPrice) {
      return deny("stopRequired", "Stop is at or below entry on a short");
    }
    return allow;
  },

  function sizing({ config, intent, account }) {
    if (!Number.isFinite(intent.units) || intent.units === 0) {
      return deny("sizing", "Units must be a non-zero number");
    }
    // Direction and unit sign must agree, or the order does the opposite of
    // what the signal intended.
    const long = intent.direction === "long";
    if (long !== intent.units > 0) {
      return deny("sizing", `Units sign does not match direction (${intent.direction})`);
    }
    if (!Number.isFinite(account.equity) || account.equity <= 0) {
      return deny("sizing", "Account equity is unknown");
    }

    const stopDistance = Math.abs(intent.entryPrice - intent.stopPrice!);
    if (!(stopDistance > 0)) return deny("sizing", "Stop distance is zero");

    // Risk implied by this order, in quote currency, versus the ceiling.
    const impliedRisk = stopDistance * Math.abs(intent.units);
    const maxRisk =
      account.equity * account.baseRiskFraction * config.maxRiskMultiple;

    if (!(maxRisk > 0)) return deny("sizing", "Risk ceiling resolves to zero");
    if (impliedRisk > maxRisk) {
      return deny(
        "sizing",
        `Order risks ${impliedRisk.toFixed(2)}, ceiling is ${maxRisk.toFixed(2)}`,
      );
    }
    return allow;
  },

  function rateLimit({ recentOrders, now }) {
    const cutoff = now.getTime() - RATE_LIMIT_WINDOW_MS;
    const recent = recentOrders.filter((o) => o.createdAt.getTime() > cutoff);
    if (recent.length >= RATE_LIMIT_MAX) {
      return deny(
        "rateLimit",
        `${recent.length} orders in the last ${RATE_LIMIT_WINDOW_MS / 1000}s`,
      );
    }
    return allow;
  },

  function duplicateOrder({ intent, recentOrders, now }) {
    const cutoff = now.getTime() - DUPLICATE_WINDOW_MS;
    const dupe = recentOrders.find(
      (o) =>
        o.createdAt.getTime() > cutoff &&
        o.instrument === intent.instrument &&
        o.direction === intent.direction,
    );
    if (dupe) {
      return deny(
        "duplicateOrder",
        `A ${intent.direction} ${intent.instrument} order was placed ` +
          `${Math.round((now.getTime() - dupe.createdAt.getTime()) / 1000)}s ago`,
      );
    }
    return allow;
  },
];

/** Guard names, in evaluation order — used by the UI and by tests. */
export const GUARD_NAMES = GUARDS.map((g) => g.name);
