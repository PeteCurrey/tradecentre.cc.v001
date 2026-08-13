import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { patterns as patternsTable } from "@/lib/db/schema";
import { accountCurrency, loadTrades } from "@/lib/analytics/load";
import { groupBy, summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BarRows } from "@/components/charts/Plot";
import { BookFilter, ClusterNote, NoTrades } from "@/components/analytics/Shared";
import { BOOK_IDS } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Pattern Performance.
 *
 * This screen is only as good as the tagging behind it, so it says how much of
 * the ledger is actually tagged before it says anything about which pattern
 * wins. A ranking computed over 4% of trades is not a ranking.
 */
export default async function PatternPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);

  const [trades, patterns, currency] = await Promise.all([
    loadTrades({ book }),
    db.select().from(patternsTable),
    accountCurrency(),
  ]);

  const name = new Map(patterns.map((p) => [p.id, p]));
  const tagged = trades.filter((t) => t.patternId !== null);
  const untagged = trades.length - tagged.length;
  const coverage = trades.length ? (tagged.length / trades.length) * 100 : 0;

  const byPattern = groupBy(tagged, (t) => t.patternId).sort(
    (a, b) => (b.summary.expectancyR ?? -99) - (a.summary.expectancyR ?? -99),
  );

  const s = summarise(tagged);

  return (
    <>
      <PageHeader
        title="Pattern Performance"
        subtitle={`${tagged.length} of ${trades.length} closed trades carry a pattern tag`}
        action={
          <Link
            href="/patterns"
            className="rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
          >
            Pattern library
          </Link>
        }
      />
      <BookFilter base="/pattern-performance" active={book} />

      {trades.length === 0 ? (
        <NoTrades what="No closed trades in this book yet." />
      ) : tagged.length === 0 ? (
        <Card className="p-8">
          <h2 className="label">Nothing is tagged yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
            None of your {trades.length} closed trades carries a pattern tag, so there is
            nothing to rank. The library holds {patterns.length} generated candidates, but
            those are hypotheses drawn from public technical literature — none is known to
            work on your instruments, at your costs, in current conditions.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
            Tag trades on the trade detail screen and this page fills itself in. Until
            then, showing a ranking would be inventing one.
          </p>
        </Card>
      ) : (
        <>
          <ClusterNote trades={s.trades} independentExits={s.independentExits} />

          {coverage < 60 && (
            <div className="mb-4 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
              <p className="text-xs leading-relaxed text-[var(--color-warn)]">
                <strong>Only {coverage.toFixed(0)}% of trades are tagged.</strong> The
                ranking below describes the tagged minority, and the {untagged} untagged
                trades are not a random sample — they are the ones that were less obvious
                to classify, which is exactly where the interesting cases live.
              </p>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile
              label="Tag coverage"
              value={
                <span
                  className={clsx(
                    "figure",
                    coverage < 60 ? "text-[var(--color-warn)]" : undefined,
                  )}
                >
                  {coverage.toFixed(0)}%
                </span>
              }
              sub={`${untagged} untagged`}
            />
            <StatTile label="Patterns used" value={<span className="figure">{byPattern.length}</span>} />
            <StatTile label="Tagged R" value={<RMultiple value={s.totalR} decimals={1} />} />
            <StatTile
              label="Tagged net"
              value={<Money value={s.netPl} currency={currency} />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="overflow-hidden">
              <div className="p-5 pb-3">
                <CardHeader title="By pattern" action={<span className="label-faint">ranked by expectancy</span>} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                      <th className="label-faint px-3 py-2.5 text-left">Pattern</th>
                      <th className="label-faint px-3 py-2.5 text-left">Status</th>
                      <th className="label-faint px-3 py-2.5 text-right">Trades</th>
                      <th className="label-faint px-3 py-2.5 text-right">Exits</th>
                      <th className="label-faint px-3 py-2.5 text-right">Win rate</th>
                      <th className="label-faint px-3 py-2.5 text-right">Expectancy</th>
                      <th className="label-faint px-3 py-2.5 text-right">Total R</th>
                      <th className="label-faint px-3 py-2.5 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPattern.map((g) => {
                      const p = name.get(g.key!);
                      const thin = g.summary.independentExits < 20;
                      return (
                        <tr
                          key={g.key}
                          className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-card-raised)]"
                        >
                          <td className="px-3 py-2 font-medium">
                            {p ? (
                              <Link
                                href={`/patterns/${p.slug}`}
                                className="hover:text-[var(--color-accent)]"
                              >
                                {p.name}
                              </Link>
                            ) : (
                              `#${g.key}`
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="label-faint">{p?.status ?? "—"}</span>
                          </td>
                          <td className="figure px-3 py-2 text-right text-[var(--color-ink-dim)]">
                            {g.summary.trades}
                          </td>
                          <td
                            className={clsx(
                              "figure px-3 py-2 text-right",
                              thin ? "text-[var(--color-warn)]" : "text-[var(--color-ink-mute)]",
                            )}
                          >
                            {g.summary.independentExits}
                          </td>
                          <td className="figure px-3 py-2 text-right">
                            {g.summary.winRate.toFixed(0)}%
                          </td>
                          <td className="px-3 py-2 text-right">
                            {g.summary.expectancyR === null ? (
                              <span className="text-[var(--color-ink-faint)]">—</span>
                            ) : (
                              <RMultiple value={g.summary.expectancyR} />
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <RMultiple value={g.summary.totalR} decimals={1} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={g.summary.netPl} currency={currency} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-xs text-[var(--color-ink-faint)]">
                Fewer than twenty independent exits is shown in orange. At that sample size
                the difference between a good pattern and a lucky one is not measurable,
                whatever the expectancy column says.
              </p>
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <CardHeader title="Total R by pattern" />
                <div className="mt-3">
                  <BarRows
                    rows={byPattern.slice(0, 12).map((g) => ({
                      label: name.get(g.key!)?.name ?? `#${g.key}`,
                      value: g.summary.totalR,
                      sub: `${g.summary.trades}`,
                    }))}
                    format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                  />
                </div>
              </Card>

              <Card className="p-5">
                <CardHeader title="The multiple-testing hazard" />
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
                  The library holds {patterns.length} candidates. Ranking that many against
                  one history will always produce a leader, and with twenty tries something
                  clears any fixed threshold roughly two times in three even when nothing
                  works.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
                  Treat this table as a description of what happened, not as evidence about
                  what will. The backtest gate — with its segmentation and tested-count
                  correction — is the thing that is allowed to make a claim.
                </p>
                <Link
                  href="/backtest"
                  className="mt-3 inline-block rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
                >
                  Open the backtest gate
                </Link>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
