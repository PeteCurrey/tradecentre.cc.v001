import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { dailyPlans, dailyReviews, patterns, stateLogs } from "@/lib/db/schema";
import { accountCurrency, loadTrades } from "@/lib/analytics/load";
import { summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { ReviewForm, type ReviewData } from "@/components/daily/ReviewForm";
import { StateForm, type StateData } from "@/components/daily/StateForm";
import { DISPLAY_TZ, dayKey, formatDate, formatTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * End of Day Review.
 *
 * The plan written this morning is shown beside the trades actually taken, so
 * "did I trade my plan" is answered by looking rather than by remembering.
 * Everything numeric comes from the ledger; everything written comes from
 * Peter. Neither can overwrite the other.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  await requireSession();
  const user = await requireUser();
  const params = await searchParams;

  const today = dayKey(new Date(), DISPLAY_TZ);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : today;


  const [reviewRows, planRows, stateRows, patternRows, allTrades, currency, recent] =
    await Promise.all([
      db.select().from(dailyReviews).where(eq(dailyReviews.day, day)),
      db.select().from(dailyPlans).where(eq(dailyPlans.day, day)),
      db.select().from(stateLogs).where(eq(stateLogs.day, day)),
      db.select().from(patterns),
      loadTrades({ userId: user.id }),
      accountCurrency(user.id),
      db.select({ day: dailyReviews.day }).from(dailyReviews).orderBy(desc(dailyReviews.day)).limit(8),
    ]);

  // Trades that CLOSED on this day — the day's realised result.
  const dayTrades = allTrades.filter(
    (t) => t.exitTime && dayKey(t.exitTime, DISPLAY_TZ) === day,
  );
  const s = summarise(dayTrades);

  const review: ReviewData = {
    day,
    processGrade: reviewRows[0]?.processGrade ?? null,
    adherencePct: reviewRows[0]?.adherencePct ?? null,
    whatWorked: reviewRows[0]?.whatWorked ?? null,
    whatBroke: reviewRows[0]?.whatBroke ?? null,
    tomorrow: reviewRows[0]?.tomorrow ?? null,
    notes: reviewRows[0]?.notes ?? null,
    aiDraft: reviewRows[0]?.aiDraft ?? null,
  };

  const state: StateData = {
    day,
    sleep: stateRows[0]?.sleep ?? null,
    energy: stateRows[0]?.energy ?? null,
    focus: stateRows[0]?.focus ?? null,
    emotionPre: stateRows[0]?.emotionPre ?? null,
    emotionDuring: stateRows[0]?.emotionDuring ?? null,
    emotionPost: stateRows[0]?.emotionPost ?? null,
    tiltMarkers: stateRows[0]?.tiltMarkers ?? [],
    notes: stateRows[0]?.notes ?? null,
  };

  const plan = planRows[0];
  const planned = new Set((plan?.setupsHunted as number[]) ?? []);
  const patternName = new Map(patternRows.map((p) => [p.id, p.name]));

  // Did the day's trades match the setups named this morning? Answerable only
  // for tagged trades, so the count of untagged ones is stated alongside.
  const taggedToday = dayTrades.filter((t) => t.patternId !== null);
  const offPlan = taggedToday.filter((t) => !planned.has(t.patternId!));

  return (
    <>
      <PageHeader
        title="End of Day"
        subtitle={`${formatDate(new Date(`${day}T12:00:00Z`))}${day === today ? " · today" : ""}`}
        action={
          <Link
            href={`/pre-market?day=${day}`}
            className="rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
          >
            This morning&apos;s plan
          </Link>
        }
      />

      {recent.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="label-faint mr-1">Review for</span>
          {[...new Set([today, ...recent.map((r) => r.day)])].slice(0, 8).map((d) => (
            <Link
              key={d}
              href={`/review?day=${d}`}
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

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Closed today"
          value={<span className="figure">{s.trades}</span>}
          sub={`${s.independentExits} independent`}
        />
        <StatTile label="R" value={<RMultiple value={s.totalR} decimals={2} />} />
        <StatTile label="Net" value={<Money value={s.netPl} currency={currency} />} />
        <StatTile
          label="Win rate"
          value={<span className="figure">{s.trades ? `${s.winRate.toFixed(0)}%` : "—"}</span>}
          sub={s.trades ? `${s.wins}W / ${s.losses}L` : undefined}
        />
        <StatTile
          label="Setups planned"
          value={<span className="figure">{planned.size}</span>}
        />
        <StatTile
          label="Off-plan trades"
          value={
            <span
              className={clsx("figure", offPlan.length ? "text-[var(--color-warn)]" : undefined)}
            >
              {offPlan.length}
            </span>
          }
          sub={
            taggedToday.length < dayTrades.length
              ? `${dayTrades.length - taggedToday.length} untagged`
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ReviewForm review={review} />
          <StateForm state={state} />
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader title="The plan, as written this morning" />
            {!plan ? (
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-mute)]">
                No plan was written for {day}. Nothing is filled in here after the fact —
                a plan reconstructed at review time is a rationalisation, and comparing
                trades against it would prove nothing.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {Object.entries((plan.bias as Record<string, string>) ?? {}).length > 0 && (
                  <div>
                    <span className="label-faint">Bias</span>
                    <ul className="mt-1 space-y-0.5">
                      {Object.entries(plan.bias as Record<string, string>).map(([k, v]) => (
                        <li key={k} className="text-xs text-[var(--color-ink-dim)]">
                          <span className="font-medium">{k}</span> — {v}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {planned.size > 0 && (
                  <div>
                    <span className="label-faint">Setups hunted</span>
                    <ul className="mt-1 space-y-0.5">
                      {[...planned].map((id) => (
                        <li key={id} className="text-xs text-[var(--color-ink-dim)]">
                          {patternName.get(id) ?? `#${id}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan.notes && (
                  <div>
                    <span className="label-faint">Notes</span>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-ink-dim)]">
                      {plan.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <CardHeader title="Trades closed today" />
            {dayTrades.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                Nothing closed on {day}.
              </p>
            ) : (
              <div className="mt-3 space-y-1">
                {dayTrades
                  .sort((a, b) => (a.exitTime!.getTime() - b.exitTime!.getTime()))
                  .slice(0, 30)
                  .map((t) => (
                    <Link
                      key={t.id}
                      href={`/trades/${t.id}`}
                      className="flex items-center justify-between gap-2 rounded px-1 py-1 text-[13px] hover:bg-[var(--color-card-raised)]"
                    >
                      <span className="flex items-center gap-2">
                        <span className="figure text-[11px] text-[var(--color-ink-faint)]">
                          {formatTime(t.exitTime!)}
                        </span>
                        <span>{t.instrument}</span>
                        {t.patternId && !planned.has(t.patternId) && (
                          <span className="rounded bg-[var(--color-warn-wash)] px-1 text-[9px] font-bold uppercase text-[var(--color-warn)]">
                            off plan
                          </span>
                        )}
                      </span>
                      {t.rMultiple !== null ? (
                        <RMultiple value={t.rMultiple} />
                      ) : (
                        <Money value={t.realizedPl} currency={currency} />
                      )}
                    </Link>
                  ))}
                {dayTrades.length > 30 && (
                  <p className="pt-1 text-[11px] text-[var(--color-ink-faint)]">
                    +{dayTrades.length - 30} more
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
