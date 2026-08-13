import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  books as booksTable,
  executionState,
  orderLog,
  patterns as patternsTable,
  trades as tradesTable,
} from "@/lib/db/schema";
import { oanda } from "@/lib/oanda/client";
import { execution } from "@/lib/oanda/execution";
import { approveOrder, type ExecutionConfig, type OrderIntent, type RecentOrder } from "./guards";
import { nextAction, type ManagedPosition, type ManagementRules } from "./manage";
import { BOOK_IDS, type BookId } from "@/lib/books";
import { BarContext } from "@/lib/patterns/evaluate";
import { announce, evaluateClauses, ScanCollector } from "./telemetry";
import type { Condition, ManagementRule, StopRule, TargetRule } from "@/lib/patterns/dsl";
import type { Bar } from "@/lib/indicators";
import { DISPLAY_TZ, partsIn } from "@/lib/time";
import { RATE_LIMIT_WINDOW_MS } from "./guards";

/**
 * The autonomous engine.
 *
 * One tick does two things per armed book, in this order:
 *
 *   1. MANAGE open positions — breakeven, trail, scale-out, session flatten
 *   2. SCAN for new entries
 *
 * Management runs first on purpose. Protecting capital already at risk matters
 * more than deploying more of it, and if a tick is cut short by an error or a
 * rate limit, the half that ran is the half that reduces exposure.
 *
 * Nothing here decides WHETHER an order is allowed — that is entirely the
 * guards' job, and this module cannot submit anything without an approval they
 * mint. This file's responsibility is only to gather state, propose, and log.
 */

export type TickResult = {
  book: BookId;
  managed: number;
  scanned: number;
  submitted: number;
  rejected: number;
  errors: string[];
};

const SCAN_GRANULARITY = "M5";
const SCAN_BARS = 400;

export async function runTick(opts: TickOptions = {}): Promise<TickResult[]> {
  const results: TickResult[] = [];

  // Collected across every book so the browser receives one coherent picture of
  // the whole tick rather than a push per book.
  const scan = new ScanCollector();

  const states = await db
    .select()
    .from(executionState)
    .where(eq(executionState.state, "armed"));

  for (const state of states) {
    const result: TickResult = {
      book: state.book as BookId,
      managed: 0,
      scanned: 0,
      submitted: 0,
      rejected: 0,
      errors: [],
    };

    try {
      await runBook(state, result, scan);
    } catch (e) {
      // One book failing must never stop the others — particularly since the
      // others may have open positions that still need managing.
      result.errors.push((e as Error).message);
    }
    results.push(result);
  }

  // Published even when nothing is armed. A tick that found nothing still
  // proves the loop is alive, which is most of what this telemetry is for.
  scan.publish({
    nextAt: opts.nextTickAt ?? Date.now(),
    marketOpen: opts.marketOpen ?? true,
  });

  return results;
}

export type TickOptions = {
  /** When the next tick is due, so the UI can run an honest countdown. */
  nextTickAt?: number;
  marketOpen?: boolean;
};

type StateRow = typeof executionState.$inferSelect;

async function runBook(
  state: StateRow,
  result: TickResult,
  scan: ScanCollector,
): Promise<void> {
  const book = state.book as BookId;
  scan.noteBook(book);

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.book, book), eq(accounts.active, true)));
  if (!account) {
    result.errors.push(`No active account for ${book}`);
    return;
  }

  const [bookCfg] = await db.select().from(booksTable).where(eq(booksTable.id, book));

  const client = oanda(account.environment);
  const exec = execution(account.environment);
  const send = !state.dryRun;

  const summary = await client.accountSummary(account.id);
  const openTrades = await client.openTrades(account.id);

  /* ---- 1. Manage open positions --------------------------------------- */

  for (const t of openTrades) {
    const [stored] = await db
      .select()
      .from(tradesTable)
      .where(
        and(
          eq(tradesTable.accountId, account.id),
          eq(tradesTable.oandaTradeId, t.id),
        ),
      );

    // Only manage what the engine can reason about. A position with no known
    // opening stop has no R denominator, and guessing one would be inventing
    // the risk the trade was actually taken with.
    if (!stored?.plannedStop) continue;

    const patternId = await patternIdForTrade(account.id, t.id);
    const rules = patternId ? await managementRulesFor(patternId) : null;
    if (!rules) continue;

    const price = await currentPrice(client, account.id, t.instrument);
    if (price === null) continue;

    const position: ManagedPosition = {
      tradeId: t.id,
      instrument: t.instrument,
      direction: Number(t.currentUnits) >= 0 ? "long" : "short",
      currentUnits: Number(t.currentUnits),
      initialUnits: Number(t.initialUnits),
      entryPrice: Number(t.price),
      currentStop: t.stopLossOrder?.price ? Number(t.stopLossOrder.price) : null,
      initialStop: Number(stored.plannedStop),
      // Reconstructed from the ledger rather than tracked in memory, so a
      // restart cannot cause a second scale-out.
      scaledOut: Math.abs(Number(t.currentUnits)) < Math.abs(Number(t.initialUnits)),
      openedAt: new Date(t.openTime),
      horizon: stored.horizon,
    };

    const action = nextAction(position, rules, {
      price,
      // Without stored excursion data the current price is the honest floor for
      // "best reached". It makes trailing lag slightly rather than act on a
      // peak that may never have happened.
      bestPrice: price,
      londonHour: partsIn(new Date(), DISPLAY_TZ).hour,
      now: new Date(),
    });

    if (!action) continue;
    result.managed++;

    announce({
      kind: "managed",
      book,
      instrument: t.instrument,
      headline:
        action.kind === "flatten"
          ? `Flattening ${t.instrument}`
          : action.kind === "scaleOut"
            ? `Scaling out of ${t.instrument}`
            : `Stop moved on ${t.instrument}`,
      detail: action.reason,
      oandaTradeId: t.id,
      patternName: null,
      sent: send,
    });

    try {
      if (action.kind === "flatten") {
        const r = await exec.closeTrade(account.id, t.id, send);
        await logOrder({
          account,
          book,
          patternId,
          instrument: t.instrument,
          direction: position.direction,
          units: -position.currentUnits,
          outcome: send ? (r.ok ? "submitted" : "error") : "dry_run",
          reason: action.reason,
          result: r,
        });
      } else if (action.kind === "scaleOut") {
        // Partial closes reduce risk, so they take the same path as a flatten.
        const r = await exec.closeTrade(account.id, t.id, false);
        await logOrder({
          account,
          book,
          patternId,
          instrument: t.instrument,
          direction: position.direction,
          units: action.units,
          outcome: "dry_run",
          reason: `${action.reason} (partial close not yet implemented — logged only)`,
          result: r,
        });
      } else {
        const r = await exec.modifyStop(account.id, t.id, action.to, send, {
          direction: position.direction,
          currentStop: position.currentStop,
        });
        await logOrder({
          account,
          book,
          patternId,
          instrument: t.instrument,
          direction: position.direction,
          units: position.currentUnits,
          requestedStop: action.to,
          outcome: send ? (r.ok ? "submitted" : "error") : "dry_run",
          reason: action.reason,
          result: r,
        });
      }
    } catch (e) {
      result.errors.push(`manage ${t.id}: ${(e as Error).message}`);
    }
  }

  /* ---- 2. Scan for entries -------------------------------------------- */

  if (state.enabledPatternIds.length === 0) return;
  if (state.instrumentAllowlist.length === 0) return;

  const enabled = await db
    .select()
    .from(patternsTable)
    .where(inArray(patternsTable.id, state.enabledPatternIds));

  const dailyR = await todaysR(account.id);
  const recentOrders = await recentOrdersFor(account.id);

  const config: ExecutionConfig = {
    state: state.state as "armed",
    allowLiveCapital: state.allowLiveCapital,
    instrumentAllowlist: state.instrumentAllowlist,
    maxOpenPositions: state.maxOpenPositions,
    maxRiskMultiple: Number(state.maxRiskMultiple),
    enabledPatternIds: state.enabledPatternIds,
  };

  for (const instrument of state.instrumentAllowlist) {
    let bars: Bar[];
    try {
      bars = await fetchBars(client, instrument);
    } catch (e) {
      result.errors.push(`candles ${instrument}: ${(e as Error).message}`);
      continue;
    }
    if (bars.length < 100) continue;

    const ctx = new BarContext(bars);
    const last = bars.length - 1;

    for (const pattern of enabled) {
      result.scanned++;

      const trigger = (pattern.triggerRules as Condition[])[0];
      if (!trigger) continue;

      const cfgFilters = pattern.contextFilters as {
        direction?: "long" | "short";
        stop?: StopRule;
        targets?: TargetRule[];
      };
      const direction = cfgFilters.direction ?? "long";
      const entry = bars[last].c;

      /**
       * Clause-by-clause state, for the scan panel.
       *
       * Evaluated through the same memoised BarContext the entry decision uses,
       * so a clause reported as met is met by the identical code path that
       * would fire the order — the telemetry cannot drift from the behaviour.
       */
      const conditions = evaluateClauses(ctx, trigger, last);
      const candidate = {
        book,
        instrument,
        patternId: pattern.id,
        patternName: pattern.name,
        direction,
        conditions,
        barTime: bars[last].time,
      };

      const fired = ctx.evaluate(trigger);
      // Only the most recently CLOSED bar. Acting on a forming bar would be
      // reacting to a signal that can still disappear before the bar closes.
      if (!fired[last]) {
        scan.note({ ...candidate, blockedBy: null, blockedReason: null });
        continue;
      }

      const stopPrice = resolveStop(cfgFilters.stop, ctx, last, entry, direction);
      if (stopPrice === null) {
        // Fired, but the pattern's own stop rule produced nothing usable. Shown
        // as blocked rather than dropped: a pattern that triggers and can never
        // be sized is a definition bug worth seeing.
        scan.note({
          ...candidate,
          blockedBy: "stop",
          blockedReason: "Triggered, but the pattern's stop rule resolved to nothing",
        });
        continue;
      }

      const targetPrice = resolveTarget(
        cfgFilters.targets?.[0],
        ctx,
        last,
        entry,
        stopPrice,
        direction,
      );

      const units = sizeOrder({
        equity: Number(summary.NAV),
        baseRiskPct: Number(bookCfg?.baseRiskPct ?? 0.75),
        entry,
        stopPrice,
        direction,
      });

      const intent: OrderIntent = {
        book,
        accountId: account.id,
        environment: account.environment,
        instrument,
        direction,
        units,
        stopPrice,
        targetPrice,
        entryPrice: entry,
        patternId: pattern.id,
      };

      const approval = approveOrder({
        config,
        intent,
        account: {
          equity: Number(summary.NAV),
          openPositions: openTrades.length,
          dailyR,
          dailyLimitR: Number(bookCfg?.dailyLimitR ?? 3),
          baseRiskFraction: Number(bookCfg?.baseRiskPct ?? 0.75) / 100,
        },
        recentOrders,
        now: new Date(),
      });

      if (!approval.approved) {
        result.rejected++;
        scan.note({
          ...candidate,
          blockedBy: approval.guard,
          blockedReason: approval.reason,
        });
        await logOrder({
          account,
          book,
          patternId: pattern.id,
          instrument,
          direction,
          units,
          requestedStop: stopPrice,
          requestedTarget: targetPrice,
          outcome: "rejected_by_guard",
          rejectedBy: approval.guard,
          reason: approval.reason,
        });
        announce({
          kind: "rejected",
          book,
          instrument,
          headline: `${instrument} blocked by ${approval.guard}`,
          detail: approval.reason,
          oandaTradeId: null,
          patternName: pattern.name,
          sent: false,
        });
        continue;
      }

      // Approved and about to be sent — it belongs at the top of the panel as a
      // decision, not buried among the near-misses.
      scan.note({ ...candidate, blockedBy: null, blockedReason: null });

      try {
        const r = await exec.submitMarketOrder(approval.approval, send);
        result.submitted++;
        // Count it immediately so the rate and duplicate guards see it within
        // this same tick, not only on the next one.
        recentOrders.push({ instrument, direction, units, createdAt: new Date() });
        await logOrder({
          account,
          book,
          patternId: pattern.id,
          instrument,
          direction,
          units,
          requestedStop: stopPrice,
          requestedTarget: targetPrice,
          outcome: send ? (r.ok ? "submitted" : "broker_rejected") : "dry_run",
          reason: `${pattern.name} triggered`,
          result: r,
        });
        announce({
          kind: "fill",
          book,
          instrument,
          headline: send
            ? `${direction === "long" ? "Long" : "Short"} ${instrument}`
            : `Dry run: ${direction} ${instrument}`,
          detail:
            `${pattern.name} · ${Math.abs(units).toLocaleString()} units · ` +
            `stop ${stopPrice.toPrecision(6)}` +
            (targetPrice !== null ? ` · target ${targetPrice.toPrecision(6)}` : " · no target"),
          oandaTradeId: r.oandaTradeId,
          patternName: pattern.name,
          sent: send && r.ok,
        });
      } catch (e) {
        result.errors.push(`submit ${instrument}: ${(e as Error).message}`);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Position size from risk.
 *
 * Units are computed in QUOTE terms — the guards apply the account-currency
 * ceiling separately. Deliberately conservative: it floors rather than rounds,
 * so a rounding error can only ever make a position smaller.
 */
function sizeOrder(o: {
  equity: number;
  baseRiskPct: number;
  entry: number;
  stopPrice: number;
  direction: "long" | "short";
}): number {
  const distance = Math.abs(o.entry - o.stopPrice);
  if (!(distance > 0) || !(o.equity > 0)) return 0;
  const riskAmount = o.equity * (o.baseRiskPct / 100);
  const magnitude = Math.floor(riskAmount / distance);
  return o.direction === "long" ? magnitude : -magnitude;
}

function resolveStop(
  rule: StopRule | undefined,
  ctx: BarContext,
  i: number,
  entry: number,
  direction: "long" | "short",
): number | null {
  if (!rule) return null;
  const atr = ctx.series({ s: "atr", period: 14 })[i];

  if (rule.kind === "atr") {
    if (!Number.isFinite(atr)) return null;
    return direction === "long" ? entry - rule.multiple * atr : entry + rule.multiple * atr;
  }

  const base = ctx.series(rule.at)[i];
  if (!Number.isFinite(base)) return null;
  const buffer = (rule.bufferAtr ?? 0) * (Number.isFinite(atr) ? atr : 0);
  const stop = direction === "long" ? base - buffer : base + buffer;

  // A stop on the wrong side of entry is refused here as well as by the guard,
  // so a bad pattern definition produces no order rather than a log full of
  // rejections.
  if (direction === "long" && stop >= entry) return null;
  if (direction === "short" && stop <= entry) return null;
  return stop;
}

/**
 * Resolve the pattern's first target into a take-profit price.
 *
 * Only the FIRST target is attached to the order. Later targets are what the
 * management rules scale out into, and attaching them all would close the whole
 * position at the nearest one — the opposite of the intent.
 *
 * `timeStop` deliberately yields no price: "exit after N bars" is not a level,
 * and inventing one to satisfy the order payload would attach a take-profit the
 * pattern never asked for. Those patterns run stop-only and exit through the
 * management rules, which is what a time stop means.
 *
 * A target on the wrong side of entry is refused rather than sent. OANDA would
 * reject it anyway, but rejecting here means the order still goes out with its
 * stop attached instead of failing wholesale over the optional half.
 */
function resolveTarget(
  rule: TargetRule | undefined,
  ctx: BarContext,
  i: number,
  entry: number,
  stopPrice: number,
  direction: "long" | "short",
): number | null {
  if (!rule) return null;

  let target: number;
  if (rule.kind === "rMultiple") {
    const risk = Math.abs(entry - stopPrice);
    if (!(risk > 0)) return null;
    target = direction === "long" ? entry + rule.r * risk : entry - rule.r * risk;
  } else if (rule.kind === "series") {
    const value = ctx.series(rule.at)[i];
    if (!Number.isFinite(value)) return null;
    target = value;
  } else {
    return null;
  }

  if (direction === "long" && target <= entry) return null;
  if (direction === "short" && target >= entry) return null;
  return target;
}

async function fetchBars(
  client: ReturnType<typeof oanda>,
  instrument: string,
): Promise<Bar[]> {
  const res = await client.candles(instrument, {
    granularity: SCAN_GRANULARITY as never,
    count: SCAN_BARS,
    price: "M",
  });
  return (res.candles ?? [])
    .filter((c) => c.complete && c.mid)
    .map((c) => ({
      time: Date.parse(c.time),
      o: Number(c.mid!.o),
      h: Number(c.mid!.h),
      l: Number(c.mid!.l),
      c: Number(c.mid!.c),
      v: c.volume,
    }));
}

async function currentPrice(
  client: ReturnType<typeof oanda>,
  accountId: string,
  instrument: string,
): Promise<number | null> {
  try {
    const [p] = await client.pricing(accountId, [instrument]);
    if (!p) return null;
    const bid = Number(p.bids?.[0]?.price ?? p.closeoutBid);
    const ask = Number(p.asks?.[0]?.price ?? p.closeoutAsk);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
    return (bid + ask) / 2;
  } catch {
    return null;
  }
}

async function patternIdForTrade(
  accountId: string,
  oandaTradeId: string,
): Promise<number | null> {
  const rows = await db
    .select({ patternId: orderLog.patternId })
    .from(orderLog)
    .where(
      and(eq(orderLog.accountId, accountId), eq(orderLog.oandaTradeId, oandaTradeId)),
    )
    .limit(1);
  return rows[0]?.patternId ?? null;
}

async function managementRulesFor(patternId: number): Promise<ManagementRules | null> {
  const [p] = await db
    .select()
    .from(patternsTable)
    .where(eq(patternsTable.id, patternId));
  if (!p) return null;

  const ctx = p.contextFilters as { management?: ManagementRule | null };
  const m = ctx.management;
  if (!m) return null;

  return {
    breakevenAtR: m.breakevenAtR,
    scaleOutFraction: m.scaleOutFraction,
    // Patterns declare a scale-out fraction but not its trigger; 1R is the
    // conventional first target and is stated here rather than hidden.
    scaleOutAtR: m.scaleOutFraction !== undefined ? 1 : undefined,
    trailAtR: m.trailOn ? 1.5 : undefined,
    trailDistanceR: m.trailOn ? 1 : undefined,
    flattenAtHour: m.flattenAtHour,
  };
}

async function todaysR(accountId: string): Promise<number> {
  const p = partsIn(new Date(), DISPLAY_TZ);
  const dayStart = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const rows = await db
    .select({ r: tradesTable.rMultiple })
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.accountId, accountId),
        eq(tradesTable.state, "closed"),
        gte(tradesTable.exitTime, dayStart),
      ),
    );
  return rows.reduce((s, x) => s + (x.r ?? 0), 0);
}

async function recentOrdersFor(accountId: string): Promise<RecentOrder[]> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS * 2);
  const rows = await db
    .select()
    .from(orderLog)
    .where(and(eq(orderLog.accountId, accountId), gte(orderLog.createdAt, since)))
    .orderBy(desc(orderLog.createdAt))
    .limit(50);

  // Guard-rejected attempts are excluded: they never reached the broker, so
  // counting them would let a burst of rejections suppress a valid order.
  return rows
    .filter((r) => r.outcome !== "rejected_by_guard")
    .map((r) => ({
      instrument: r.instrument,
      direction: r.direction as "long" | "short",
      units: Number(r.units),
      createdAt: r.createdAt,
    }));
}

async function logOrder(o: {
  account: typeof accounts.$inferSelect;
  book: BookId;
  patternId: number | null;
  instrument: string;
  direction: "long" | "short";
  units: number;
  requestedStop?: number | null;
  requestedTarget?: number | null;
  outcome: typeof orderLog.$inferInsert.outcome;
  rejectedBy?: string;
  reason: string;
  result?: { request: Record<string, unknown>; response: Record<string, unknown> | null; oandaOrderId: string | null; oandaTradeId: string | null };
}): Promise<void> {
  await db.insert(orderLog).values({
    accountId: o.account.id,
    book: o.book,
    patternId: o.patternId,
    instrument: o.instrument,
    direction: o.direction,
    units: String(o.units),
    requestedStop: o.requestedStop != null ? String(o.requestedStop) : null,
    requestedTarget: o.requestedTarget != null ? String(o.requestedTarget) : null,
    outcome: o.outcome,
    rejectedBy: o.rejectedBy ?? null,
    reason: o.reason,
    oandaOrderId: o.result?.oandaOrderId ?? null,
    oandaTradeId: o.result?.oandaTradeId ?? null,
    request: o.result?.request ?? null,
    response: o.result?.response ?? null,
  });
}

/** Halt a book and record why. Used by the kill switch and the daily limit. */
export async function haltBook(book: BookId, reason: string): Promise<void> {
  await db
    .update(executionState)
    .set({ state: "halted", haltedReason: reason, updatedAt: new Date() })
    .where(eq(executionState.book, book));
}

/** Ensure every book has a row, all disarmed. Safe to call repeatedly. */
export async function ensureExecutionState(): Promise<void> {
  for (const book of BOOK_IDS) {
    await db.insert(executionState).values({ book }).onConflictDoNothing();
  }
}
