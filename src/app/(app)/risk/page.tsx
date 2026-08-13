import { requireSession } from "@/lib/auth/guard";
import { accountCurrency, loadTrades } from "@/lib/analytics/load";
import {
  drawdowns,
  equityCurve,
  maxDrawdownR,
  streaks,
  summarise,
} from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { AreaLine, UnderwaterPlot } from "@/components/charts/Plot";
import { BookFilter, ClusterNote, NoTrades } from "@/components/analytics/Shared";
import { BOOK_IDS } from "@/lib/books";
import { formatDate } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Risk & Drawdown.
 *
 * The question this screen answers is not "how much did I make" but "how much
 * was I risking, and how bad did it get". Both are answerable only because
 * every trade carries a hard stop, which is what makes planned risk a broker
 * fact rather than an estimate — and the trades that DON'T carry one are called
 * out rather than quietly averaged away.
 */
export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);

  const [trades, currency] = await Promise.all([
    loadTrades({ book, includeOpen: true }),
    accountCurrency(),
  ]);

  const closed = trades.filter((t) => t.exitTime !== null);
  const open = trades.filter((t) => t.exitTime === null);
  const s = summarise(closed);
  const curve = equityCurve(closed);
  const spells = drawdowns(curve).slice(0, 6);
  const st = streaks(closed);

  // The honesty check that matters most on this page.
  const noR = closed.filter((t) => t.rMultiple === null);
  const openNoStop = open.length;

  // Risk actually taken per trade, in R terms. By construction a full stop-out
  // is −1R, so anything materially past −1 means the stop did not hold — a gap,
  // slippage, or a stop that was moved.
  const overruns = closed.filter((t) => (t.rMultiple ?? 0) < -1.15);

  return (
    <>
      <PageHeader
        title="Risk &amp; Drawdown"
        subtitle={`${closed.length} closed · ${open.length} open`}
      />
      <BookFilter base="/risk" active={book} />

      {trades.length === 0 ? (
        <NoTrades what="No trades in this book yet." />
      ) : (
        <>
          <ClusterNote trades={s.trades} independentExits={s.independentExits} />

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Max drawdown"
              value={<RMultiple value={maxDrawdownR(curve)} decimals={1} />}
              sub={spells[0] ? `${spells[0].tradesUnderwater} trades` : undefined}
            />
            <StatTile
              label="Current drawdown"
              value={
                <RMultiple
                  value={curve.length ? curve[curve.length - 1].drawdownR : 0}
                  decimals={1}
                />
              }
              sub={
                curve.length && curve[curve.length - 1].drawdownR === 0
                  ? "at a new high"
                  : undefined
              }
            />
            <StatTile
              label="Longest losing run"
              value={<span className="figure money-down">{st.longestLoss}</span>}
            />
            <StatTile
              label="Worst single trade"
              value={
                s.largestLossR !== null ? (
                  <RMultiple value={s.largestLossR} />
                ) : (
                  <span className="text-[var(--color-ink-faint)]">—</span>
                )
              }
            />
            <StatTile
              label="Stops that didn't hold"
              value={
                <span
                  className={clsx(
                    "figure",
                    overruns.length ? "text-[var(--color-warn)]" : undefined,
                  )}
                >
                  {overruns.length}
                </span>
              }
              sub="worse than −1.15R"
            />
            <StatTile
              label="No risk figure"
              value={
                <span
                  className={clsx(
                    "figure",
                    noR.length || openNoStop ? "text-[var(--color-warn)]" : undefined,
                  )}
                >
                  {noR.length + openNoStop}
                </span>
              }
              sub={openNoStop ? `${openNoStop} of them still open` : "closed trades"}
            />
          </div>

          <Card className="p-5">
            <CardHeader title="Underwater curve" action={<span className="label-faint">in R, from the running peak</span>} />
            <div className="mt-3">
              <AreaLine values={curve.map((p) => p.r)} height={140} />
              <div className="mt-2">
                <UnderwaterPlot values={curve.map((p) => p.drawdownR)} height={110} />
              </div>
            </div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader title="Deepest drawdowns" />
              {spells.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                  No drawdown recorded — the equity curve has never traded below its peak.
                </p>
              ) : (
                <table className="mt-3 w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--color-line)]">
                      <th className="label-faint py-2 text-left">Started</th>
                      <th className="label-faint py-2 text-right">Depth</th>
                      <th className="label-faint py-2 text-right">Trades</th>
                      <th className="label-faint py-2 text-right">Recovered in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spells.map((d) => (
                      <tr
                        key={d.startedAt.toISOString()}
                        className="border-b border-[var(--color-line)]/60 last:border-0"
                      >
                        <td className="py-2 text-[var(--color-ink-dim)]">
                          {formatDate(d.startedAt)}
                        </td>
                        <td className="py-2 text-right">
                          <RMultiple value={-d.depthR} decimals={2} />
                        </td>
                        <td className="figure py-2 text-right text-[var(--color-ink-dim)]">
                          {d.tradesUnderwater}
                        </td>
                        <td className="py-2 text-right">
                          {d.recoveredInDays === null ? (
                            <span className="text-[var(--color-warn)]">still under</span>
                          ) : (
                            <span className="figure text-[var(--color-ink-mute)]">
                              {d.recoveredInDays < 1
                                ? `${(d.recoveredInDays * 24).toFixed(0)}h`
                                : `${d.recoveredInDays.toFixed(0)}d`}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card className="p-5">
              <CardHeader title="Where the risk figure is missing" />
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
                Every number on this page divides by the distance from entry to the
                opening stop. {noR.length} closed{" "}
                {noR.length === 1 ? "trade has" : "trades have"} no such distance recorded,
                and {openNoStop} open{" "}
                {openNoStop === 1 ? "position carries" : "positions carry"} no stop at all.
                They are excluded from every R statistic here rather than counted as zero,
                because counting them would understate both the edge and the damage.
              </p>
              {openNoStop > 0 && (
                <div className="mt-3 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
                  <p className="text-xs leading-relaxed text-[var(--color-warn)]">
                    <strong>
                      {openNoStop} open position{openNoStop === 1 ? "" : "s"} with no stop
                      order.
                    </strong>{" "}
                    Until a stop is attached these have no bounded loss, so no drawdown
                    figure on this page accounts for what they could still cost.
                  </p>
                </div>
              )}
              {overruns.length > 0 && (
                <div className="mt-3">
                  <span className="label-faint">Stops that didn&apos;t hold</span>
                  <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-ink-dim)]">
                    {overruns.slice(0, 6).map((t) => (
                      <li key={t.id} className="flex justify-between gap-2">
                        <span>
                          {t.instrument} · {formatDate(t.exitTime ?? t.entryTime)}
                        </span>
                        <RMultiple value={t.rMultiple ?? 0} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                    A hard stop should cap a loss at −1R. Anything materially past that is a
                    gap, slippage, or a stop that was moved — worth telling apart, because
                    only one of the three is under your control.
                  </p>
                </div>
              )}
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <CardHeader title="Cash view" />
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile label="Net" value={<Money value={s.netPl} currency={currency} />} />
              <StatTile
                label="Gross wins"
                value={
                  <Money
                    value={closed.filter((t) => t.realizedPl > 0).reduce((a, t) => a + t.realizedPl, 0)}
                    currency={currency}
                  />
                }
              />
              <StatTile
                label="Gross losses"
                value={
                  <Money
                    value={closed.filter((t) => t.realizedPl < 0).reduce((a, t) => a + t.realizedPl, 0)}
                    currency={currency}
                  />
                }
              />
              <StatTile
                label="Spread paid"
                value={
                  <span className="figure text-[var(--color-warn)]">
                    {s.spreadPaid.toFixed(2)}
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
