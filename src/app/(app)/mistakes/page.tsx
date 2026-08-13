import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { activeEnvironment, accountCurrency, loadTrades } from "@/lib/analytics/load";
import { summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BarRows } from "@/components/charts/Plot";
import { BookFilter, NoTrades, PracticeNote } from "@/components/analytics/Shared";
import { BOOK_IDS } from "@/lib/books";
import {
  MISTAKE_CATEGORIES,
  PROCESS_GRADES,
  mistakeCategory,

} from "@/lib/journal/taxonomy";

export const dynamic = "force-dynamic";

/**
 * Mistakes & Leaks.
 *
 * Each error is costed in R so leaks rank by what they cost rather than by how
 * bad they feel — which reliably reorders the list. The frequent mistakes are
 * usually entry mistakes; the expensive ones are usually exit mistakes.
 *
 * One caveat is stated on the screen rather than buried: attributing a trade's
 * full result to a tagged mistake OVERSTATES the cost, because the trade might
 * have lost anyway. It is an upper bound on the leak, not a measurement of it.
 */
export default async function MistakesPage({
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

  const annotated = trades.filter((t) => t.mistakes.length > 0 || t.processGrade !== null);
  const withMistakes = trades.filter((t) => t.mistakes.length > 0);
  const clean = trades.filter((t) => t.processGrade !== null && t.mistakes.length === 0);

  // Per-tag cost. A trade carrying three tags contributes its result to all
  // three, so the column sums to more than the total damage — deliberate, and
  // labelled, because splitting the cost between tags would be a guess.
  const tagRows = MISTAKE_CATEGORIES.flatMap((c) => c.items).map((m) => {
    const set = trades.filter((t) => t.mistakes.includes(m.id));
    const s = summarise(set);
    return { id: m.id, label: m.label, n: set.length, r: s.totalR, pl: s.netPl };
  });

  const byCategory = MISTAKE_CATEGORIES.map((c) => {
    const set = trades.filter((t) => t.mistakes.some((m) => mistakeCategory(m) === c.id));
    const s = summarise(set);
    return { ...c, n: set.length, r: s.totalR, pl: s.netPl };
  });

  const byGrade = PROCESS_GRADES.map((g) => {
    const set = trades.filter((t) => t.processGrade === g.id);
    const s = summarise(set);
    return { ...g, n: set.length, summary: s };
  }).filter((g) => g.n > 0);

  const cleanSummary = summarise(clean);
  const dirtySummary = summarise(withMistakes);

  const mostFrequent = [...tagRows].filter((t) => t.n > 0).sort((a, b) => b.n - a.n);
  const mostExpensive = [...tagRows].filter((t) => t.n > 0).sort((a, b) => a.r - b.r);

  return (
    <>
      <PageHeader
        title="Mistakes &amp; Leaks"
        subtitle={`${withMistakes.length} of ${trades.length} closed trades carry a mistake tag`}
      />
      <BookFilter base="/mistakes" active={book} />
      <PracticeNote environment={environment} />

      {trades.length === 0 ? (
        <NoTrades what="No closed trades in this book yet." />
      ) : annotated.length === 0 ? (
        <Card className="p-8">
          <h2 className="label">Nothing is annotated yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
            Mistake tags and process grades come from you, not from the broker — there is
            no way to derive &ldquo;chased the entry&rdquo; from a fill price. Until trades
            are annotated on the trade detail screen this page has nothing real to show,
            and inventing a leak profile would be worse than an empty screen.
          </p>
          <div className="mt-4">
            <span className="label-faint">The taxonomy waiting to be used</span>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MISTAKE_CATEGORIES.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] p-3"
                >
                  <span className="text-xs font-semibold text-[var(--color-ink)]">
                    {c.label}
                  </span>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                    {c.hint}
                  </p>
                  <ul className="mt-2 space-y-0.5">
                    {c.items.map((i) => (
                      <li key={i.id} className="text-[11px] text-[var(--color-ink-mute)]">
                        {i.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <Link
            href="/trades"
            className="mt-4 inline-block rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
          >
            Go and annotate some trades
          </Link>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Tagged trades"
              value={<span className="figure">{withMistakes.length}</span>}
              sub={`${((withMistakes.length / trades.length) * 100).toFixed(0)}% of closed`}
            />
            <StatTile
              label="R on tagged trades"
              value={<RMultiple value={dirtySummary.totalR} decimals={1} />}
              sub="upper bound on the leak"
            />
            <StatTile
              label="Cash on tagged trades"
              value={<Money value={dirtySummary.netPl} currency={currency} />}
            />
            <StatTile
              label="Clean trades"
              value={<span className="figure">{clean.length}</span>}
              sub="graded, no mistake tagged"
            />
            <StatTile
              label="Clean expectancy"
              value={
                cleanSummary.expectancyR === null ? (
                  <span className="text-[var(--color-ink-faint)]">—</span>
                ) : (
                  <RMultiple value={cleanSummary.expectancyR} />
                )
              }
            />
            <StatTile
              label="Tagged expectancy"
              value={
                dirtySummary.expectancyR === null ? (
                  <span className="text-[var(--color-ink-faint)]">—</span>
                ) : (
                  <RMultiple value={dirtySummary.expectancyR} />
                )
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader title="Most expensive" action={<span className="label-faint">by R</span>} />
              <div className="mt-3">
                <BarRows
                  rows={mostExpensive.slice(0, 10).map((t) => ({
                    label: t.label,
                    value: t.r,
                    sub: `${t.n}`,
                  }))}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                />
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader title="Most frequent" action={<span className="label-faint">by count</span>} />
              <div className="mt-3">
                <BarRows
                  rows={mostFrequent.slice(0, 10).map((t) => ({
                    label: t.label,
                    value: t.n,
                  }))}
                  format={(v) => `${v.toFixed(0)}`}
                  money={false}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                These two lists rarely match. Entry mistakes are usually the most frequent;
                exit mistakes are usually the most expensive. Fixing the frequent one feels
                more productive and is worth less.
              </p>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader title="By category" />
              <div className="mt-3 space-y-2">
                {byCategory
                  .filter((c) => c.n > 0)
                  .sort((a, b) => a.r - b.r)
                  .map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{c.label}</span>
                        <span className="flex items-center gap-3">
                          <span className="figure text-xs text-[var(--color-ink-dim)]">
                            {c.n}
                          </span>
                          <RMultiple value={c.r} decimals={1} />
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                        {c.hint}
                      </p>
                    </div>
                  ))}
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader title="Process grade vs outcome" />
              {byGrade.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                  No trades graded yet.
                </p>
              ) : (
                <>
                  <table className="mt-3 w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--color-line)]">
                        <th className="label-faint py-2 text-left">Grade</th>
                        <th className="label-faint py-2 text-right">Trades</th>
                        <th className="label-faint py-2 text-right">Win rate</th>
                        <th className="label-faint py-2 text-right">Expectancy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byGrade.map((g) => (
                        <tr
                          key={g.id}
                          className="border-b border-[var(--color-line)]/60 last:border-0"
                        >
                          <td className="py-2">
                            <span className="font-semibold">{g.label}</span>
                            <span className="ml-2 text-[11px] text-[var(--color-ink-faint)]">
                              {g.hint}
                            </span>
                          </td>
                          <td className="figure py-2 text-right text-[var(--color-ink-dim)]">
                            {g.n}
                          </td>
                          <td className="figure py-2 text-right">
                            {g.summary.winRate.toFixed(0)}%
                          </td>
                          <td className="py-2 text-right">
                            {g.summary.expectancyR === null ? (
                              <span className="text-[var(--color-ink-faint)]">—</span>
                            ) : (
                              <RMultiple value={g.summary.expectancyR} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                    Grade is process, outcome is result, and they are deliberately
                    independent. A well-executed loser is still an A. If the expectancy
                    column does not descend with the grade, either the grading is generous
                    or the plan being followed is the problem.
                  </p>
                </>
              )}
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <CardHeader title="What these numbers are not" />
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
              A tagged trade&apos;s full result is attributed to every tag it carries, so
              the per-tag column sums to more than the total damage and each figure is an{" "}
              <strong>upper bound on the leak, not a measurement of it</strong>. The trade
              might well have lost anyway; splitting the cost between three tags would be a
              guess dressed up as arithmetic. Read the ranking, not the absolute values.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
