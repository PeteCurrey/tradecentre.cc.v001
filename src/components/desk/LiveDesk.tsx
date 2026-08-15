"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Activity, AlertTriangle, Crosshair, Layers, Percent, Wallet } from "lucide-react";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { RiskFlow, type BookRisk } from "@/components/ui/RiskFlow";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { MasterArm } from "@/components/execution/MasterArm";
import { ScanPanel } from "@/components/execution/ScanPanel";
import { useArmLevel, useLive, useScope } from "@/components/AppShell";
import { useChangeDirection } from "@/lib/stream/useAnimatedValue";
import {
  markToMarket,
  positionProgress,
  type LiveBook,
  type LivePosition,
} from "@/lib/stream/events";
import { BOOKS, booksInScope, isDemo, scopeLabel, type BookId } from "@/lib/books";
import type { DeskSnapshot } from "@/lib/desk/snapshot";
import { formatTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

/**
 * The Live Desk.
 *
 * Receives a server-rendered snapshot so the first paint is complete and
 * correct, then hands over to the stream. The two sources are reconciled in
 * `useDeskBooks` below rather than by rendering the snapshot until the stream
 * arrives — a swap would flash different numbers a second after load.
 */
export function LiveDesk({
  snapshot,
  wire,
}: {
  snapshot: DeskSnapshot;
  /**
   * The Wire panel, rendered on the server and passed in as a slot.
   *
   * It reads the database, so it cannot live inside this client component —
   * and passing it as a node rather than lifting the whole desk to the server
   * keeps the live P&L exactly as it is.
   */
  wire?: ReactNode;
}) {
  const { scope } = useScope();
  const { desk, ticks, scan, state } = useLive();
  const armLevel = useArmLevel();

  const inScope = new Set<BookId>(booksInScope(scope));

  /**
   * Books, marked to market.
   *
   * The desk push is the truth; ticks move it between pushes. Falling back to
   * the server snapshot means this renders identically before the first push,
   * so there is no blank frame and no visible handover.
   */
  const shown = useDeskBooks({ desk, snapshot, ticks, inScope });

  // Aggregate across the books in scope. Demo never aggregates with live —
  // booksInScope resolves a demo scope to exactly one book.
  const todayR = shown.reduce((s, b) => s + b.todayR, 0);
  const todayPl = shown.reduce((s, b) => s + b.todayPl, 0);
  const todayTrades = shown.reduce((s, b) => s + b.todayTrades, 0);
  const openRiskR = shown.reduce((s, b) => s + b.openRiskR, 0);
  /**
   * Positions whose risk cannot be computed at all.
   *
   * Kept separate from the total rather than folded into it. Summing them in
   * as 1R each produced a confident "10.00R" while the positions table called
   * the same ten unbounded — and the hero is the screen you glance at, so the
   * reassuring number was the one on display.
   */
  const openRiskUnbounded = shown.reduce((s, b) => s + b.openRiskUnbounded, 0);
  const unrealized = shown.reduce((s, b) => s + b.unrealizedPl, 0);
  const positions = shown.flatMap((b) => b.positions);

  const anyLive = shown.some((b) => b.equity !== null);
  const equity = anyLive
    ? shown.reduce((s, b) => s + (b.equity ?? 0), 0)
    : null;
  const balance = anyLive ? shown.reduce((s, b) => s + (b.balance ?? 0), 0) : null;
  const marginUsed = anyLive ? shown.reduce((s, b) => s + (b.marginUsed ?? 0), 0) : null;
  const marginAvail = anyLive
    ? shown.reduce((s, b) => s + (b.marginAvailable ?? 0), 0)
    : null;

  // Aggregate limit is the sum across books in scope — each book has its own.
  const limitR = shown.reduce((s, b) => s + b.dailyLimitR, 0) || 3;
  const currency = shown[0]?.currency ?? "GBP";

  /**
   * Today's R, including what open positions are currently worth.
   *
   * The gauge measures the day against the daily limit, and a position running
   * 2R against you counts toward that limit whether or not it has closed. A
   * gauge that only moved on closed trades would sit still through exactly the
   * session where you most need it to move.
   */
  const openR = positions.reduce((s, p) => s + p.unrealizedR, 0);
  const liveTodayR = todayR + openR;

  const flow: BookRisk[] = shown.map((b) => ({
    bookId: b.book,
    label: BOOKS[b.book as BookId].label,
    colorVar: BOOKS[b.book as BookId].colorVar,
    riskR: b.openRiskR,
    unbounded: b.openRiskUnbounded,
    positions: b.positions.length,
    unrealizedPl: b.unrealizedPl,
    armed: b.armState === "armed",
  }));

  const degradedInScope = (desk?.degraded ?? snapshot.degraded).filter((b) =>
    inScope.has(b as BookId),
  );

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={`${scopeLabel(scope)} · ${todayTrades} ${todayTrades === 1 ? "trade" : "trades"} closed today`}
        action={
          <span className="label-faint">
            as of {formatTime(new Date(snapshot.fetchedAt))}
          </span>
        }
      />

      {degradedInScope.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          <p className="text-xs text-[var(--color-warn)]">
            Showing stored data for{" "}
            {degradedInScope.map((b) => BOOKS[b as BookId].label).join(", ")} — the broker could not
            be reached. Balances and open P&amp;L may be out of date.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card hero className="overflow-hidden p-5">
          <CardHeader
            title="Open risk"
            action={
              isDemo(scope) ? (
                <span className="label-faint text-[var(--color-warn)]">practice</span>
              ) : null
            }
          />

          <MasterArm className="mt-2" />

          <div className="mt-4 flex flex-wrap items-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <RadialGauge
                value={liveTodayR}
                limit={limitR}
                size={220}
                live={positions.length > 0 && state === "live"}
                sublabel={
                  openR !== 0
                    ? `${todayR.toFixed(2)} closed · ${openR > 0 ? "+" : ""}${openR.toFixed(2)} open`
                    : `Limit −${limitR.toFixed(1)}R`
                }
              />
              <div className="text-center">
                <div className="label-faint">Cash P&amp;L today</div>
                {/* Closed plus open, flashing on change. Green/red is correct
                    here by the colour rule: this is money. */}
                <FlashingMoney
                  value={todayPl + unrealized}
                  currency={currency}
                  className="text-2xl"
                />
                {unrealized !== 0 && (
                  <div className="label-faint mt-0.5">
                    incl. {unrealized > 0 ? "+" : ""}
                    {unrealized.toFixed(2)} open
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <RiskFlow books={flow} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Closed"
              value={<span className="figure">{todayTrades}</span>}
              icon={<Activity className="size-3.5" />}
            />
            <StatTile
              label="Open"
              value={<span className="figure">{positions.length}</span>}
              icon={<Wallet className="size-3.5" />}
            />
            <StatTile
              label="Risk on"
              value={
                openRiskUnbounded > 0 && openRiskR === 0 ? (
                  <span className="figure text-[var(--color-warn)]">unbounded</span>
                ) : (
                  <span
                    className={clsx(
                      "figure",
                      openRiskR > 0
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-ink-faint)]",
                    )}
                  >
                    {openRiskR.toFixed(2)}R
                  </span>
                )
              }
              sub={
                openRiskUnbounded > 0 ? (
                  <span className="text-[var(--color-warn)]">
                    {openRiskUnbounded} unstopped, not counted
                  </span>
                ) : undefined
              }
              icon={<Crosshair className="size-3.5" />}
            />
            <StatTile
              label="Unrealised"
              value={<FlashingMoney value={unrealized} currency={currency} />}
              icon={<Percent className="size-3.5" />}
            />
            <StatTile
              label="Rope left"
              value={
                <span
                  className={clsx(
                    "figure",
                    // Warn, not red: this is a risk state, and red is money.
                    limitR + Math.min(0, liveTodayR) < limitR * 0.34
                      ? "text-[var(--color-warn)]"
                      : undefined,
                  )}
                >
                  {Math.max(0, limitR + Math.min(0, liveTodayR)).toFixed(2)}R
                </span>
              }
              sub="before daily limit"
              icon={<Layers className="size-3.5" />}
            />
            <StatTile
              label="Books"
              value={<span className="figure">{shown.length}</span>}
            />
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Account" />
          <div className="mt-3 space-y-2.5">
            <StatTile
              label="Equity"
              value={
                equity !== null ? (
                  <span className="figure">
                    {equity.toLocaleString("en-GB", {
                      style: "currency",
                      currency,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <StatTile
              label="Balance"
              value={
                balance !== null ? (
                  <span className="figure">
                    {balance.toLocaleString("en-GB", {
                      style: "currency",
                      currency,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <StatTile
              label="Margin used"
              value={marginUsed !== null ? <span className="figure">{marginUsed.toFixed(2)}</span> : "—"}
            />
            <StatTile
              label="Margin available"
              value={marginAvail !== null ? <span className="figure">{marginAvail.toFixed(2)}</span> : "—"}
            />
          </div>

          {/* The engine's view, directly under the account it would trade.
              Armed and flat is the normal case, so this is where the screen
              proves it is working rather than merely idle. */}
          <div className="mt-4 border-t border-[var(--color-line)] pt-3">
            <CardHeader
              title="Scanner"
              action={
                armLevel !== "off" ? (
                  <span className="label-faint text-[var(--color-accent)]">armed</span>
                ) : null
              }
            />
            <ScanPanel scan={scan} armed={armLevel === "armed" || armLevel === "live"} />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <CardHeader
            title="Open positions"
            action={
              <Link href="/positions" className="label-faint hover:text-[var(--color-ink-dim)]">
                View all
              </Link>
            }
          />
          {positions.length === 0 ? (
            <p className="mt-6 pb-4 text-center text-sm text-[var(--color-ink-mute)]">
              Flat. No positions open in {scopeLabel(scope)}.
            </p>
          ) : (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="label-faint">
                  <th className="pb-1 text-left font-semibold">Instrument</th>
                  <th className="pb-1 text-left font-semibold">Book</th>
                  <th className="pb-1 text-right font-semibold">Units</th>
                  <th className="pb-1 text-right font-semibold">In</th>
                  <th className="pb-1 text-right font-semibold">Now</th>
                  <th className="pb-1 text-right font-semibold">R</th>
                  <th className="pb-1 text-right font-semibold">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <PositionRow key={p.oandaTradeId} position={p} currency={currency} />
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <LivePrices />
        </div>
      </div>

      {/* The wire runs full width BELOW the account and positions, not beside
          them. What you own still comes first on this screen — the earlier
          column placement was chosen to protect that — but at column width the
          headlines wrapped to three lines each and the artwork had nowhere to
          go. Full width buys a scannable line length; keeping it last preserves
          the ordering that mattered. */}
      {wire && <div className="mt-4">{wire}</div>}
    </>
  );
}

/* ==========================================================================
   LIVE PRIMITIVES
   ========================================================================== */

/**
 * A money figure that flashes its own colour when it changes.
 *
 * The flash class must be removed between changes or the animation only ever
 * plays once — `useChangeDirection` returns null after the hold, which is what
 * makes it re-trigger on the next move.
 */
function FlashingMoney({
  value,
  currency,
  className,
}: {
  value: number;
  currency: string;
  className?: string;
}) {
  const dir = useChangeDirection(value);
  return (
    <span
      className={clsx(
        "inline-block rounded px-1",
        dir === "up" && "flash-up",
        dir === "down" && "flash-down",
      )}
    >
      <Money value={value} currency={currency} className={className} />
    </span>
  );
}

function PositionRow({
  position: p,
  currency,
}: {
  position: MarkedPosition;
  currency: string;
}) {
  const dir = useChangeDirection(p.livePl);
  const book = BOOKS[p.book as BookId];

  /**
   * Distance to the stop as a fraction of the original risk. Drives a small
   * bar showing where price sits between stop and target — the thing you
   * actually want to know at a glance about an open position.
   */
  const toStop =
    p.price !== null && p.currentStop !== null && p.riskDistance
      ? (p.direction === "long" ? p.price - p.currentStop : p.currentStop - p.price) /
        p.riskDistance
      : null;

  return (
    <tr className="border-t border-[var(--color-line)]/60">
      <td className="py-2 font-medium">
        <span className="flex items-center gap-1.5">
          {p.instrument}
          {p.price !== null && (
            <span className="live-dot" title="Streaming" />
          )}
        </span>
      </td>
      <td className="py-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-1.5 rounded-full"
            style={{ background: book?.colorVar }}
          />
          <span className="text-[var(--color-ink-dim)]">{book?.label ?? p.book}</span>
        </span>
      </td>
      <td className="py-2 text-right figure text-[var(--color-ink-dim)]">
        {p.units.toLocaleString()}
      </td>
      <td className="py-2 text-right figure">{p.entryPrice}</td>
      <td className="py-2 text-right figure text-[var(--color-ink-dim)]">
        {/* Em dash rather than the entry price when no tick has arrived: showing
            entry as "now" would silently claim the position hasn't moved. */}
        {p.price !== null ? p.price.toPrecision(6) : "—"}
      </td>
      <td className="py-2 text-right">
        {/* Null means no stop, or no recorded opening stop — the loss is
            unbounded. Printing a number here would make it look bounded. */}
        {p.riskR === null ? (
          <span className="text-[var(--color-warn)]">unbounded</span>
        ) : (
          <span className="figure text-[var(--color-accent)]">{p.riskR.toFixed(2)}R</span>
        )}
        {toStop !== null && (
          <span className="ml-1 text-[10px] text-[var(--color-ink-faint)]">
            {toStop >= 0 ? `${toStop.toFixed(1)} to stop` : "past stop"}
          </span>
        )}
      </td>
      <td
        className={clsx(
          "rounded py-2 text-right",
          dir === "up" && "flash-up",
          dir === "down" && "flash-down",
        )}
      >
        <Money value={p.livePl} currency={currency} />
      </td>
    </tr>
  );
}

/* ==========================================================================
   RECONCILIATION
   ========================================================================== */

type MarkedPosition = LivePosition & {
  /** P&L extrapolated to the latest tick. */
  livePl: number;
  /**
   * Unrealised result in R at the live price — how far this has travelled from
   * entry, in units of the risk it was taken with.
   *
   * DISTINCT FROM `riskR`, and the distinction matters. `riskR` is EXPOSURE:
   * how much of the original 1R would still be lost if the stop were hit, which
   * changes only when the stop moves. This is PROGRESS, which changes on every
   * tick. Conflating them would make a winning position look like a shrinking
   * risk, when in fact the amount at stake is whatever the stop says it is.
   */
  unrealizedR: number;
  /** Latest mid, or null when no tick has arrived for this instrument. */
  price: number | null;
};

type MarkedBook = Omit<LiveBook, "positions"> & { positions: MarkedPosition[] };

/**
 * Merge the three sources into one set of books.
 *
 *   server snapshot — complete and correct at first paint
 *   desk push       — the broker's own figures, every few seconds
 *   ticks           — motion between pushes
 *
 * Order matters: a push always replaces the snapshot wholesale (never merges,
 * or a closed position would linger), and ticks only ever adjust a pushed
 * figure — they never invent one.
 */
function useDeskBooks({
  desk,
  snapshot,
  ticks,
  inScope,
}: {
  desk: ReturnType<typeof useLive>["desk"];
  snapshot: DeskSnapshot;
  ticks: Map<string, { mid: number }>;
  inScope: Set<BookId>;
}): MarkedBook[] {
  return useMemo(() => {
    // Before the first push, present the server snapshot in the same shape so
    // the component below has exactly one code path.
    const books: LiveBook[] =
      desk?.books ??
      snapshot.books.map((b) => ({
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
        armState: "disarmed" as const,
        dryRun: true,
        positions: b.openPositions.map((p) => ({
          oandaTradeId: p.oandaTradeId,
          book: b.book,
          instrument: p.instrument,
          direction: p.direction,
          units: p.units,
          entryPrice: p.entryPrice,
          currentStop: p.currentStop,
          currentTarget: null,
          unrealizedPl: p.unrealizedPl,
          markPrice: p.currentPrice ?? p.entryPrice,
          plPerPrice: 0,
          riskR: p.riskR,
          riskDistance: null,
          openedAt: Date.now(),
        })),
      }));

    return books
      .filter((b) => inScope.has(b.book as BookId))
      .map((b): MarkedBook => {
        const positions = b.positions.map((p): MarkedPosition => {
          const price = ticks.get(p.instrument)?.mid ?? null;
          const livePl = price !== null ? markToMarket(p, price) : p.unrealizedPl;
          const unrealizedR = price !== null ? positionProgress(p, price) : 0;

          return { ...p, livePl, unrealizedR, price };
        });

        return {
          ...b,
          positions,
          // Book totals follow from the marked positions, so the ribbon, the
          // tiles and the table can never disagree with each other.
          unrealizedPl: positions.reduce((s, p) => s + p.livePl, 0),
          // Exposure comes from the push untouched — it is a function of where
          // the stops are, which only the broker and the engine can change.
          openRiskR: b.openRiskR,
        };
      });
  }, [desk, snapshot, ticks, inScope]);
}

/**
 * Streaming prices.
 *
 * Shows the spread explicitly, because on this account spread accounted for
 * roughly three quarters of the net loss — it is not a detail worth hiding
 * behind a mid price.
 */
function LivePrices() {
  const { ticks, state, lastUpdate } = useLive();
  const rows = [...ticks.values()].sort((a, b) => a.instrument.localeCompare(b.instrument));

  return (
    <Card className="p-5">
      <CardHeader
        title="Live prices"
        action={
          <span className="flex items-center gap-1.5">
            <span
              className={clsx(
                "size-1.5 rounded-full",
                state === "live"
                  ? "live-dot"
                  : state === "offline"
                    ? "bg-[var(--color-loss)]"
                    : "bg-[var(--color-warn)]",
              )}
            />
            <span className="label-faint">
              {lastUpdate ? formatTime(new Date(lastUpdate)) : state}
            </span>
          </span>
        }
      />

      {rows.length === 0 ? (
        <p className="mt-6 pb-4 text-center text-sm text-[var(--color-ink-mute)]">
          {state === "live"
            ? "Waiting for the first tick…"
            : "Price feed not connected. Markets may be closed."}
        </p>
      ) : (
        <table className="mt-3 w-full text-[13px]">
          <tbody>
            {rows.map((t) => (
              <tr key={t.instrument} className="border-t border-[var(--color-line)]/60">
                <td className="py-1.5 font-medium">{t.instrument}</td>
                <td className="py-1.5 text-right figure text-[var(--color-ink-dim)]">
                  {t.bid}
                </td>
                <td className="py-1.5 text-right figure text-[var(--color-ink-dim)]">
                  {t.ask}
                </td>
                <td className="py-1.5 text-right figure text-[var(--color-warn)]">
                  {(t.ask - t.bid).toPrecision(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
