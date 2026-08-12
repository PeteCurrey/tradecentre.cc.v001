"use client";

import Link from "next/link";
import { Activity, AlertTriangle, Crosshair, Layers, Percent, Wallet } from "lucide-react";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { RiskFlow, type BookRisk } from "@/components/ui/RiskFlow";
import { Money } from "@/components/ui/Money";
import { NotConnected, PageHeader } from "@/components/ui/Page";
import { useLive, useScope } from "@/components/AppShell";
import { BOOKS, booksInScope, isDemo, scopeLabel, type BookId } from "@/lib/books";
import type { DeskSnapshot } from "@/lib/desk/snapshot";
import { formatTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export function LiveDesk({ snapshot }: { snapshot: DeskSnapshot }) {
  const { scope } = useScope();
  const inScope = new Set<BookId>(booksInScope(scope));
  const shown = snapshot.books.filter((b) => inScope.has(b.book));

  // Aggregate across the books in scope. Demo never aggregates with live —
  // booksInScope resolves a demo scope to exactly one book.
  const todayR = shown.reduce((s, b) => s + b.todayR, 0);
  const todayPl = shown.reduce((s, b) => s + b.todayPl, 0);
  const todayTrades = shown.reduce((s, b) => s + b.todayTrades, 0);
  const openRiskR = shown.reduce((s, b) => s + b.openRiskR, 0);
  const unrealized = shown.reduce((s, b) => s + b.unrealizedPl, 0);
  const positions = shown.flatMap((b) =>
    b.openPositions.map((p) => ({ ...p, book: b.book })),
  );

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

  const flow: BookRisk[] = shown.map((b) => ({
    bookId: b.book,
    label: BOOKS[b.book].label,
    colorVar: BOOKS[b.book].colorVar,
    riskR: b.openRiskR,
    positions: b.openPositions.length,
  }));

  const degradedInScope = snapshot.degraded.filter((b) => inScope.has(b));

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
            {degradedInScope.map((b) => BOOKS[b].label).join(", ")} — the broker could not
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

          <div className="mt-2 flex flex-wrap items-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <RadialGauge
                value={todayR}
                limit={limitR}
                size={220}
                sublabel={`Limit −${limitR.toFixed(1)}R`}
              />
              <div className="text-center">
                <div className="label-faint">Cash P&amp;L today</div>
                <Money value={todayPl} currency={currency} className="text-2xl" />
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
                <span
                  className={clsx(
                    "figure",
                    openRiskR > 0 ? "text-[var(--color-accent)]" : "text-[var(--color-ink-faint)]",
                  )}
                >
                  {openRiskR.toFixed(2)}R
                </span>
              }
              icon={<Crosshair className="size-3.5" />}
            />
            <StatTile
              label="Unrealised"
              value={<Money value={unrealized} currency={currency} />}
              icon={<Percent className="size-3.5" />}
            />
            <StatTile
              label="Rope left"
              value={
                <span className="figure">
                  {Math.max(0, limitR + Math.min(0, todayR)).toFixed(2)}R
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
              <tbody>
                {positions.map((p) => (
                  <tr key={p.oandaTradeId} className="border-t border-[var(--color-line)]/60">
                    <td className="py-2 font-medium">{p.instrument}</td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: BOOKS[p.book].colorVar }}
                        />
                        <span className="text-[var(--color-ink-dim)]">
                          {BOOKS[p.book].label}
                        </span>
                      </span>
                    </td>
                    <td className="py-2 text-right figure text-[var(--color-ink-dim)]">
                      {p.units.toLocaleString()}
                    </td>
                    <td className="py-2 text-right figure">{p.entryPrice}</td>
                    <td className="py-2 text-right figure text-[var(--color-accent)]">
                      {p.riskR.toFixed(2)}R
                    </td>
                    <td className="py-2 text-right">
                      <Money value={p.unrealizedPl} currency={currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <LivePrices />
      </div>
    </>
  );
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
