"use client";

import Link from "next/link";
import { AlertTriangle, ShieldOff } from "lucide-react";
import { Card, StatTile } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { useLive, useScope } from "@/components/AppShell";
import { BOOKS, booksInScope, scopeLabel, type BookId } from "@/lib/books";
import type { DeskSnapshot } from "@/lib/desk/snapshot";
import { formatTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

/**
 * Open Positions.
 *
 * The one screen where "no stop" has to be shouted rather than rendered as a
 * dash. Every derived risk figure in this app — R, MAE, MFE, remaining risk —
 * is denominated in the distance from entry to the opening stop. A position
 * without one has unbounded downside and no denominator, so instead of a blank
 * cell it gets a warning and is excluded from every R total on the page.
 *
 * Prices stream; the rest is a snapshot. Unrealised P&L is recomputed from the
 * live mid rather than waiting for a refetch, so the number moves with the
 * market — but it is OANDA's own figure that is shown when no tick has arrived,
 * never an estimate dressed up as broker data.
 */

export type PositionRow = DeskSnapshot["books"][number]["openPositions"][number] & {
  book: BookId;
  currency: string;
  /** Present only when the trade is in the derived table. */
  tradeRowId: number | null;
  entryTime: string | null;
  /** Value of a one-unit price move, in account currency. Null when unknown. */
  unitValue: number | null;
};

export function PositionsTable({
  snapshot,
  rows,
}: {
  snapshot: DeskSnapshot;
  rows: PositionRow[];
}) {
  const { scope } = useScope();
  const { ticks, state } = useLive();
  const inScope = new Set<BookId>(booksInScope(scope));
  const shown = rows.filter((r) => inScope.has(r.book));

  const currency = shown[0]?.currency ?? "GBP";
  const withStop = shown.filter((p) => p.currentStop !== null);
  const naked = shown.filter((p) => p.currentStop === null);

  // Live-adjusted unrealised P&L where a tick has arrived, broker figure where
  // it hasn't. Mixing the two is honest: both are real, neither is invented.
  const liveP = (p: PositionRow): { pl: number; live: boolean } => {
    const tick = ticks.get(p.instrument);
    if (!tick || p.unitValue === null) return { pl: p.unrealizedPl, live: false };
    const exit = p.units >= 0 ? tick.bid : tick.ask;
    return { pl: (exit - p.entryPrice) * p.units * p.unitValue, live: true };
  };

  const unrealized = shown.reduce((s, p) => s + liveP(p).pl, 0);
  const openRiskR = withStop.reduce((s, p) => s + p.riskR, 0);
  const degradedInScope = snapshot.degraded.filter((b) => inScope.has(b));

  return (
    <>
      <PageHeader
        title="Open Positions"
        subtitle={`${scopeLabel(scope)} · ${shown.length} open`}
        action={
          <span className="label-faint">
            {state === "live" ? "streaming" : state} · as of{" "}
            {formatTime(new Date(snapshot.fetchedAt))}
          </span>
        }
      />

      {degradedInScope.length > 0 && (
        <Warn>
          Showing stored data for {degradedInScope.map((b) => BOOKS[b].label).join(", ")} —
          the broker could not be reached, so these figures may be stale.
        </Warn>
      )}

      {shown.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--color-ink-mute)]">
            Nothing open in {scopeLabel(scope)}.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Open P&L"
              value={<Money value={unrealized} currency={currency} />}
              sub={`${shown.length} position${shown.length === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Risk on the table"
              value={<span className="figure">{openRiskR.toFixed(2)}R</span>}
              sub={
                naked.length
                  ? `${withStop.length} of ${shown.length} priced in R`
                  : "all positions stopped"
              }
            />
            <StatTile
              label="Unstopped"
              value={
                <span
                  className={clsx(
                    "figure",
                    naked.length ? "text-[var(--color-warn)]" : undefined,
                  )}
                >
                  {naked.length}
                </span>
              }
              sub={naked.length ? "no bounded loss" : "none"}
            />
            <StatTile
              label="Books"
              value={
                <span className="figure">
                  {new Set(shown.map((p) => p.book)).size}
                </span>
              }
            />
            <StatTile
              label="Instruments"
              value={
                <span className="figure">
                  {new Set(shown.map((p) => p.instrument)).size}
                </span>
              }
            />
          </div>

          {naked.length > 0 && (
            <Warn>
              <strong>
                {naked.length} position{naked.length === 1 ? " has" : "s have"} no stop
                order.
              </strong>{" "}
              R, MAE and MFE all divide by the distance from entry to the opening stop, so
              these carry no computable risk figure and are excluded from the R totals
              above. The engine also leaves them completely alone — it will not guess a
              denominator for a trade whose real risk it does not know.
            </Warn>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                    <Th>Instrument</Th>
                    <Th>Book</Th>
                    <Th>Side</Th>
                    <Th align="right">Units</Th>
                    <Th align="right">Entry</Th>
                    <Th align="right">Now</Th>
                    <Th align="right">Stop</Th>
                    <Th align="right">To stop</Th>
                    <Th align="right">Risk left</Th>
                    <Th align="right">Open P&amp;L</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const tick = ticks.get(p.instrument);
                    const mid = tick?.mid ?? null;
                    const { pl, live } = liveP(p);
                    const dp = decimalsFor(p.entryPrice);

                    // Distance to stop as a fraction of the current price, which
                    // compares across EURUSD and XAUUSD in a way points cannot.
                    const toStop =
                      p.currentStop !== null && mid !== null
                        ? ((p.units >= 0 ? mid - p.currentStop : p.currentStop - mid) /
                            mid) *
                          100
                        : null;

                    return (
                      <tr
                        key={`${p.book}-${p.oandaTradeId}`}
                        className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-card-raised)]"
                      >
                        <Td className="font-medium">
                          {p.tradeRowId ? (
                            <Link
                              href={`/trades/${p.tradeRowId}`}
                              className="hover:text-[var(--color-accent)]"
                            >
                              {p.instrument}
                            </Link>
                          ) : (
                            p.instrument
                          )}
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: BOOKS[p.book].colorVar }}
                            />
                            <span className="text-[var(--color-ink-dim)]">
                              {BOOKS[p.book].label}
                            </span>
                          </span>
                        </Td>
                        <Td>
                          <span
                            className={clsx(
                              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              p.direction === "long"
                                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                                : "bg-[var(--color-line)] text-[var(--color-ink-dim)]",
                            )}
                          >
                            {p.direction}
                          </span>
                        </Td>
                        <Td align="right" className="figure text-[var(--color-ink-dim)]">
                          {p.units.toLocaleString()}
                        </Td>
                        <Td align="right" className="figure">
                          {p.entryPrice.toFixed(dp)}
                        </Td>
                        <Td
                          align="right"
                          className={clsx(
                            "figure",
                            live ? "text-[var(--color-accent)]" : "text-[var(--color-ink-mute)]",
                          )}
                        >
                          {mid !== null ? mid.toFixed(dp) : "—"}
                        </Td>
                        <Td align="right" className="figure">
                          {p.currentStop !== null ? (
                            p.currentStop.toFixed(dp)
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[var(--color-warn)]">
                              <ShieldOff className="size-3" /> none
                            </span>
                          )}
                        </Td>
                        <Td align="right" className="figure text-[var(--color-ink-mute)]">
                          {toStop !== null ? `${toStop.toFixed(2)}%` : "—"}
                        </Td>
                        <Td align="right">
                          {p.currentStop !== null ? (
                            <span className="figure">{p.riskR.toFixed(2)}R</span>
                          ) : (
                            <span className="text-[var(--color-warn)]">unbounded</span>
                          )}
                        </Td>
                        <Td align="right">
                          <Money value={pl} currency={p.currency} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            &ldquo;Risk left&rdquo; is measured against each position&apos;s ORIGINAL stop,
            so a stop moved to breakeven reads 0.00R rather than 1.00R. Prices in orange
            are streaming; grey ones are the broker&apos;s last snapshot.
          </p>
        </>
      )}
    </>
  );
}

/** Enough decimals for the instrument, inferred from the price magnitude. */
function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  if (price >= 10) return 4;
  return 5;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
      <p className="text-xs leading-relaxed text-[var(--color-warn)]">{children}</p>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={clsx("label-faint px-3 py-2.5", align === "right" ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={clsx("px-3 py-2", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </td>
  );
}
