
import { requireSession } from "@/lib/auth/guard";
import { accountCurrency, loadTrades } from "@/lib/analytics/load";
import {
  convictionEdge,
  drawdowns,
  equityCurve,
  groupBy,
  maxDrawdownR,
  rHistogram,
  streaks,
  summarise,
} from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { AreaLine, BarRows, Histogram, UnderwaterPlot } from "@/components/charts/Plot";
import { BookFilter, ClusterNote, NoTrades } from "@/components/analytics/Shared";
import { BOOKS, BOOK_IDS, HORIZONS, type BookId, type HorizonId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);

  const [trades, currency] = await Promise.all([
    loadTrades({ book }),
    accountCurrency(),
  ]);

  const s = summarise(trades);
  const curve = equityCurve(trades);
  const spells = drawdowns(curve);
  const st = streaks(trades);
  const conviction = convictionEdge(trades);

  const byBook = groupBy(trades, (t) => t.book as BookId).sort(
    (a, b) => b.summary.totalR - a.summary.totalR,
  );
  const byHorizon = groupBy(trades, (t) => t.horizon as HorizonId | null).sort(
    (a, b) => b.summary.totalR - a.summary.totalR,
  );

  const hist = rHistogram(trades).map((b) => ({
    label:
      b.from === -Infinity
        ? "<−3"
        : b.to === Infinity
          ? ">3"
          : `${b.from}`,
    count: b.count,
    tone: (b.to <= 0 ? "down" : "up") as "up" | "down",
  }));

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle={`${s.trades} closed trades · ${s.independentExits} independent exits`}
      />
      <BookFilter base="/performance" active={book} />

      {trades.length === 0 ? (
        <NoTrades what="No closed trades in this book yet." />
      ) : (
        <>
          <ClusterNote trades={s.trades} independentExits={s.independentExits} />

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Net P&L"
              value={<Money value={s.netPl} currency={currency} />}
              sub={`${s.wins}W / ${s.losses}L`}
            />
            <StatTile label="Total R" value={<RMultiple value={s.totalR} decimals={1} />} />
            <StatTile
              label="Expectancy"
              value={
                s.expectancyR === null ? (
                  <span className="text-[var(--color-ink-faint)]">—</span>
                ) : (
                  <RMultiple value={s.expectancyR} />
                )
              }
              sub="per trade, in R"
            />
            <StatTile
              label="Win rate"
              value={<span className="figure">{s.winRate.toFixed(1)}%</span>}
              sub={s.scratches ? `${s.scratches} scratch` : undefined}
            />
            <StatTile
              label="Profit factor"
              value={
                <span
                  className={clsx(
                    "figure",
                    s.profitFactor === null
                      ? "text-[var(--color-ink-faint)]"
                      : s.profitFactor >= 1
                        ? "money-up"
                        : "money-down",
                  )}
                >
                  {s.profitFactor?.toFixed(2) ?? "—"}
                </span>
              }
            />
            <StatTile
              label="Max drawdown"
              value={<RMultiple value={maxDrawdownR(curve)} decimals={1} />}
              sub={spells[0] ? `${spells[0].tradesUnderwater} trades underwater` : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card className="p-5">
              <CardHeader
                title="Equity in R"
                action={
                  <span className="label-faint">ordered by exit, not entry</span>
                }
              />
              <div className="mt-3">
                <AreaLine values={curve.map((p) => p.r)} height={180} />
              </div>

              <div className="mt-4">
                <span className="label-faint">Underwater</span>
                <UnderwaterPlot values={curve.map((p) => p.drawdownR)} />
              </div>

              <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                Ordered by exit time on purpose: a swing opened in March and closed in June
                damages the account in June. An entry-ordered curve would show the loss
                before it happened and understate every drawdown.
              </p>
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <CardHeader title="R distribution" />
                <div className="mt-3">
                  <Histogram buckets={hist} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-ink-mute)]">
                  <span>
                    Avg win{" "}
                    {s.avgWinR !== null ? <RMultiple value={s.avgWinR} /> : "—"}
                  </span>
                  <span>
                    Avg loss{" "}
                    {s.avgLossR !== null ? <RMultiple value={s.avgLossR} /> : "—"}
                  </span>
                  <span>
                    Best{" "}
                    {s.largestWinR !== null ? <RMultiple value={s.largestWinR} /> : "—"}
                  </span>
                  <span>
                    Worst{" "}
                    {s.largestLossR !== null ? <RMultiple value={s.largestLossR} /> : "—"}
                  </span>
                </div>
              </Card>

              <Card className="p-5">
                <CardHeader title="Streaks" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <StatTile
                    label="Longest win"
                    value={<span className="figure money-up">{st.longestWin}</span>}
                  />
                  <StatTile
                    label="Longest loss"
                    value={<span className="figure money-down">{st.longestLoss}</span>}
                  />
                  <StatTile
                    label="Current"
                    value={
                      <span
                        className={clsx(
                          "figure",
                          st.current > 0 ? "money-up" : st.current < 0 ? "money-down" : "money-flat",
                        )}
                      >
                        {st.current > 0 ? `+${st.current}` : st.current}
                      </span>
                    }
                  />
                </div>
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <CardHeader title="By book" />
              <div className="mt-3">
                <BarRows
                  rows={byBook.map((g) => ({
                    label: BOOKS[g.key].label,
                    value: g.summary.totalR,
                    sub: `${g.summary.trades}`,
                  }))}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                />
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader title="By hold time" />
              <div className="mt-3">
                <BarRows
                  rows={byHorizon.map((g) => ({
                    label: HORIZONS[g.key!]?.label ?? String(g.key),
                    value: g.summary.totalR,
                    sub: `${g.summary.trades}`,
                  }))}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                />
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader title="Does conviction predict outcome?" />
              {conviction.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                  No trades are graded for conviction yet. Until they are, scaling risk by
                  conviction is an untested assumption — grade a few dozen on the trade
                  detail screen and this answers itself.
                </p>
              ) : (
                <>
                  <div className="mt-3">
                    <BarRows
                      rows={conviction.map((c) => ({
                        label: c.conviction,
                        value: c.expectancyR ?? 0,
                        sub: `n=${c.n}`,
                      }))}
                      format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`}
                    />
                  </div>
                  <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                    Conviction-scaled sizing is only rational if A+ actually beats B. If
                    these bars do not descend, the multiplier table is costing money.
                  </p>
                </>
              )}
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <CardHeader title="Costs" />
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile
                label="Spread paid"
                value={
                  <span className="figure text-[var(--color-warn)]">
                    {s.spreadPaid.toFixed(2)}
                  </span>
                }
                sub="broker-reported half-spread"
              />
              <StatTile
                label="Financing"
                value={<Money value={s.financing} currency={currency} />}
                sub="overnight carry"
              />
              <StatTile
                label="Gross before costs"
                value={
                  <Money value={s.netPl + s.spreadPaid - s.financing} currency={currency} />
                }
              />
              <StatTile
                label="Costs as % of gross"
                value={
                  <span className="figure text-[var(--color-warn)]">
                    {s.netPl + s.spreadPaid > 0
                      ? `${((s.spreadPaid / (s.netPl + s.spreadPaid)) * 100).toFixed(0)}%`
                      : "—"}
                  </span>
                }
              />
            </div>
          </Card>
        </>
      )}
    </>
  );
}
