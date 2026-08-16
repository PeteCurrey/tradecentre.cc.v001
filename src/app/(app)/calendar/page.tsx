import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { activeEnvironment, accountCurrency, loadTrades } from "@/lib/analytics/load";
import { summarise, type AnalyticsTrade } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import {
  BookFilter,
  Chip,
  NoTrades,
  PracticeNote,
} from "@/components/analytics/Shared";
import { BOOK_IDS } from "@/lib/books";
import { brokerDayKey, dayKey } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Calendar heatmap of daily P&L.
 *
 * Days are keyed on EXIT, because that is when the money moved.
 *
 * The London/broker toggle is not a cosmetic preference. OANDA rolls its
 * trading day at 17:00 New York, which is when financing is charged, so a
 * London-midnight day will not tie to an OANDA statement on anything carried
 * overnight. Both rules are implemented and the screen says which one is on.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; boundary?: string; month?: string }>;
}) {
  await requireSession();
  const user = await requireUser();
  const params = await searchParams;
  const book = BOOK_IDS.find((b) => b === params.book);
  const useBroker = params.boundary === "broker";

  const [trades, currency, environment] = await Promise.all([
    loadTrades({ userId: user.id, book }),
    accountCurrency(user.id),
    activeEnvironment(user.id),
  ]);

  const closed = trades.filter((t) => t.exitTime !== null);

  const keyOf = (t: AnalyticsTrade) =>
    useBroker ? brokerDayKey(t.exitTime!) : dayKey(t.exitTime!);

  const byDay = new Map<string, AnalyticsTrade[]>();
  for (const t of closed) {
    const k = keyOf(t);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }

  const days = [...byDay.entries()]
    .map(([key, set]) => ({ key, ...summarise(set) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // Months present in the data, most recent first.
  const months = [...new Set(days.map((d) => d.key.slice(0, 7)))].sort().reverse();
  const month = months.includes(params.month ?? "") ? params.month! : months[0];

  const monthDays = days.filter((d) => d.key.startsWith(month ?? ""));
  const scale = Math.max(...days.map((d) => Math.abs(d.netPl)), 1);

  const winningDays = days.filter((d) => d.netPl > 0).length;
  const losingDays = days.filter((d) => d.netPl < 0).length;
  const best = days.reduce<(typeof days)[number] | null>(
    (a, d) => (a === null || d.netPl > a.netPl ? d : a),
    null,
  );
  const worst = days.reduce<(typeof days)[number] | null>(
    (a, d) => (a === null || d.netPl < a.netPl ? d : a),
    null,
  );

  const qs = (over: Record<string, string | undefined>) => {
    const merged = {
      book,
      boundary: useBroker ? "broker" : undefined,
      month,
      ...over,
    };
    const parts = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`${days.length} trading days · ${winningDays} up, ${losingDays} down`}
      />
      <BookFilter base="/calendar" active={book} extra={useBroker ? "&boundary=broker" : ""} />
      <PracticeNote environment={environment} />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="label-faint mr-1">Day boundary</span>
        <Chip
          href={`/calendar${qs({ boundary: undefined })}`}
          active={!useBroker}
          label="London midnight"
        />
        <Chip
          href={`/calendar${qs({ boundary: "broker" })}`}
          active={useBroker}
          label="Broker 17:00 NY"
        />
      </div>

      {closed.length === 0 ? (
        <NoTrades what="No closed trades in this book yet." />
      ) : (
        <>
          <div className="mb-4 rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-sunken)] px-3.5 py-2.5">
            <p className="text-xs leading-relaxed text-[var(--color-ink-mute)]">
              {useBroker ? (
                <>
                  Days roll at <strong>17:00 New York</strong>, matching OANDA&apos;s own
                  trading day. This is the view that ties to a broker statement, because
                  financing is charged at the roll.
                </>
              ) : (
                <>
                  Days roll at <strong>London midnight</strong>. This is how the day feels
                  to trade, but it will <em>not</em> tie exactly to an OANDA statement on
                  anything carried overnight — the broker rolls at 17:00 New York, which is
                  when financing lands.
                </>
              )}
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Trading days"
              value={<span className="figure">{days.length}</span>}
            />
            <StatTile
              label="Day win rate"
              value={
                <span className="figure">
                  {days.length ? ((winningDays / days.length) * 100).toFixed(0) : 0}%
                </span>
              }
              sub={`${winningDays}W / ${losingDays}L`}
            />
            <StatTile
              label="Best day"
              value={best ? <Money value={best.netPl} currency={currency} /> : "—"}
              sub={best?.key}
            />
            <StatTile
              label="Worst day"
              value={worst ? <Money value={worst.netPl} currency={currency} /> : "—"}
              sub={worst?.key}
            />
            <StatTile
              label="Average day"
              value={
                <Money
                  value={days.length ? days.reduce((s, d) => s + d.netPl, 0) / days.length : 0}
                  currency={currency}
                />
              }
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="label-faint mr-1">Month</span>
            {months.slice(0, 12).map((m) => (
              <Chip key={m} href={`/calendar${qs({ month: m })}`} active={m === month} label={m} />
            ))}
          </div>

          <Card className="p-5">
            <CardHeader
              title={month ?? "—"}
              action={
                <span className="label-faint">
                  {monthDays.length} days · {monthDays.reduce((s, d) => s + d.trades, 0)}{" "}
                  trades
                </span>
              }
            />
            <MonthGrid month={month} days={monthDays} scale={scale} currency={currency} />
          </Card>

          <Card className="mt-4 overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader title="Day by day" />
            </div>
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-[var(--color-sunken)]">
                  <tr className="border-b border-[var(--color-line)]">
                    <th className="label-faint px-3 py-2.5 text-left">Day</th>
                    <th className="label-faint px-3 py-2.5 text-right">Trades</th>
                    <th className="label-faint px-3 py-2.5 text-right">Exits</th>
                    <th className="label-faint px-3 py-2.5 text-right">Win rate</th>
                    <th className="label-faint px-3 py-2.5 text-right">R</th>
                    <th className="label-faint px-3 py-2.5 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().map((d) => (
                    <tr
                      key={d.key}
                      className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-card-raised)]"
                    >
                      <td className="px-3 py-2 text-[var(--color-ink-dim)]">{d.key}</td>
                      <td className="figure px-3 py-2 text-right text-[var(--color-ink-dim)]">
                        {d.trades}
                      </td>
                      <td className="figure px-3 py-2 text-right text-[var(--color-ink-mute)]">
                        {d.independentExits}
                      </td>
                      <td className="figure px-3 py-2 text-right">
                        {d.winRate.toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RMultiple value={d.totalR} decimals={1} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={d.netPl} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function MonthGrid({
  month,
  days,
  scale,
  currency,
}: {
  month: string | undefined;
  days: Array<{ key: string; netPl: number; totalR: number; trades: number }>;
  scale: number;
  currency: string;
}) {
  if (!month) return null;

  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first grid, which is how a trading week reads.
  const lead = (first.getUTCDay() + 6) % 7;

  const byKey = new Map(days.map((d) => [d.key, d]));

  return (
    <div className="mt-4">
      <div className="grid grid-cols-7 gap-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="label-faint text-center">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = `${month}-${String(day).padStart(2, "0")}`;
          const d = byKey.get(key);
          const intensity = d ? Math.min(1, Math.abs(d.netPl) / scale) : 0;

          return (
            <div
              key={key}
              className={clsx(
                "relative min-h-[4.5rem] rounded-lg border p-1.5",
                d
                  ? "border-[var(--color-line-strong)]"
                  : "border-[var(--color-line)]/50",
              )}
              style={
                d
                  ? {
                      background:
                        d.netPl >= 0
                          ? `color-mix(in srgb, var(--color-profit) ${intensity * 28}%, transparent)`
                          : `color-mix(in srgb, var(--color-loss) ${intensity * 28}%, transparent)`,
                    }
                  : undefined
              }
              title={
                d
                  ? `${key} — ${d.trades} trades, ${d.totalR.toFixed(2)}R`
                  : `${key} — no trades`
              }
            >
              <span className="text-[10px] text-[var(--color-ink-faint)]">{day}</span>
              {d && (
                <div className="mt-0.5">
                  <div
                    className={clsx(
                      "figure text-[11px] leading-tight",
                      d.netPl > 0 ? "money-up" : d.netPl < 0 ? "money-down" : "money-flat",
                    )}
                  >
                    {d.netPl >= 0 ? "+" : ""}
                    {Math.abs(d.netPl) >= 1000
                      ? `${(d.netPl / 1000).toFixed(1)}k`
                      : d.netPl.toFixed(0)}
                  </div>
                  <div className="text-[9px] text-[var(--color-ink-faint)]">
                    {d.trades}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        Cash in {currency}, shaded by size relative to the largest day in the whole record —
        so a month of quiet days looks quiet rather than being rescaled into drama.
      </p>
    </div>
  );
}
