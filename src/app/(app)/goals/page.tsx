import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { dailyReviews, goals as goalsTable } from "@/lib/db/schema";
import { loadTrades } from "@/lib/analytics/load";
import { PageHeader } from "@/components/ui/Page";
import { StatTile } from "@/components/ui/Card";
import { GoalsPanel, type GoalRow } from "@/components/goals/GoalsPanel";
import { currentPeriods, inPeriod, scoreGoal, type GoalMetric } from "@/lib/goals/score";
import { DISPLAY_TZ, dayKey } from "@/lib/time";
import type { BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  await requireSession();

  const [rows, trades, reviews] = await Promise.all([
    db.select().from(goalsTable).orderBy(desc(goalsTable.period)),
    loadTrades({}),
    db.select().from(dailyReviews),
  ]);

  const closed = trades.filter((t) => t.exitTime !== null);

  const scored: GoalRow[] = rows.map((g) => {
    const inScope = closed.filter(
      (t) =>
        inPeriod(g.period, dayKey(t.exitTime!, DISPLAY_TZ)) &&
        (g.book ? t.book === g.book : true),
    );
    const adherence = reviews
      .filter((r) => inPeriod(g.period, r.day) && r.adherencePct !== null)
      .map((r) => r.adherencePct!);

    return {
      id: g.id,
      period: g.period,
      metric: g.metric as GoalMetric,
      target: Number(g.target),
      book: (g.book as BookId | null) ?? null,
      note: g.note,
      progress: scoreGoal(g.metric as GoalMetric, Number(g.target), inScope, adherence),
    };
  });

  const periods = currentPeriods(dayKey(new Date(), DISPLAY_TZ));
  const met = scored.filter((g) => g.progress.met).length;
  const measurable = scored.filter((g) => g.progress.actual !== null).length;

  return (
    <>
      <PageHeader
        title="Goals"
        subtitle={`${scored.length} goals · ${met} met · ${scored.length - measurable} with no data yet`}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Goals set" value={<span className="figure">{scored.length}</span>} />
        <StatTile
          label="Met"
          value={
            <span className={clsx("figure", met ? "text-[var(--color-accent)]" : undefined)}>
              {met}
            </span>
          }
        />
        <StatTile
          label="Measurable"
          value={<span className="figure">{measurable}</span>}
          sub="have trades in the period"
        />
        <StatTile
          label="This month"
          value={
            <span className="figure">
              {scored.filter((g) => g.period === periods.month).length}
            </span>
          }
          sub={periods.month}
        />
      </div>

      <GoalsPanel goals={scored} periods={periods} />
    </>
  );
}
