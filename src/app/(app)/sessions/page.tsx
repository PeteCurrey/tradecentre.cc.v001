import { requireSession } from "@/lib/auth/guard";
import { activeEnvironment, loadTrades } from "@/lib/analytics/load";
import { groupBy, summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BarRows } from "@/components/charts/Plot";
import { BookFilter, ClusterNote, NoTrades, PracticeNote } from "@/components/analytics/Shared";
import { BOOK_IDS, HORIZONS, type HorizonId } from "@/lib/books";
import { DISPLAY_TZ, SESSIONS, partsIn } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Time & Session.
 *
 * Everything is bucketed by ENTRY time in London, because the question is "when
 * do I take good trades", which is a decision made at entry. Exit time answers
 * a different question and is used for the equity curve instead.
 *
 * Sessions overlap by design — London and New York share four hours — so a
 * trade can appear in two session rows. That is correct: a trade taken during
 * the overlap genuinely happened in both, and forcing it into one would hide
 * the overlap, which is the window most worth measuring.
 */
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);

  const [trades, environment] = await Promise.all([
    loadTrades({ book }),
    activeEnvironment(),
  ]);
  const s = summarise(trades);

  const hourOf = (d: Date) => partsIn(d, DISPLAY_TZ).hour;
  const weekdayOf = (d: Date) => partsIn(d, DISPLAY_TZ).weekday;

  const byHour = Array.from({ length: 24 }, (_, h) => {
    const set = trades.filter((t) => hourOf(t.entryTime) === h);
    return { hour: h, n: set.length, summary: summarise(set) };
  });

  const byWeekday = WEEKDAYS.map((d) => {
    const set = trades.filter((t) => weekdayOf(t.entryTime) === d);
    return { day: d, n: set.length, summary: summarise(set) };
  }).filter((d) => d.n > 0);

  const bySession = SESSIONS.map((sess) => {
    const set = trades.filter((t) => {
      const h = hourOf(t.entryTime);
      return sess.startHour <= sess.endHour
        ? h >= sess.startHour && h < sess.endHour
        : h >= sess.startHour || h < sess.endHour;
    });
    return { label: sess.label, n: set.length, summary: summarise(set) };
  }).filter((x) => x.n > 0);

  const overlap = trades.filter((t) => {
    const h = hourOf(t.entryTime);
    return h >= 13 && h < 17;
  });

  const byHorizon = groupBy(trades, (t) => t.horizon as HorizonId | null);

  // Hold time in minutes, for trades that closed.
  const holds = trades
    .filter((t) => t.exitTime)
    .map((t) => ({
      minutes: (t.exitTime!.getTime() - t.entryTime.getTime()) / 60_000,
      r: t.rMultiple,
    }));

  const holdBuckets = [
    { label: "<5m", max: 5 },
    { label: "5–30m", max: 30 },
    { label: "30m–2h", max: 120 },
    { label: "2–8h", max: 480 },
    { label: "8h–3d", max: 4320 },
    { label: ">3d", max: Infinity },
  ].map((b, i, all) => {
    const min = i === 0 ? 0 : all[i - 1].max;
    const set = holds.filter((h) => h.minutes >= min && h.minutes < b.max);
    const rs = set.map((h) => h.r).filter((r): r is number => r !== null);
    return {
      label: b.label,
      n: set.length,
      totalR: rs.reduce((a, r) => a + r, 0),
    };
  });

  const maxHourly = Math.max(...byHour.map((h) => Math.abs(h.summary.totalR)), 0.001);

  return (
    <>
      <PageHeader
        title="Time &amp; Session"
        subtitle={`${trades.length} closed trades, bucketed by entry time in London`}
      />
      <BookFilter base="/sessions" active={book} />
      <PracticeNote environment={environment} />

      {trades.length === 0 ? (
        <NoTrades what="No closed trades in this book yet." />
      ) : (
        <>
          <ClusterNote trades={s.trades} independentExits={s.independentExits} />

          <Card className="p-5">
            <CardHeader
              title="By hour of day"
              action={<span className="label-faint">Europe/London</span>}
            />
            <div className="mt-4 flex items-end gap-1" style={{ height: 150 }}>
              {byHour.map((h) => {
                const v = h.summary.totalR;
                const pct = (Math.abs(v) / maxHourly) * 100;
                return (
                  <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                    <div className="relative flex w-full flex-1 flex-col justify-end">
                      <div
                        className="w-full rounded-t-sm"
                        style={{
                          height: `${pct}%`,
                          minHeight: h.n ? 2 : 0,
                          background:
                            v >= 0 ? "var(--color-profit)" : "var(--color-loss)",
                          opacity: 0.8,
                        }}
                        title={`${h.hour}:00 — ${h.n} trades, ${v.toFixed(2)}R`}
                      />
                    </div>
                    <span
                      className={clsx(
                        "text-[9px]",
                        h.hour >= 13 && h.hour < 17
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-ink-faint)]",
                      )}
                    >
                      {h.hour}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Hours in orange are the London/New York overlap — typically the highest-volume
              window of the day. Bar height is total R, so a tall bar can be one good trade
              or twenty small ones; check the count in the tooltip before drawing a
              conclusion.
            </p>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <CardHeader title="By session" />
              <div className="mt-3">
                <BarRows
                  rows={bySession.map((x) => ({
                    label: x.label,
                    value: x.summary.totalR,
                    sub: `${x.n}`,
                  }))}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                Sessions overlap, so a trade can count in two rows. That is deliberate — the
                overlap is real and forcing each trade into one session would hide it.
              </p>
            </Card>

            <Card className="p-5">
              <CardHeader title="By weekday" />
              <div className="mt-3">
                <BarRows
                  rows={byWeekday.map((x) => ({
                    label: x.day,
                    value: x.summary.totalR,
                    sub: `${x.n}`,
                  }))}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                />
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader title="By hold time" />
              <div className="mt-3">
                <BarRows
                  rows={holdBuckets
                    .filter((b) => b.n > 0)
                    .map((b) => ({ label: b.label, value: b.totalR, sub: `${b.n}` }))}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                Measured hold time, independent of the horizon tag — so a trade labelled
                &ldquo;intraday&rdquo; that ran three days shows up where it actually
                belongs.
              </p>
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <CardHeader title="Horizon tag vs measured result" />
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {byHorizon.map((g) => (
                <StatTile
                  key={String(g.key)}
                  label={HORIZONS[g.key!]?.label ?? String(g.key)}
                  value={<RMultiple value={g.summary.totalR} decimals={1} />}
                  sub={`${g.summary.trades} trades · ${g.summary.winRate.toFixed(0)}% win`}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile
                label="Overlap trades"
                value={<span className="figure">{overlap.length}</span>}
                sub="13:00–17:00 London"
              />
              <StatTile
                label="Overlap R"
                value={<RMultiple value={summarise(overlap).totalR} decimals={1} />}
              />
              <StatTile
                label="Best hour"
                value={
                  <span className="figure">
                    {byHour.reduce((a, b) => (b.summary.totalR > a.summary.totalR ? b : a)).hour}
                    :00
                  </span>
                }
              />
              <StatTile
                label="Worst hour"
                value={
                  <span className="figure">
                    {byHour.reduce((a, b) => (b.summary.totalR < a.summary.totalR ? b : a)).hour}
                    :00
                  </span>
                }
              />
            </div>
          </Card>
        </>
      )}
    </>
  );
}
