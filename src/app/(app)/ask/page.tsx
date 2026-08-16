import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { aiRuns } from "@/lib/db/schema";
import { loadTrades } from "@/lib/analytics/load";
import { env } from "@/lib/env";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { AskPanel } from "@/components/ai/AskPanel";
import { DEFAULT_MODEL } from "@/lib/ai/router";
import { formatDateTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  await requireSession();
  const user = await requireUser();

  const [trades, runs, totals] = await Promise.all([
    loadTrades({ userId: user.id }),
    db.select().from(aiRuns).orderBy(desc(aiRuns.createdAt)).limit(20),
    db
      .select({
        n: sql<number>`count(*)::int`,
        spend: sql<string>`coalesce(sum(${aiRuns.costUsd}), 0)`,
        failures: sql<number>`count(*) filter (where not ${aiRuns.ok})::int`,
      })
      .from(aiRuns),
  ]);

  const closed = trades.filter((t) => t.exitTime !== null);
  const hasKey = Boolean(env().ANTHROPIC_API_KEY);
  const spend = Number(totals[0]?.spend ?? 0);

  return (
    <>
      <PageHeader
        title="Ask"
        subtitle={`Question ${closed.length} closed trades in plain English`}
        action={<span className="label-faint">{DEFAULT_MODEL}</span>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Total AI spend"
          value={<span className="figure">${spend.toFixed(4)}</span>}
          sub="all tasks, all time"
        />
        <StatTile label="Calls" value={<span className="figure">{totals[0]?.n ?? 0}</span>} />
        <StatTile
          label="Failed"
          value={
            <span
              className={clsx(
                "figure",
                (totals[0]?.failures ?? 0) > 0 ? "text-[var(--color-warn)]" : undefined,
              )}
            >
              {totals[0]?.failures ?? 0}
            </span>
          }
        />
        <StatTile
          label="Trades in scope"
          value={<span className="figure">{closed.length}</span>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <AskPanel trades={closed.length} hasKey={hasKey} />

        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader title="Recent calls" />
            {runs.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                Nothing yet. Every call lands here with its token count and cost.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {runs.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 border-b border-[var(--color-line)]/60 pb-1.5 text-xs last:border-0"
                  >
                    <span className="text-[var(--color-ink-dim)]">
                      {r.task}
                      {!r.ok && (
                        <span className="ml-1.5 text-[var(--color-warn)]">failed</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-[var(--color-ink-faint)]">
                      <span className="figure">
                        {r.costUsd ? `$${Number(r.costUsd).toFixed(4)}` : "—"}
                      </span>
                      <span>{formatDateTime(r.createdAt)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <CardHeader title="What this can and cannot do" />
            <ul className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
              <li>
                <strong>Can:</strong> describe what your record shows — where the money went,
                which figures are too thin to trust, what the drawdowns looked like.
              </li>
              <li>
                <strong>Cannot:</strong> compute anything new. It is given
                already-calculated figures and told not to do arithmetic, because a language
                model summing a few hundred numbers is exactly how a plausible wrong answer
                gets into a trading journal.
              </li>
              <li>
                <strong>Will not:</strong> tell you what to trade or how much to risk. It
                describes history; the decisions stay yours.
              </li>
              <li>
                The brief it received is shown under every answer. If a reply looks wrong,
                its input is one click away.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
