import "server-only";
import { hub } from "@/lib/stream/hub";
import { describeCondition } from "@/lib/patterns/describe";
import type { Condition } from "@/lib/patterns/dsl";
import type { BarContext } from "@/lib/patterns/evaluate";
import type { EngineEvent, ScanCandidate, ScanCondition, ScanPush } from "@/lib/stream/events";

/**
 * Scan telemetry — what the engine considered, whether or not it acted.
 *
 * DELIBERATELY IN MEMORY, NOT IN THE DATABASE.
 *
 * The scheduler ticks every 60s across every armed book × instrument ×
 * pattern. Persisting that is thousands of rows a day describing, overwhelmingly,
 * nothing happening — and it would sit in the same database as
 * `transactions_raw`, which is meant to be the source of truth about things
 * that actually occurred. Near-misses are not events; they are the current
 * state of the scanner, and state is only interesting while it is current.
 *
 * The order log remains the durable record: anything the engine actually did,
 * including refusing to act, is still written there.
 */

/**
 * Candidates below this fraction of their conditions are dropped.
 *
 * Without a floor the hero fills with instruments that are nowhere near
 * triggering, and a list where everything is a candidate says as little as a
 * list where nothing is. Half is low enough to show a setup building and high
 * enough that appearing on it means something.
 */
const NEAR_MISS_FLOOR = 0.5;

/** Most candidates to broadcast, best-first. Beyond this the panel scrolls. */
const MAX_CANDIDATES = 12;

/**
 * Split a trigger into the conditions worth reporting separately.
 *
 * A top-level `all` is the common shape and decomposes naturally — each clause
 * is a thing that is or isn't true right now. Anything else (a bare `cmp`, an
 * `any`, a `not`) is reported as one indivisible condition rather than being
 * torn apart into pieces that don't mean anything on their own: "2 of 3" for an
 * `any` would be actively misleading, since one is enough.
 */
export function triggerClauses(trigger: Condition): Condition[] {
  return trigger.c === "all" ? trigger.of : [trigger];
}

/**
 * Evaluate each clause of a trigger at one bar.
 *
 * Uses the SAME BarContext the entry decision uses, so a clause reported as met
 * is met by the identical code path that would have fired the order. The
 * context memoises per condition, so this costs nothing beyond the evaluation
 * the engine was already doing.
 */
export function evaluateClauses(
  ctx: BarContext,
  trigger: Condition,
  at: number,
): ScanCondition[] {
  return triggerClauses(trigger).map((clause) => ({
    label: describeCondition(clause),
    met: ctx.evaluate(clause)[at] === true,
  }));
}

/* ==========================================================================
   COLLECTION
   ========================================================================== */

/**
 * Accumulates one tick's worth of observations, then publishes once.
 *
 * One push per tick rather than one per candidate: the browser gets a complete,
 * self-consistent picture of what the scanner saw, and cannot render a state
 * where half the instruments are from this tick and half from the last.
 */
export class ScanCollector {
  /**
   * One collector per MEMBER, not per tick.
   *
   * A tick sweeps every armed book on the platform, so a single collector would
   * mix members' candidates into one push and hand each of them everyone
   * else's setups. The user is taken at construction so a collector cannot
   * exist without knowing whose scan it describes.
   */
  constructor(readonly userId: number) {}

  private readonly started = Date.now();
  private readonly candidates: ScanCandidate[] = [];
  private readonly books = new Set<string>();
  private evaluated = 0;

  /** Record a book as having ticked, even if it evaluated nothing. */
  noteBook(book: string): void {
    this.books.add(book);
  }

  note(c: Omit<ScanCandidate, "met" | "total">): void {
    this.evaluated++;
    const met = c.conditions.filter((x) => x.met).length;
    const total = c.conditions.length;
    if (total === 0) return;

    // A blocked candidate is always worth showing regardless of score: the
    // engine wanted to trade and something stopped it, which is the single most
    // useful thing this panel can say.
    if (c.blockedBy === null && met / total < NEAR_MISS_FLOOR) return;

    this.candidates.push({ ...c, met, total });
  }

  /**
   * Publish. Called once per tick, including when nothing was armed — a tick
   * that found nothing still proves the loop is alive, which is the point.
   */
  publish(opts: { nextAt: number; marketOpen: boolean }): ScanPush {
    const ranked = [...this.candidates]
      .sort((a, b) => {
        // Blocked entries first — they are decisions, not near-misses.
        if ((a.blockedBy === null) !== (b.blockedBy === null)) {
          return a.blockedBy === null ? 1 : -1;
        }
        return b.met / b.total - a.met / a.total;
      })
      .slice(0, MAX_CANDIDATES);

    const push: ScanPush = {
      at: Date.now(),
      durationMs: Date.now() - this.started,
      nextAt: opts.nextAt,
      evaluated: this.evaluated,
      candidates: ranked,
      books: [...this.books],
      marketOpen: opts.marketOpen,
    };

    hub.publishScan(this.userId, push);
    return push;
  }
}

/**
 * Publish a tick that did no work — nothing armed, or the market closed.
 *
 * Separate from ScanCollector because there is no collector to build: the point
 * is purely to keep the heartbeat beating so the UI can distinguish "idle" from
 * "dead". `books: []` is what tells the panel which of the two it is.
 */
export function publishIdleScan(opts: {
  userId: number;
  nextAt: number;
  marketOpen: boolean;
}): void {
  hub.publishScan(opts.userId, {
    at: Date.now(),
    durationMs: 0,
    nextAt: opts.nextAt,
    evaluated: 0,
    candidates: [],
    books: [],
    marketOpen: opts.marketOpen,
  });
}

/* ==========================================================================
   ENGINE EVENTS
   ========================================================================== */

/**
 * Announce something the engine did.
 *
 * Fire-and-forget by design: an event that fails to reach a browser must never
 * affect whether an order was placed. The durable record is the order log.
 */
export function announce(userId: number, event: Omit<EngineEvent, "at">): void {
  try {
    hub.publishEngine(userId, { ...event, at: Date.now() });
  } catch {
    /* a broken subscriber must not reach back into the trading path */
  }
}
