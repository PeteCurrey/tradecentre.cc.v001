import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, books as booksTable, trades } from "@/lib/db/schema";
import { oanda } from "@/lib/oanda/client";
import { BOOKS, type BookId } from "@/lib/books";
import { DISPLAY_TZ, partsIn } from "@/lib/time";

/**
 * The Live Desk snapshot.
 *
 * Fetched server-side for every book at once, so switching scope in the UI is
 * instant and does not refetch. Broker failures degrade to database values
 * rather than throwing — a dashboard that goes blank because one endpoint is
 * slow is worse than one showing a stale marker.
 */

export type OpenPosition = {
  oandaTradeId: string;
  instrument: string;
  direction: "long" | "short";
  units: number;
  entryPrice: number;
  currentStop: number | null;
  unrealizedPl: number;
  /**
   * Risk still on the table, in R. Zero once the stop is at or past entry.
   * NULL when it cannot be computed — no stop, or no recorded opening stop —
   * which means the loss is unbounded, not that it is small.
   */
  riskR: number | null;
  /** The broker's mid at snapshot time, when pricing was reachable. */
  currentPrice: number | null;
  /**
   * Account-currency value of a one-unit, one-price-point move.
   *
   * CALIBRATED from two figures the broker reported together — its own
   * unrealised P&L and its own current price — rather than derived from a
   * conversion table we would have to keep correct. Null when the position is
   * too close to flat for the division to be meaningful, in which case the
   * screen shows the broker's P&L and does not attempt to stream it.
   */
  unitValue: number | null;
};

export type BookSnapshot = {
  book: BookId;
  accountId: string | null;
  currency: string;
  /** True when these figures came from the broker rather than the database. */
  live: boolean;

  equity: number | null;
  balance: number | null;
  marginUsed: number | null;
  marginAvailable: number | null;
  unrealizedPl: number;

  openPositions: OpenPosition[];
  /** Sum over positions whose risk IS computable. */
  openRiskR: number;
  /** Positions with no computable risk. openRiskR excludes these entirely. */
  openRiskUnbounded: number;

  todayPl: number;
  todayR: number;
  todayTrades: number;

  dailyLimitR: number;
  baseRiskPct: number;
};

export type DeskSnapshot = {
  books: BookSnapshot[];
  fetchedAt: string;
  /** Books whose broker call failed, so the UI can say so honestly. */
  degraded: BookId[];
};

/** Start of the current London day, as an absolute instant. */
function londonDayStart(now = new Date()): Date {
  const p = partsIn(now, DISPLAY_TZ);
  // Walk back from the UTC-equivalent midnight until the London date matches.
  for (let offset = 0; offset <= 2; offset++) {
    const candidate = new Date(Date.UTC(p.year, p.month - 1, p.day, offset, 0, 0));
    const c = partsIn(candidate, DISPLAY_TZ);
    if (c.day === p.day && c.hour === 0) return candidate;
  }
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/**
 * @param userId  whose desk. Required — there is no "the" desk any more, and a
 *                default here would silently mean "whoever's accounts turn up
 *                first", which is the bug this parameter exists to prevent.
 */
export async function getDeskSnapshot(userId: number): Promise<DeskSnapshot> {
  const dayStart = londonDayStart();
  const degraded: BookId[] = [];

  const [accountRows, bookRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)),
    db.select().from(booksTable),
  ]);

  const bookConfig = new Map(bookRows.map((b) => [b.id as BookId, b]));

  const snapshots = await Promise.all(
    (Object.keys(BOOKS) as BookId[]).map(async (book): Promise<BookSnapshot> => {
      const cfg = bookConfig.get(book);
      const dailyLimitR = Number(cfg?.dailyLimitR ?? 3);
      const baseRiskPct = Number(cfg?.baseRiskPct ?? 0.75);

      // Live books only — demo never appears on this screen.
      const account = accountRows.find(
        (a) => a.book === book && a.environment === "live" && a.active,
      ) ?? accountRows.find((a) => a.book === book && a.active);

      const base: BookSnapshot = {
        book,
        accountId: account?.id ?? null,
        currency: account?.currency ?? "GBP",
        live: false,
        equity: null,
        balance: null,
        marginUsed: null,
        marginAvailable: null,
        unrealizedPl: 0,
        openPositions: [],
        openRiskR: 0,
        openRiskUnbounded: 0,
        todayPl: 0,
        todayR: 0,
        todayTrades: 0,
        dailyLimitR,
        baseRiskPct,
      };

      if (!account) return base;

      // Today's realised result, from derived trades in the database.
      const closedToday = await db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.accountId, account.id),
            eq(trades.state, "closed"),
            gte(trades.exitTime, dayStart),
          ),
        );

      base.todayPl = closedToday.reduce((s, t) => s + Number(t.realizedPl ?? 0), 0);
      base.todayR = closedToday.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
      base.todayTrades = closedToday.length;

      // Stored open trades give us each position's ORIGINAL risk, which is what
      // R is denominated in. The broker gives the current stop.
      const openRows = await db
        .select()
        .from(trades)
        .where(and(eq(trades.accountId, account.id), eq(trades.state, "open")));

      try {
        const [summary, openTrades] = await Promise.all([
          oanda(account.environment).accountSummary(account.id),
          oanda(account.environment).openTrades(account.id),
        ]);

        base.live = true;
        base.equity = Number(summary.NAV);
        base.balance = Number(summary.balance);
        base.marginUsed = Number(summary.marginUsed);
        base.marginAvailable = Number(summary.marginAvailable);
        base.unrealizedPl = Number(summary.unrealizedPL);

        // One pricing call for every instrument on, so the table can show a
        // "now" price beside each entry without a call per position.
        const instruments = [...new Set(openTrades.map((t) => t.instrument))];
        const priceByInstrument = new Map<string, number>();
        if (instruments.length > 0) {
          try {
            for (const p of await oanda(account.environment).pricing(
              account.id,
              instruments,
            )) {
              const bid = Number(p.bids?.[0]?.price ?? p.closeoutBid);
              const ask = Number(p.asks?.[0]?.price ?? p.closeoutAsk);
              if (Number.isFinite(bid) && Number.isFinite(ask)) {
                priceByInstrument.set(p.instrument, (bid + ask) / 2);
              }
            }
          } catch {
            // Prices are a nicety here; positions still render without them.
          }
        }

        base.openPositions = openTrades.map((t) => {
          const stored = openRows.find((r) => r.oandaTradeId === t.id);
          const entry = Number(t.price);
          const currentStop = t.stopLossOrder?.price ? Number(t.stopLossOrder.price) : null;
          const initialStop = stored?.plannedStop ? Number(stored.plannedStop) : null;

          /**
           * Remaining risk relative to the ORIGINAL risk — or null when it
           * cannot be computed at all.
           *
           * Null matters more than the arithmetic. This used to score a
           * position with no stop as exactly 1R, which reads as a bounded,
           * known risk when the truth is that the loss is unbounded. Ten
           * unstopped positions then summed to a confident "OPEN RISK 10.00R"
           * on the landing screen while the positions table called the same
           * ten "unbounded" — the same fact, two answers, and the reassuring
           * one on the hero.
           *
           * A stop with no recorded opening stop is null for the same reason:
           * there is no denominator, so any R figure would be invented. A stop
           * moved to breakeven is a real 0.00R and stays a number.
           */
          let riskR: number | null = null;
          if (currentStop !== null && initialStop !== null) {
            const originalDistance = Math.abs(entry - initialStop);
            const currentDistance =
              Number(t.currentUnits) >= 0
                ? Math.max(0, entry - currentStop)
                : Math.max(0, currentStop - entry);
            riskR = originalDistance > 0 ? currentDistance / originalDistance : 0;
          }

          const units = Number(t.currentUnits);
          const unrealizedPl = Number(t.unrealizedPL);
          const currentPrice = priceByInstrument.get(t.instrument) ?? null;

          // Only calibrate when the move is big enough that rounding in the
          // broker's P&L cannot dominate the ratio.
          const move = currentPrice === null ? 0 : (currentPrice - entry) * units;
          const unitValue =
            Math.abs(move) > 1e-6 && Number.isFinite(unrealizedPl)
              ? unrealizedPl / move
              : null;

          return {
            oandaTradeId: t.id,
            instrument: t.instrument,
            direction: units >= 0 ? "long" : "short",
            units,
            entryPrice: entry,
            currentStop,
            unrealizedPl,
            riskR,
            currentPrice,
            unitValue,
          };
        });
      } catch {
        // Broker unreachable or account not permitted by this token. Keep the
        // database-derived figures and flag the book as degraded.
        degraded.push(book);
        base.openPositions = openRows.map((r) => ({
          oandaTradeId: r.oandaTradeId,
          instrument: r.instrument,
          direction: r.direction as "long" | "short",
          units: Number(r.units),
          entryPrice: Number(r.entryPrice),
          currentStop: r.plannedStop ? Number(r.plannedStop) : null,
          unrealizedPl: 0,
          riskR: r.plannedStop ? 0 : null,
          currentPrice: null,
          unitValue: null,
        }));
      }

      base.openRiskR = base.openPositions.reduce((s, p) => s + (p.riskR ?? 0), 0);
      base.openRiskUnbounded = base.openPositions.filter((p) => p.riskR === null).length;
      return base;
    }),
  );

  return {
    books: snapshots,
    fetchedAt: new Date().toISOString(),
    degraded,
  };
}
