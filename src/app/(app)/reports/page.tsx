import { Download } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { activeEnvironment, accountCurrency, loadTrades } from "@/lib/analytics/load";
import {
  equityCurve,
  groupBy,
  maxDrawdownR,
  summarise,
  type AnalyticsTrade,
} from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { AreaLine } from "@/components/charts/Plot";
import { BookFilter, ClusterNote, NoTrades, PracticeNote } from "@/components/analytics/Shared";
import { BOOK_IDS } from "@/lib/books";
import { DISPLAY_TZ, dayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Reports & Exports.
 *
 * Periods are cut on EXIT, matching the equity curve, so a monthly total here
 * and the curve on Performance can never disagree. The export is the derived
 * table with its inputs beside it, so any figure in a spreadsheet traces back
 * to a broker fill.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);

  const [trades, currency, environment] = await Promise.all([
    loadTrades({ book }),
    accountCurrency(),
    activeEnvironment(),
  ]);

  const closed = trades.filter((t) => t.exitTime !== null);
  const s = summarise(closed);

  const monthKey = (t: AnalyticsTrade) => dayKey(t.exitTime!, DISPLAY_TZ).slice(0, 7);
  const quarterKey = (t: AnalyticsTrade) => {
    const k = dayKey(t.exitTime!, DISPLAY_TZ);
    const q = Math.floor((Number(k.slice(5, 7)) - 1) / 3) + 1;
    return `${k.slice(0, 4)} Q${q}`;
  };

  const months = groupBy(closed, monthKey).sort((a, b) =>
    String(b.key).localeCompare(String(a.key)),
  );
  const quarters = groupBy(closed, quarterKey).sort((a, b) =>
    String(b.key).localeCompare(String(a.key)),
  );
  const byInstrument = groupBy(closed, (t) => t.instrument).sort(
    (a, b) => b.summary.totalR - a.summary.totalR,
  );

  const curve = equityCurve(closed);
  const exportQs = book ? `?book=${book}` : "";

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${closed.length} closed trades across ${months.length} months`}
        action={
          <div className="flex gap-2">
            <a
              href={`/api/export${exportQs}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
            >
              <Download className="size-3.5" />
              Export live CSV
            </a>
            <a
              href="/api/export?demo=1"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
            >
              <Download className="size-3.5" />
              Demo CSV
            </a>
          </div>
        }
      />
      <BookFilter base="/reports" active={book} />
      <PracticeNote environment={environment} />

      {closed.length === 0 ? (
        <NoTrades what="No closed trades to report on yet." />
      ) : (
        <>
          <ClusterNote trades={s.trades} independentExits={s.independentExits} />

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Net" value={<Money value={s.netPl} currency={currency} />} />
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
            />
            <StatTile
              label="Win rate"
              value={<span className="figure">{s.winRate.toFixed(1)}%</span>}
            />
            <StatTile
              label="Max drawdown"
              value={<RMultiple value={maxDrawdownR(curve)} decimals={1} />}
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

          <Card className="mb-4 p-5">
            <CardHeader title="Equity in R" action={<span className="label-faint">whole period</span>} />
            <div className="mt-3">
              <AreaLine values={curve.map((p) => p.r)} height={140} />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <PeriodTable title="By month" rows={months} currency={currency} />
            <PeriodTable title="By quarter" rows={quarters} currency={currency} />
          </div>

          <Card className="mt-4 overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader title="By instrument" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                    <th className="label-faint px-3 py-2.5 text-left">Instrument</th>
                    <th className="label-faint px-3 py-2.5 text-right">Trades</th>
                    <th className="label-faint px-3 py-2.5 text-right">Exits</th>
                    <th className="label-faint px-3 py-2.5 text-right">Win rate</th>
                    <th className="label-faint px-3 py-2.5 text-right">Total R</th>
                    <th className="label-faint px-3 py-2.5 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {byInstrument.map((g) => (
                    <tr key={g.key} className="border-b border-[var(--color-line)]/60 last:border-0">
                      <td className="px-3 py-2 font-medium">{g.key}</td>
                      <td className="figure px-3 py-2 text-right text-[var(--color-ink-dim)]">
                        {g.summary.trades}
                      </td>
                      <td className="figure px-3 py-2 text-right text-[var(--color-ink-mute)]">
                        {g.summary.independentExits}
                      </td>
                      <td className="figure px-3 py-2 text-right">
                        {g.summary.winRate.toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RMultiple value={g.summary.totalR} decimals={1} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={g.summary.netPl} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4 p-5">
            <CardHeader title="What the export contains" />
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
              One row per derived trade, with both day keys — London midnight and the
              broker&apos;s 17:00 New York roll — so a spreadsheet can reconcile against an
              OANDA statement without recomputing the boundary. Annotations travel with the
              row. A trade with no R exports as an empty cell rather than a zero, because a
              zero in a spreadsheet column quietly becomes a data point.
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
              Live and demo export separately and cannot be combined by any query string.
              That is the same rule the rest of the app follows, and it holds here too.
            </p>
          </Card>
        </>
      )}
    </>
  );
}

function PeriodTable({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: Array<{ key: unknown; summary: ReturnType<typeof summarise> }>;
  currency: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-3">
        <CardHeader title={title} />
      </div>
      <div className="max-h-[24rem] overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[var(--color-sunken)]">
            <tr className="border-b border-[var(--color-line)]">
              <th className="label-faint px-3 py-2.5 text-left">Period</th>
              <th className="label-faint px-3 py-2.5 text-right">Trades</th>
              <th className="label-faint px-3 py-2.5 text-right">Win</th>
              <th className="label-faint px-3 py-2.5 text-right">R</th>
              <th className="label-faint px-3 py-2.5 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr
                key={String(g.key)}
                className="border-b border-[var(--color-line)]/60 last:border-0"
              >
                <td className="px-3 py-2 text-[var(--color-ink-dim)]">{String(g.key)}</td>
                <td className="figure px-3 py-2 text-right text-[var(--color-ink-dim)]">
                  {g.summary.trades}
                </td>
                <td className="figure px-3 py-2 text-right">
                  {g.summary.winRate.toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right">
                  <RMultiple value={g.summary.totalR} decimals={1} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Money value={g.summary.netPl} currency={currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
