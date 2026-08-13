import Link from "next/link";
import { asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { dailyPlans, macroEvents, patterns, watchlistLevels } from "@/lib/db/schema";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { PlanForm, type PlanData } from "@/components/daily/PlanForm";
import { DISPLAY_TZ, activeSessions, dayKey, formatDate, formatTime, isPrimeOverlap } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Pre-Market Game Plan.
 *
 * Written BEFORE the session, which is the entire value — a plan recorded
 * afterwards is a rationalisation. Naming the setups being hunted in advance is
 * what makes "traded outside the plan" a checkable fact at review time rather
 * than a feeling.
 */
export default async function PreMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  // Read the clock once, at the top, so every derived window in this render
  // agrees with itself.
  const now = new Date();
  const today = dayKey(now, DISPLAY_TZ);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : today;

  const [existing, patternRows, levels, events] = await Promise.all([
    db.select().from(dailyPlans).where(eq(dailyPlans.day, day)),
    db.select().from(patterns).orderBy(asc(patterns.name)),
    db.select().from(watchlistLevels).where(eq(watchlistLevels.active, true)),
    db
      .select()
      .from(macroEvents)
      .where(gte(macroEvents.time, new Date(now.getTime() - 6 * 3600_000)))
      .orderBy(asc(macroEvents.time))
      .limit(12),
  ]);

  const row = existing[0];
  const plan: PlanData = {
    day,
    bias: (row?.bias as Record<string, string>) ?? {},
    levels: (row?.levels as Record<string, number[]>) ?? {},
    setupsHunted: (row?.setupsHunted as number[]) ?? [],
    notes: row?.notes ?? null,
    aiDraft: row?.aiDraft ?? null,
  };

  const open = activeSessions(now);
  const overlap = isPrimeOverlap(now);

  // Recent plans, so yesterday's is one click away rather than lost.
  const recent = await db
    .select({ day: dailyPlans.day })
    .from(dailyPlans)
    .orderBy(desc(dailyPlans.day))
    .limit(8);

  return (
    <>
      <PageHeader
        title="Pre-Market"
        subtitle={`${formatDate(new Date(`${day}T12:00:00Z`))}${day === today ? " · today" : ""}`}
        action={
          <span className="label-faint">
            {open.length ? `${open.map((s) => s.label).join(" · ")} open` : "markets closed"}
          </span>
        }
      />

      {recent.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="label-faint mr-1">Plan for</span>
          {[...new Set([today, ...recent.map((r) => r.day)])].slice(0, 8).map((d) => (
            <Link
              key={d}
              href={`/pre-market?day=${d}`}
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
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Sessions open"
          value={
            <span className="figure text-[var(--color-accent)]">{open.length}</span>
          }
          sub={open.map((s) => s.label).join(", ") || "none"}
        />
        <StatTile
          label="Prime overlap"
          value={
            <span
              className={clsx(
                "figure",
                overlap ? "text-[var(--color-accent)]" : "text-[var(--color-ink-mute)]",
              )}
            >
              {overlap ? "live" : "no"}
            </span>
          }
          sub="London / New York"
        />
        <StatTile
          label="Levels tracked"
          value={<span className="figure">{levels.length}</span>}
          sub={`${new Set(levels.map((l) => l.instrument)).size} instruments`}
        />
        <StatTile
          label="Setups hunted"
          value={<span className="figure">{plan.setupsHunted.length}</span>}
        />
      </div>

      <PlanForm
        plan={plan}
        patterns={patternRows.map((p) => ({ id: p.id, name: p.name, status: p.status }))}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            title="Events due"
            action={
              <Link href="/market-context" className="label-faint hover:text-[var(--color-accent)]">
                Market context
              </Link>
            }
          />
          {events.length === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-mute)]">
              No cached macro events. The calendar is populated from the FRED release
              schedule and EIA inventory dates — refresh it on Market Context. Nothing is
              shown here speculatively, because a made-up event beside a real plan is worse
              than an empty panel.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-3 border-b border-[var(--color-line)]/60 pb-1.5 last:border-0"
                >
                  <div>
                    <span className="text-[13px]">{e.title}</span>
                    <span className="ml-2 label-faint">{e.source}</span>
                  </div>
                  <span className="figure shrink-0 text-xs text-[var(--color-ink-mute)]">
                    {formatTime(e.time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Active levels"
            action={
              <Link href="/watchlist" className="label-faint hover:text-[var(--color-accent)]">
                Watchlist
              </Link>
            }
          />
          {levels.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
              No levels marked. Add them on the watchlist and they show up here each
              morning.
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {levels.slice(0, 14).map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 text-[13px]"
                >
                  <span className="text-[var(--color-ink-dim)]">
                    {l.instrument}
                    {l.label && (
                      <span className="ml-2 text-[11px] text-[var(--color-ink-faint)]">
                        {l.label}
                      </span>
                    )}
                  </span>
                  <span className="figure text-xs">{Number(l.price)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
