import { requireSession } from "@/lib/auth/guard";
import { activeEnvironment, accountCurrency, loadTrades } from "@/lib/analytics/load";
import { groupBy, summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BarRows } from "@/components/charts/Plot";
import { BookFilter, ClusterNote, NoTrades, PracticeNote } from "@/components/analytics/Shared";
import { BOOK_IDS } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Instrument Analysis, including correlation exposure.
 *
 * The correlation section is the part that earns the screen. Four separate
 * long positions in EURUSD, GBPUSD, AUDUSD and XAUUSD look like four
 * independent risks on the Live Desk and are, in practice, close to one bet on
 * the dollar. Sizing each at 1R gives 4R of correlated exposure while every
 * per-trade check reads as compliant.
 *
 * Groupings are declared from the instrument names rather than measured from
 * returns, and that limitation is stated on the screen: a static grouping
 * cannot know that gold traded like a risk asset last week.
 */

/** Declared exposure families. Deliberately coarse — precision here would be false. */
const FAMILIES: Array<{ id: string; label: string; test: (i: string) => boolean }> = [
  { id: "usd", label: "USD", test: (i) => i.includes("USD") },
  { id: "eur", label: "EUR", test: (i) => i.includes("EUR") },
  { id: "gbp", label: "GBP", test: (i) => i.includes("GBP") },
  { id: "jpy", label: "JPY", test: (i) => i.includes("JPY") },
  { id: "metals", label: "Precious metals", test: (i) => /^X(AU|AG|PT|PD)/.test(i) },
  {
    id: "indices",
    label: "Equity indices",
    test: (i) => /(SPX|NAS|US30|US2000|UK100|DE3|DE4|JP225|EU50|HK33|AUS200)/.test(i),
  },
  { id: "energy", label: "Energy", test: (i) => /(WTICO|BCO|NATGAS)/.test(i) },
];

export default async function InstrumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);

  const [all, currency, environment] = await Promise.all([
    loadTrades({ book, includeOpen: true }),
    accountCurrency(),
    activeEnvironment(),
  ]);

  const closed = all.filter((t) => t.exitTime !== null);
  const open = all.filter((t) => t.exitTime === null);
  const s = summarise(closed);

  const byInstrument = groupBy(closed, (t) => t.instrument).sort(
    (a, b) => b.summary.totalR - a.summary.totalR,
  );

  // Exposure counts OPEN positions, because correlation is a live risk question
  // rather than a historical one.
  const families = FAMILIES.map((f) => {
    const positions = open.filter((t) => f.test(t.instrument));
    const historical = closed.filter((t) => f.test(t.instrument));
    return {
      ...f,
      open: positions.length,
      instruments: [...new Set(positions.map((p) => p.instrument))],
      historicalR: summarise(historical).totalR,
      historicalN: historical.length,
    };
  }).filter((f) => f.open > 0 || f.historicalN > 0);

  const concentrated = families.filter((f) => f.open >= 2);

  return (
    <>
      <PageHeader
        title="Instruments"
        subtitle={`${byInstrument.length} instruments traded · ${open.length} open`}
      />
      <BookFilter base="/instruments" active={book} />
      <PracticeNote environment={environment} />

      {all.length === 0 ? (
        <NoTrades what="No trades in this book yet." />
      ) : (
        <>
          <ClusterNote trades={s.trades} independentExits={s.independentExits} />

          {concentrated.length > 0 && (
            <div className="mb-4 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
              <p className="text-xs leading-relaxed text-[var(--color-warn)]">
                <strong>Correlated exposure right now:</strong>{" "}
                {concentrated
                  .map((f) => `${f.open} positions with ${f.label} in them`)
                  .join("; ")}
                . Each of those may be sized at 1R individually while behaving as one
                larger bet — the per-trade risk check cannot see this, which is why it is
                stated here.
              </p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="overflow-hidden">
              <div className="p-5 pb-3">
                <CardHeader title="Per instrument" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                      <th className="label-faint px-3 py-2.5 text-left">Instrument</th>
                      <th className="label-faint px-3 py-2.5 text-right">Trades</th>
                      <th className="label-faint px-3 py-2.5 text-right">Exits</th>
                      <th className="label-faint px-3 py-2.5 text-right">Win rate</th>
                      <th className="label-faint px-3 py-2.5 text-right">Expectancy</th>
                      <th className="label-faint px-3 py-2.5 text-right">Total R</th>
                      <th className="label-faint px-3 py-2.5 text-right">Net</th>
                      <th className="label-faint px-3 py-2.5 text-right">Spread</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byInstrument.map((g) => {
                      const thin = g.summary.independentExits < 5;
                      return (
                        <tr
                          key={g.key}
                          className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-card-raised)]"
                        >
                          <td className="px-3 py-2 font-medium">{g.key}</td>
                          <td className="figure px-3 py-2 text-right text-[var(--color-ink-dim)]">
                            {g.summary.trades}
                          </td>
                          <td
                            className={clsx(
                              "figure px-3 py-2 text-right",
                              thin ? "text-[var(--color-warn)]" : "text-[var(--color-ink-mute)]",
                            )}
                            title={
                              thin
                                ? "Too few independent exits to read anything into this row"
                                : undefined
                            }
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
                          <td className="figure px-3 py-2 text-right text-[var(--color-warn)]">
                            {g.summary.spreadPaid.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-xs text-[var(--color-ink-faint)]">
                Rows where the independent-exit count is in orange have fewer than five
                genuinely separate outcomes. Their win rate and expectancy are arithmetic,
                not evidence.
              </p>
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <CardHeader title="Live exposure by family" />
                {families.filter((f) => f.open > 0).length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                    Nothing open, so no correlated exposure to report.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {families
                      .filter((f) => f.open > 0)
                      .sort((a, b) => b.open - a.open)
                      .map((f) => (
                        <div
                          key={f.id}
                          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-[var(--color-ink-dim)]">
                              {f.label}
                            </span>
                            <span
                              className={clsx(
                                "figure text-sm",
                                f.open >= 2 ? "text-[var(--color-warn)]" : undefined,
                              )}
                            >
                              {f.open}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-[var(--color-ink-faint)]">
                            {f.instruments.join(" · ")}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                  Families are declared from instrument names, not measured from returns.
                  That is a real limitation: a static grouping cannot know that gold traded
                  like a risk asset last week, or that two &ldquo;uncorrelated&rdquo; pairs
                  moved together all month.
                </p>
              </Card>

              <Card className="p-5">
                <CardHeader title="Historical R by family" />
                <div className="mt-3">
                  <BarRows
                    rows={families
                      .filter((f) => f.historicalN > 0)
                      .sort((a, b) => b.historicalR - a.historicalR)
                      .map((f) => ({
                        label: f.label,
                        value: f.historicalR,
                        sub: `${f.historicalN}`,
                      }))}
                    format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                  />
                </div>
              </Card>

              <Card className="p-5">
                <CardHeader title="Concentration" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatTile
                    label="Instruments"
                    value={<span className="figure">{byInstrument.length}</span>}
                  />
                  <StatTile
                    label="Top instrument share"
                    value={
                      <span className="figure">
                        {byInstrument.length
                          ? `${((byInstrument[0].summary.trades / closed.length) * 100).toFixed(0)}%`
                          : "—"}
                      </span>
                    }
                    sub={byInstrument[0]?.key}
                  />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
