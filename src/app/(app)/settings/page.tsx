import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { accounts, appConfig, books, trades } from "@/lib/db/schema";
import { env, configuredAiProviders } from "@/lib/env";
import { AccountMapping, type AccountRow } from "@/components/settings/AccountMapping";
import { RiskConfig, type BookRiskRow } from "@/components/settings/RiskConfig";
import { HorizonConfig } from "@/components/settings/HorizonConfig";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import {
  DEFAULT_HORIZON_THRESHOLDS,
  type BookId,
  type Conviction,
  type HorizonThresholds,
} from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();

  const accountRows = await db.select().from(accounts).orderBy(asc(accounts.id));
  const bookRows = await db.select().from(books).orderBy(asc(books.id));

  const counts = await db
    .select({ accountId: trades.accountId, c: sql<number>`count(*)::int` })
    .from(trades)
    .groupBy(trades.accountId);
  const countBy = new Map(counts.map((c) => [c.accountId, c.c]));

  const mapped: AccountRow[] = accountRows.map((a) => ({
    id: a.id,
    book: a.book,
    environment: a.environment,
    currency: a.currency,
    alias: a.alias,
    active: a.active,
    tradeCount: countBy.get(a.id) ?? 0,
  }));

  const [cfg] = await db.select().from(appConfig).limit(1);
  const thresholds =
    (cfg?.horizonThresholds as HorizonThresholds | undefined) ??
    DEFAULT_HORIZON_THRESHOLDS;

  const risk: BookRiskRow[] = bookRows.map((b) => ({
    id: b.id as BookId,
    baseRiskPct: Number(b.baseRiskPct),
    dailyLimitR: Number(b.dailyLimitR),
    multipliers: b.convictionMultipliers as Record<Conviction, number>,
  }));

  // Connection status. Reads only whether a key exists — never the value.
  const e = env();
  const services: Array<{ name: string; ok: boolean; note: string }> = [
    { name: "Database", ok: true, note: "Supabase Postgres" },
    {
      name: "OANDA practice",
      ok: Boolean(e.OANDA_PRACTICE_TOKEN),
      note: "read-only, no order placement",
    },
    {
      name: "OANDA live",
      ok: Boolean(e.OANDA_LIVE_TOKEN),
      note: e.OANDA_LIVE_TOKEN ? "connected" : "not connected — practice only",
    },
    { name: "FRED", ok: Boolean(e.FRED_API_KEY), note: "macro series + release calendar" },
    { name: "EIA", ok: Boolean(e.EIA_API_KEY), note: "crude & natural gas inventories" },
    { name: "Polygon", ok: Boolean(e.POLYGON_API_KEY), note: "news, backup prices" },
    {
      name: "Finnhub",
      ok: Boolean(e.FINNHUB_API_KEY),
      note: "quotes only — economic calendar is tier-gated",
    },
    {
      name: "Twelve Data",
      ok: Boolean(e.TWELVEDATA_API_KEY),
      note: "backup prices — has no economic calendar",
    },
    { name: "Polymarket", ok: true, note: "public API, no key required" },
  ];

  const ai = configuredAiProviders();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Accounts, risk, and connections"
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <AccountMapping rows={mapped} />
          <HorizonConfig initial={thresholds} />
        </div>

        <div className="space-y-4">
          <RiskConfig rows={risk} />

          <Card className="p-5">
            <CardHeader title="Connections" />
            <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
              Keys live in server-side environment variables and never reach the browser.
            </p>
            <ul className="mt-3 space-y-1.5">
              {services.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center gap-2.5 rounded-lg bg-[var(--color-sunken)] px-3 py-2"
                >
                  <span
                    className={clsx(
                      "size-1.5 shrink-0 rounded-full",
                      s.ok ? "bg-[var(--color-accent)]" : "bg-[var(--color-line-strong)]",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px]">{s.name}</span>
                    <span className="block text-[11px] text-[var(--color-ink-mute)]">
                      {s.note}
                    </span>
                  </span>
                  <span className="label-faint shrink-0">
                    {s.ok ? "ready" : "not set"}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3 rounded-lg bg-[var(--color-sunken)] px-3 py-2">
              <div className="label-faint">AI providers</div>
              <div className="mt-1 text-[13px]">
                {ai.length > 0 ? ai.join(" · ") : "none configured"}
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-ink-mute)]">
                On demand only. Every call is logged with its token cost.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
