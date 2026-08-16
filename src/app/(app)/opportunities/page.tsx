import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { opportunities, patterns } from "@/lib/db/schema";
import { loadTrades } from "@/lib/analytics/load";
import { summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { OpportunityPanel, type OppRow } from "@/components/daily/OpportunityPanel";
import { DISPLAY_TZ, dayKey } from "@/lib/time";
import type { BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Best Opportunities.
 *
 * The list for a given day is the small part. The real output is the
 * three-way comparison across all days: what Peter spotted, what the engine
 * spotted, and what he actually traded. That measures SELECTION quality, which
 * no other screen touches — every other page measures execution, conditional on
 * a trade already having been taken.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  await requireSession();
  const user = await requireUser();
  const params = await searchParams;

  const today = dayKey(new Date(), DISPLAY_TZ);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : today;

  const [dayRows, allRows, patternRows, trades] = await Promise.all([
    db.select().from(opportunities).where(eq(opportunities.day, day)).orderBy(desc(opportunities.score)),
    db.select().from(opportunities).orderBy(desc(opportunities.day)).limit(2000),
    db.select().from(patterns),
    loadTrades({ userId: user.id }),
  ]);

  const patternName = new Map(patternRows.map((p) => [p.id, p.name]));

  const rows: OppRow[] = dayRows.map((o) => ({
    id: o.id,
    day: o.day,
    instrument: o.instrument,
    source: o.source as OppRow["source"],
    book: (o.book as BookId | null) ?? null,
    conviction: o.conviction,
    score: o.score,
    reasoning: o.reasoning,
    invalidation: o.invalidation,
    taken: o.taken,
    patternName: o.patternId ? (patternName.get(o.patternId) ?? null) : null,
  }));

  // ---- The comparison, over everything logged -----------------------------
  const bySource = (["spotted", "ai", "engine"] as const).map((src) => {
    const set = allRows.filter((o) => o.source === src);
    const taken = set.filter((o) => o.taken);
    return { source: src, logged: set.length, taken: taken.length };
  });

  const daysWithOpps = new Set(allRows.map((o) => o.day));
  const tradedDays = new Set(
    trades.filter((t) => t.exitTime).map((t) => dayKey(t.exitTime!, DISPLAY_TZ)),
  );

  // Days where trades happened but nothing was logged. That gap is the honest
  // limit on every conclusion this screen could draw.
  const unlogged = [...tradedDays].filter((d) => !daysWithOpps.has(d)).length;

  const takenR = summarise(
    trades.filter((t) => {
      const d = t.exitTime ? dayKey(t.exitTime, DISPLAY_TZ) : null;
      return d !== null && daysWithOpps.has(d);
    }),
  );

  const recentDays = [...new Set(allRows.map((o) => o.day))].slice(0, 8);

  return (
    <>
      <PageHeader
        title="Best Opportunities"
        subtitle={`${day}${day === today ? " · today" : ""} · ${rows.length} logged`}
        action={
          <Link
            href="/pre-market"
            className="rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
          >
            Today&apos;s plan
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="label-faint mr-1">Day</span>
        {[...new Set([today, ...recentDays])].slice(0, 8).map((d) => (
          <Link
            key={d}
            href={`/opportunities?day=${d}`}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              d === day
                ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "border-[var(--color-line)] text-[var(--color-ink-dim)]",
            )}
          >
            {d === today ? "Today" : d}
          </Link>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {bySource.map((b) => (
          <StatTile
            key={b.source}
            label={
              b.source === "spotted" ? "You spotted" : b.source === "ai" ? "AI proposed" : "Engine fired"
            }
            value={<span className="figure">{b.logged}</span>}
            sub={
              b.logged
                ? `${b.taken} taken · ${((b.taken / b.logged) * 100).toFixed(0)}%`
                : "none logged"
            }
          />
        ))}
        <StatTile
          label="Days with a log"
          value={<span className="figure">{daysWithOpps.size}</span>}
        />
        <StatTile
          label="Traded, nothing logged"
          value={
            <span className={clsx("figure", unlogged ? "text-[var(--color-warn)]" : undefined)}>
              {unlogged}
            </span>
          }
          sub="days"
        />
        <StatTile
          label="R on logged days"
          value={<RMultiple value={takenR.totalR} decimals={1} />}
          sub={`${takenR.trades} trades`}
        />
      </div>

      {unlogged > 0 && (
        <div className="mb-4 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
          <p className="text-xs leading-relaxed text-[var(--color-warn)]">
            <strong>{unlogged} days have trades but no logged candidates.</strong> The
            comparison below only covers days where something was written down, and those
            days are not a random sample — they are the ones you had time to log, which
            probably means the calmer ones. Worth knowing before drawing a conclusion from
            it.
          </p>
        </div>
      )}

      <OpportunityPanel day={day} rows={rows} />

      <Card className="mt-4 p-5">
        <CardHeader title="What this screen is for" />
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
          Every other analytics screen measures execution — how well trades that were
          already taken went. This one measures <strong>selection</strong>: of everything
          that looked tradeable, which ones did you pick, and would the ones you passed on
          have done better?
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
          That comparison only works if the ones you <em>didn&apos;t</em> take get logged
          too. A list containing only the trades you took is a trade log, and there is
          already one of those.
        </p>
      </Card>
    </>
  );
}
