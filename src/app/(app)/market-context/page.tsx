import { asc, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { macroEvents } from "@/lib/db/schema";
import { fetchFredSeries } from "@/lib/macro/sources";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { RefreshButton } from "@/components/macro/RefreshButton";
import { formatDate, formatDateTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Market Context.
 *
 * What this screen can and cannot tell you is stated on the screen itself,
 * because the gap is real. Verification killed the original calendar plan:
 * Finnhub's economic calendar is tier-gated and Twelve Data has none at all.
 * What survives gives release DATES but no consensus, actual or previous
 * figures, and thin coverage outside the US.
 *
 * A calendar with empty forecast columns and no explanation reads as broken.
 * One that says "these sources don't carry consensus" reads as honest, and
 * stops you waiting for a number that is never coming.
 */
export default async function MarketContextPage() {
  await requireSession();

  const now = new Date();

  const [events, { series, errors }] = await Promise.all([
    db
      .select()
      .from(macroEvents)
      .where(gte(macroEvents.time, new Date(now.getTime() - 12 * 3600_000)))
      .orderBy(asc(macroEvents.time))
      .limit(120),
    fetchFredSeries(),
  ]);

  const calendar = events.filter((e) => e.source !== "polymarket");
  const markets = events.filter((e) => e.source === "polymarket");

  const staleness = events.length
    ? Math.max(...events.map((e) => now.getTime() - e.fetchedAt.getTime()))
    : null;

  const vix = series.find((s) => s.id === "VIXCLS");
  const curve = series.find((s) => s.id === "T10Y2Y");

  return (
    <>
      <PageHeader
        title="Market Context"
        subtitle="Release calendar, macro regime, and market-implied probabilities"
        action={<RefreshButton />}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {series.map((s) => {
          const delta =
            s.latest !== null && s.previous !== null ? s.latest - s.previous : null;
          return (
            <StatTile
              key={s.id}
              label={s.label}
              value={
                s.latest === null ? (
                  <span className="text-[var(--color-ink-faint)]">—</span>
                ) : (
                  <span className="figure">{s.latest.toFixed(2)}</span>
                )
              }
              sub={
                delta === null ? (
                  s.date ?? "unavailable"
                ) : (
                  // Not money, so not green or red — this is a status figure.
                  <span
                    className={clsx(
                      Math.abs(delta) > 0 ? "text-[var(--color-warn)]" : undefined,
                    )}
                  >
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(2)} · {s.date}
                  </span>
                )
              }
            />
          );
        })}
      </div>

      {(vix?.latest !== null && vix?.latest !== undefined) ||
      (curve?.latest !== null && curve?.latest !== undefined) ? (
        <Card className="mb-4 p-5">
          <CardHeader title="Regime, read plainly" />
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
            {vix?.latest != null && (
              <>
                VIX at {vix.latest.toFixed(1)} is{" "}
                {vix.latest < 15
                  ? "low — trend-following setups tend to work and mean-reversion stops get run"
                  : vix.latest > 25
                    ? "elevated — position sizes computed from a quiet-market ATR will be too large"
                    : "middling, which is the least informative reading there is"}
                .{" "}
              </>
            )}
            {curve?.latest != null && (
              <>
                The 10y−2y spread at {curve.latest.toFixed(2)} is{" "}
                {curve.latest < 0 ? "inverted" : "positive"}.
              </>
            )}
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-faint)]">
            This is context, not a signal. Nothing here is scored, ranked or fed into the
            engine — a regime read is the sort of thing that looks predictive in hindsight
            and is not, so it stays a sentence you read rather than a number something acts
            on.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <div className="p-5 pb-3">
            <CardHeader
              title="Release calendar"
              action={
                <span className="label-faint">
                  {staleness !== null
                    ? `cached ${Math.round(staleness / 60_000)}m ago`
                    : "never fetched"}
                </span>
              }
            />
          </div>

          {calendar.length === 0 ? (
            <div className="px-5 pb-5">
              <p className="text-xs leading-relaxed text-[var(--color-ink-mute)]">
                Nothing cached. Press refresh to pull the FRED release schedule and the EIA
                inventory dates. Nothing is shown speculatively here — a placeholder event
                beside a real trading plan is worse than an empty panel.
              </p>
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-[var(--color-sunken)]">
                  <tr className="border-b border-[var(--color-line)]">
                    <th className="label-faint px-3 py-2.5 text-left">When</th>
                    <th className="label-faint px-3 py-2.5 text-left">Event</th>
                    <th className="label-faint px-3 py-2.5 text-left">Impact</th>
                    <th className="label-faint px-3 py-2.5 text-left">Source</th>
                    <th className="label-faint px-3 py-2.5 text-right">Forecast</th>
                    <th className="label-faint px-3 py-2.5 text-right">Previous</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.map((e) => {
                    const soon = e.time.getTime() - now.getTime() < 24 * 3600_000;
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-[var(--color-line)]/60 last:border-0"
                      >
                        <td
                          className={clsx(
                            "whitespace-nowrap px-3 py-2 text-xs",
                            soon
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-ink-dim)]",
                          )}
                        >
                          {e.source === "fred"
                            ? formatDate(e.time)
                            : formatDateTime(e.time)}
                        </td>
                        <td className="px-3 py-2">{e.title}</td>
                        <td className="px-3 py-2">
                          {/* Impact is risk/status, so warn — never green or red. */}
                          <span
                            className="text-[11px] tracking-widest text-[var(--color-warn)]"
                            title={`${e.importance ?? 0} of 3`}
                          >
                            {"•".repeat(e.importance ?? 0)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="label-faint">{e.source}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--color-ink-faint)]">
                          {e.forecast ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--color-ink-faint)]">
                          {e.previous ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-[var(--color-line)] px-5 py-3">
            <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">
              <strong className="text-[var(--color-warn)]">Known gap.</strong> These
              sources carry release <em>dates</em>, not consensus numbers — the forecast and
              previous columns will stay empty, and that is the data, not a bug. FRED rows
              are date-only, so their times are conventional rather than exact. Coverage
              outside the US is thin.
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader
              title="Market-implied probabilities"
              action={<span className="label-faint">Polymarket</span>}
            />
            {markets.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                Nothing cached yet.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {markets.slice(0, 12).map((m) => (
                  <div key={m.id} className="border-b border-[var(--color-line)]/60 pb-2 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs leading-snug text-[var(--color-ink-dim)]">
                        {m.title}
                      </span>
                      <span className="figure shrink-0 text-sm text-[var(--color-accent)]">
                        {m.impliedProbability !== null
                          ? `${(m.impliedProbability * 100).toFixed(0)}%`
                          : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">
              These are <strong>prices, not forecasts</strong>. 72% means someone will pay
              72c for a dollar contingent on the event — which embeds a risk premium and
              whatever the marginal trader believes. Useful against your own assumption,
              not a probability handed down from anywhere.
            </p>
          </Card>

          <Card className="p-5">
            <CardHeader title="What feeds this screen" />
            <ul className="mt-2 space-y-1.5 text-xs text-[var(--color-ink-mute)]">
              <li>
                <strong>FRED</strong> — release schedule and macro series. Free, reliable.
              </li>
              <li>
                <strong>EIA</strong> — weekly petroleum (Wed) and natural gas (Thu).
                Directly relevant to WTICO, BCO and NATGAS.
              </li>
              <li>
                <strong>Polymarket</strong> — public API, no key.
              </li>
              <li className="text-[var(--color-ink-faint)]">
                Finnhub&apos;s calendar is tier-gated (403) and Twelve Data has no calendar
                endpoint at all (404). Both were tested, not assumed.
              </li>
            </ul>
            {errors.length > 0 && (
              <div className="mt-3 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3 py-2">
                <ul className="space-y-0.5">
                  {errors.map((e, i) => (
                    <li key={i} className="text-[11px] text-[var(--color-warn)]">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
