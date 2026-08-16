import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionState, trades as tradesTable } from "@/lib/db/schema";
import { hub } from "@/lib/stream/hub";
import { getDeskSnapshot } from "./snapshot";
import type { DeskPush, LiveBook, LivePosition } from "@/lib/stream/events";
import type { BookId } from "@/lib/books";

/**
 * Periodic desk broadcast.
 *
 * The browser marks positions to market off the tick stream so the gauge and
 * ribbons move continuously. That is an approximation: it cannot know financing
 * accrual, commission, or the exact conversion rate the broker will use. This
 * loop pushes the broker's own figures every few seconds and the browser snaps
 * to them.
 *
 * The division of labour is deliberate — MOTION comes from ticks, TRUTH comes
 * from here. Neither alone is acceptable: ticks alone drift silently, and
 * pushes alone produce a dashboard that steps every five seconds and reads as
 * broken.
 */

/**
 * Five seconds. The snapshot makes two broker calls per book, so this is
 * roughly 1.6 calls/second against a 100/second allowance — comfortable, and
 * far below the rate at which the drift it corrects becomes material.
 */
const BROADCAST_INTERVAL_MS = 5_000;

/** Back off to this while no browser is listening. */
const IDLE_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let consecutiveErrors = 0;

/**
 * Last good conversion factor per trade.
 *
 * `snapshot.ts` calibrates `unitValue` only when the position has moved far
 * enough that rounding in the broker's P&L cannot dominate the ratio, and
 * reports null otherwise. That is the right call for a single reading, but it
 * means a position sitting near entry would never stream — and the factor is
 * `units × FX conversion`, which changes only as slowly as the cross rate does.
 * So a calibration from a minute ago is a far better estimate than refusing to
 * move. Cleared when the trade closes.
 */
const plPerPriceMemo = new Map<string, number>();

/**
 * Account-currency P&L per unit of price movement, for the browser to
 * extrapolate with between pushes.
 *
 * `unitValue` is per-unit; multiplying by the position's units gives the figure
 * the browser wants. Never assumed — for a GBP account trading USD_JPY there is
 * a conversion in here that only OANDA gets right, and inventing one would put
 * a plausible-looking wrong number on the hero.
 */
function plPerPriceFor(p: {
  oandaTradeId: string;
  unitValue: number | null;
  units: number;
}): number | null {
  if (p.unitValue !== null && Number.isFinite(p.unitValue)) {
    const perPrice = p.unitValue * p.units;
    if (perPrice !== 0) {
      plPerPriceMemo.set(p.oandaTradeId, perPrice);
      return perPrice;
    }
  }
  return plPerPriceMemo.get(p.oandaTradeId) ?? null;
}

async function buildPush(userId: number): Promise<DeskPush> {
  const [snapshot, execRows] = await Promise.all([
    getDeskSnapshot(userId),
    db.select().from(executionState).where(eq(executionState.userId, userId)),
  ]);

  const execByBook = new Map(execRows.map((r) => [r.book as BookId, r]));

  const books: LiveBook[] = await Promise.all(
    snapshot.books.map(async (b): Promise<LiveBook> => {
      const exec = execByBook.get(b.book);

      // Stored rows carry the ORIGINAL stop and target — the broker only knows
      // where the stop is now, which is not the R denominator.
      const stored = b.accountId
        ? await db
            .select()
            .from(tradesTable)
            .where(eq(tradesTable.accountId, b.accountId))
            .then((rows) => rows.filter((r) => r.state === "open"))
        : [];

      const positions: LivePosition[] = b.openPositions.map((p) => {
        const row = stored.find((r) => r.oandaTradeId === p.oandaTradeId);
        const initialStop = row?.plannedStop ? Number(row.plannedStop) : null;
        const riskDistance =
          initialStop !== null ? Math.abs(p.entryPrice - initialStop) : null;

        const plPerPrice = plPerPriceFor(p);

        return {
          oandaTradeId: p.oandaTradeId,
          book: b.book,
          instrument: p.instrument,
          direction: p.direction,
          units: p.units,
          entryPrice: p.entryPrice,
          currentStop: p.currentStop,
          currentTarget: row?.plannedTarget ? Number(row.plannedTarget) : null,
          unrealizedPl: p.unrealizedPl,
          /**
           * The price the broker's P&L was computed against. Falling back to
           * entry keeps `markToMarket` self-consistent: paired with a zero
           * factor the extrapolation term vanishes, so the row simply holds the
           * broker's figure rather than drifting from a wrong reference.
           */
          markPrice: p.currentPrice ?? p.entryPrice,
          plPerPrice: plPerPrice ?? 0,
          riskR: p.riskR,
          riskDistance,
          openedAt: row?.entryTime ? row.entryTime.getTime() : Date.now(),
        };
      });

      return {
        book: b.book,
        currency: b.currency,
        live: b.live,
        equity: b.equity,
        balance: b.balance,
        marginUsed: b.marginUsed,
        marginAvailable: b.marginAvailable,
        unrealizedPl: b.unrealizedPl,
        todayPl: b.todayPl,
        todayR: b.todayR,
        todayTrades: b.todayTrades,
        openRiskR: b.openRiskR,
        openRiskUnbounded: b.openRiskUnbounded,
        dailyLimitR: b.dailyLimitR,
        positions,
        armState: (exec?.state ?? "disarmed") as LiveBook["armState"],
        dryRun: exec?.dryRun ?? true,
      };
    }),
  );

  return { at: Date.now(), books, degraded: snapshot.degraded };
}

/**
 * Keep the price stream subscribed to everything currently on screen.
 *
 * A position in an instrument outside the watchlist would otherwise never
 * receive a tick, so its row and its ribbon would sit motionless while
 * everything around them moved — the exact failure this feature exists to fix.
 */
function syncInstruments(pushes: DeskPush[]): void {
  const held = pushes.flatMap((push) =>
    push.books.flatMap((b) => b.positions.map((p) => p.instrument)),
  );
  hub.setInstruments(held);
}

/** Forget conversion factors for trades that are no longer open. */
function pruneMemo(pushes: DeskPush[]): void {
  const open = new Set(
    pushes.flatMap((push) =>
      push.books.flatMap((b) => b.positions.map((p) => p.oandaTradeId)),
    ),
  );
  for (const id of plPerPriceMemo.keys()) {
    if (!open.has(id)) plPerPriceMemo.delete(id);
  }
}

/**
 * Build and push one snapshot PER WATCHED MEMBER.
 *
 * Only members with a browser actually connected are built. Iterating every
 * user on the platform would make the broker call count grow with signups to
 * produce snapshots nobody is looking at — and the hub already knows exactly
 * who is listening.
 */
async function broadcast(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const watched = hub.watchedUserIds;
    if (watched.length === 0) return;

    const pushes: DeskPush[] = [];
    for (const userId of watched) {
      const push = await buildPush(userId);
      hub.publishDesk(userId, push);
      pushes.push(push);
    }

    // Instruments and the memo span every member: one pricing stream serves
    // them all, and it must carry every held instrument regardless of whose.
    syncInstruments(pushes);
    pruneMemo(pushes);
    consecutiveErrors = 0;
  } catch (e) {
    consecutiveErrors++;
    // Only complain the first time. A broker outage lasting an hour would
    // otherwise write 720 identical lines and bury anything else.
    if (consecutiveErrors === 1) {
      console.error("[desk] broadcast failed:", (e as Error).message);
    }
  } finally {
    inFlight = false;
  }
}

function schedule(): void {
  // No listeners, no reason to poll the broker at speed. The next connecting
  // browser gets a fresh push immediately via `broadcastNow`.
  const delay = hub.hasSubscribers ? BROADCAST_INTERVAL_MS : IDLE_INTERVAL_MS;
  timer = setTimeout(() => {
    void broadcast().finally(schedule);
  }, delay);
  timer.unref?.();
}

export function startDeskBroadcast(): void {
  if (timer) return;
  void broadcast();
  schedule();
  console.log(
    `[desk] broadcasting every ${BROADCAST_INTERVAL_MS / 1000}s while watched`,
  );
}

export function stopDeskBroadcast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Force a push now — used when a browser connects, and after any engine act. */
export async function broadcastNow(): Promise<void> {
  await broadcast();
}
