import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { stateLogs } from "@/lib/db/schema";
import { loadTrades } from "@/lib/analytics/load";
import { summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BarRows } from "@/components/charts/Plot";
import { StateForm, TILT_MARKERS, type StateData } from "@/components/daily/StateForm";
import { DISPLAY_TZ, dayKey } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Psychology & State.
 *
 * The point is not the diary — it is the join between how a day felt and what
 * it made. That join is only meaningful once there are enough logged days to
 * compare, so the screen says how many there are and refuses to draw a
 * conclusion from three.
 */
const MIN_DAYS_FOR_A_CLAIM = 10;

export default async function PsychologyPage() {
  await requireSession();

  const today = dayKey(new Date(), DISPLAY_TZ);

  const [logs, todayRows, trades] = await Promise.all([
    db.select().from(stateLogs).orderBy(desc(stateLogs.day)).limit(180),
    db.select().from(stateLogs).where(eq(stateLogs.day, today)),
    loadTrades({}),
  ]);

  const state: StateData = {
    day: today,
    sleep: todayRows[0]?.sleep ?? null,
    energy: todayRows[0]?.energy ?? null,
    focus: todayRows[0]?.focus ?? null,
    emotionPre: todayRows[0]?.emotionPre ?? null,
    emotionDuring: todayRows[0]?.emotionDuring ?? null,
    emotionPost: todayRows[0]?.emotionPost ?? null,
    tiltMarkers: todayRows[0]?.tiltMarkers ?? [],
    notes: todayRows[0]?.notes ?? null,
  };

  // Day-level results, keyed the same way the state log is.
  const byDay = new Map<string, typeof trades>();
  for (const t of trades) {
    if (!t.exitTime) continue;
    const k = dayKey(t.exitTime, DISPLAY_TZ);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }

  const joined = logs
    .map((l) => ({ log: l, trades: byDay.get(l.day) ?? [] }))
    .filter((j) => j.trades.length > 0);

  const enough = joined.length >= MIN_DAYS_FOR_A_CLAIM;

  /** Mean R per trading day, split by a 1–5 rating. */
  const byRating = (pick: (l: (typeof logs)[number]) => number | null) => {
    const buckets = [1, 2, 3, 4, 5].map((n) => {
      const set = joined.filter((j) => pick(j.log) === n);
      const all = set.flatMap((j) => j.trades);
      const s = summarise(all);
      return { rating: n, days: set.length, r: s.totalR, perDay: set.length ? s.totalR / set.length : 0 };
    });
    return buckets.filter((b) => b.days > 0);
  };

  const bySleep = byRating((l) => l.sleep);
  const byEnergy = byRating((l) => l.energy);
  const byFocus = byRating((l) => l.focus);

  const tiltDays = joined.filter((j) => j.log.tiltMarkers.length > 0);
  const calmDays = joined.filter((j) => j.log.tiltMarkers.length === 0);
  const tiltSummary = summarise(tiltDays.flatMap((j) => j.trades));
  const calmSummary = summarise(calmDays.flatMap((j) => j.trades));

  const tiltCounts = TILT_MARKERS.map((m) => {
    const set = joined.filter((j) => j.log.tiltMarkers.includes(m.id));
    const s = summarise(set.flatMap((j) => j.trades));
    return { label: m.label, days: set.length, r: s.totalR };
  }).filter((t) => t.days > 0);

  return (
    <>
      <PageHeader
        title="Psychology"
        subtitle={`${logs.length} days logged · ${joined.length} with trades to compare against`}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Days logged" value={<span className="figure">{logs.length}</span>} />
        <StatTile
          label="Comparable days"
          value={
            <span className={clsx("figure", !enough ? "text-[var(--color-warn)]" : undefined)}>
              {joined.length}
            </span>
          }
          sub={enough ? undefined : `need ${MIN_DAYS_FOR_A_CLAIM}`}
        />
        <StatTile label="Tilt days" value={<span className="figure">{tiltDays.length}</span>} />
        <StatTile
          label="R on tilt days"
          value={<RMultiple value={tiltSummary.totalR} decimals={1} />}
          sub={tiltDays.length ? `${tiltDays.length} days` : undefined}
        />
        <StatTile
          label="R on clean days"
          value={<RMultiple value={calmSummary.totalR} decimals={1} />}
          sub={calmDays.length ? `${calmDays.length} days` : undefined}
        />
        <StatTile
          label="Today logged"
          value={
            <span
              className={clsx(
                "figure",
                todayRows[0] ? "text-[var(--color-accent)]" : "text-[var(--color-ink-mute)]",
              )}
            >
              {todayRows[0] ? "yes" : "not yet"}
            </span>
          }
        />
      </div>

      {!enough && (
        <div className="mb-4 rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-sunken)] px-3.5 py-2.5">
          <p className="text-xs leading-relaxed text-[var(--color-ink-mute)]">
            {joined.length === 0 ? (
              <>
                No day has both a state log and closed trades yet, so there is nothing to
                correlate. The panels below fill in as you log.
              </>
            ) : (
              <>
                Only {joined.length} day{joined.length === 1 ? "" : "s"} can be compared.
                The breakdowns below are shown so the shape is visible, but at this sample
                size they describe a handful of days rather than a tendency — treat them as
                a diary, not a finding, until there are at least {MIN_DAYS_FOR_A_CLAIM}.
              </>
            )}
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <StateForm state={state} />

        <Card className="p-5">
          <CardHeader title="Tilt markers" action={<span className="label-faint">R on days marked</span>} />
          {tiltCounts.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
              No tilt markers logged yet.
            </p>
          ) : (
            <div className="mt-3">
              <BarRows
                rows={tiltCounts.map((t) => ({
                  label: t.label,
                  value: t.r,
                  sub: `${t.days}d`,
                }))}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
              />
            </div>
          )}
        </Card>
      </div>

      {joined.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-5">
            <CardHeader title="By sleep" action={<span className="label-faint">R per day</span>} />
            <div className="mt-3">
              <BarRows
                rows={bySleep.map((b) => ({
                  label: `${b.rating}/5`,
                  value: b.perDay,
                  sub: `${b.days}d`,
                }))}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`}
              />
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="By energy" action={<span className="label-faint">R per day</span>} />
            <div className="mt-3">
              <BarRows
                rows={byEnergy.map((b) => ({
                  label: `${b.rating}/5`,
                  value: b.perDay,
                  sub: `${b.days}d`,
                }))}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`}
              />
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="By focus" action={<span className="label-faint">R per day</span>} />
            <div className="mt-3">
              <BarRows
                rows={byFocus.map((b) => ({
                  label: `${b.rating}/5`,
                  value: b.perDay,
                  sub: `${b.days}d`,
                }))}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`}
              />
            </div>
          </Card>
        </div>
      )}

      <Card className="mt-4 p-5">
        <CardHeader title="Recent days" />
        {logs.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--color-ink-mute)]">Nothing logged yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className="label-faint py-2 text-left">Day</th>
                  <th className="label-faint py-2 text-right">Sleep</th>
                  <th className="label-faint py-2 text-right">Energy</th>
                  <th className="label-faint py-2 text-right">Focus</th>
                  <th className="label-faint py-2 text-left">Tilt</th>
                  <th className="label-faint py-2 text-right">Trades</th>
                  <th className="label-faint py-2 text-right">R</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 30).map((l) => {
                  const set = byDay.get(l.day) ?? [];
                  const s = summarise(set);
                  return (
                    <tr key={l.day} className="border-b border-[var(--color-line)]/60 last:border-0">
                      <td className="py-2 text-[var(--color-ink-dim)]">{l.day}</td>
                      <td className="figure py-2 text-right">{l.sleep ?? "—"}</td>
                      <td className="figure py-2 text-right">{l.energy ?? "—"}</td>
                      <td className="figure py-2 text-right">{l.focus ?? "—"}</td>
                      <td className="py-2 text-[11px] text-[var(--color-warn)]">
                        {l.tiltMarkers
                          .map((m) => TILT_MARKERS.find((t) => t.id === m)?.label ?? m)
                          .join(", ")}
                      </td>
                      <td className="figure py-2 text-right text-[var(--color-ink-dim)]">
                        {set.length || "—"}
                      </td>
                      <td className="py-2 text-right">
                        {set.length ? <RMultiple value={s.totalR} decimals={1} /> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
