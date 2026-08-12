import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import {
  accounts as accountsTable,
  instruments as instrumentsTable,
  patterns as patternsTable,
  tradeAnnotations,
  trades as tradesTable,
} from "@/lib/db/schema";
import { getTradeCandles, excursions } from "@/lib/candles/service";
import { TradeChart } from "@/components/charts/TradeChart";
import { AnnotationForm } from "@/components/journal/AnnotationForm";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BOOKS, HORIZONS, type BookId, type Conviction, type HorizonId } from "@/lib/books";
import type { ProcessGrade } from "@/lib/journal/taxonomy";
import { formatDateTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) notFound();

  const [trade] = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.id, tradeId))
    .limit(1);
  if (!trade) notFound();

  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, trade.accountId))
    .limit(1);

  const [instrument] = await db
    .select()
    .from(instrumentsTable)
    .where(eq(instrumentsTable.name, trade.instrument))
    .limit(1);

  const [annotation] = await db
    .select()
    .from(tradeAnnotations)
    .where(eq(tradeAnnotations.oandaTradeId, trade.oandaTradeId))
    .limit(1);

  const patternRows = await db
    .select({
      id: patternsTable.id,
      name: patternsTable.name,
      tags: patternsTable.tags,
    })
    .from(patternsTable)
    .orderBy(asc(patternsTable.id));

  // Candles are best-effort: a chart that cannot load must not take the page
  // down, because the numbers below it are still worth reading.
  let bars: Awaited<ReturnType<typeof getTradeCandles>>["bars"] = [];
  let granularity = "";
  let chartError: string | null = null;
  try {
    const window = await getTradeCandles({
      instrument: trade.instrument,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      environment: account?.environment ?? "practice",
    });
    bars = window.bars;
    granularity = window.granularity;
  } catch (e) {
    chartError = (e as Error).message;
  }

  const entryPrice = Number(trade.entryPrice);
  const exitPrice = trade.exitPrice ? Number(trade.exitPrice) : null;
  const stop = trade.plannedStop ? Number(trade.plannedStop) : null;
  const target = trade.plannedTarget ? Number(trade.plannedTarget) : null;
  const risk = stop !== null ? Math.abs(entryPrice - stop) : 0;

  const exc =
    risk > 0 && bars.length > 0
      ? excursions(bars, {
          entryTime: trade.entryTime.getTime(),
          exitTime: (trade.exitTime ?? new Date()).getTime(),
          entryPrice,
          direction: trade.direction as "long" | "short",
          risk,
        })
      : null;

  const currency = account?.currency ?? "GBP";
  const book = trade.book as BookId;
  const holdMs = (trade.exitTime ?? new Date()).getTime() - trade.entryTime.getTime();

  return (
    <>
      <Link
        href="/trades"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink-dim)]"
      >
        <ArrowLeft className="size-3.5" />
        Trade Log
      </Link>

      <PageHeader
        title={trade.instrument}
        subtitle={`${formatDateTime(trade.entryTime)} · ${BOOKS[book]?.label ?? trade.book} · trade ${trade.oandaTradeId}`}
        action={
          <span
            className={clsx(
              "rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider",
              trade.direction === "long"
                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "bg-[var(--color-line)] text-[var(--color-ink-dim)]",
            )}
          >
            {trade.direction}
          </span>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <Card className="p-4">
            <CardHeader
              title="Chart"
              action={
                <span className="label-faint">
                  {granularity ? `${granularity} · auto-rendered` : "unavailable"}
                </span>
              }
            />
            <div className="mt-3">
              {chartError ? (
                <p className="py-10 text-center text-sm text-[var(--color-ink-mute)]">
                  Could not load candles: {chartError}
                </p>
              ) : (
                <TradeChart
                  bars={bars}
                  direction={trade.direction as "long" | "short"}
                  entryTime={trade.entryTime.getTime()}
                  entryPrice={entryPrice}
                  exitTime={trade.exitTime?.getTime() ?? null}
                  exitPrice={exitPrice}
                  stop={stop}
                  target={target}
                  precision={instrument?.displayPrecision ?? 5}
                />
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile
              label="Result"
              value={
                trade.rMultiple !== null ? (
                  <RMultiple value={trade.rMultiple} />
                ) : (
                  <span className="text-[var(--color-ink-faint)]">—</span>
                )
              }
              sub={<Money value={Number(trade.realizedPl ?? 0)} currency={currency} />}
            />
            <StatTile
              label="MAE"
              value={
                exc ? (
                  <span className="figure money-down">−{exc.maeR.toFixed(2)}R</span>
                ) : (
                  "—"
                )
              }
              sub="worst point"
            />
            <StatTile
              label="MFE"
              value={
                exc ? (
                  <span className="figure money-up">+{exc.mfeR.toFixed(2)}R</span>
                ) : (
                  "—"
                )
              }
              sub="best point"
            />
            <StatTile
              label="Held"
              value={<span className="figure">{formatDuration(holdMs)}</span>}
              sub={
                trade.horizon
                  ? HORIZONS[trade.horizon as HorizonId].label
                  : "open"
              }
            />
          </div>

          <Card className="p-5">
            <CardHeader title="Execution" />
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-3">
              <Row label="Entry" value={entryPrice.toFixed(instrument?.displayPrecision ?? 5)} />
              <Row
                label="Exit"
                value={exitPrice?.toFixed(instrument?.displayPrecision ?? 5) ?? "open"}
              />
              <Row label="Units" value={Number(trade.units).toLocaleString()} />
              <Row
                label="Planned stop"
                value={stop?.toFixed(instrument?.displayPrecision ?? 5) ?? "none"}
              />
              <Row
                label="Planned target"
                value={target?.toFixed(instrument?.displayPrecision ?? 5) ?? "none"}
              />
              <Row
                label="Planned risk"
                value={
                  trade.initialRisk
                    ? `${Number(trade.initialRisk).toFixed(2)} ${currency}`
                    : "—"
                }
              />
              <Row label="Financing" value={Number(trade.financing).toFixed(4)} />
              <Row label="Commission" value={Number(trade.commission).toFixed(4)} />
              <Row
                label="Spread cost"
                value={
                  <span className="text-[var(--color-warn)]">
                    {Number(trade.spreadCost).toFixed(2)}
                  </span>
                }
              />
            </dl>
          </Card>
        </div>

        <AnnotationForm
          accountId={trade.accountId}
          oandaTradeId={trade.oandaTradeId}
          patterns={patternRows.map((p) => ({
            id: p.id,
            name: p.name,
            horizon: (p.tags as { horizons?: string[] }).horizons?.[0] ?? "—",
          }))}
          inferredHorizon={(trade.horizon as HorizonId | null) ?? null}
          initial={{
            patternId: annotation?.patternId ?? null,
            conviction: (annotation?.conviction as Conviction | null) ?? null,
            horizonOverride: (annotation?.horizonOverride as HorizonId | null) ?? null,
            processGrade: (annotation?.processGrade as ProcessGrade | null) ?? null,
            mistakes: annotation?.mistakes ?? [],
            reasoning: annotation?.reasoning ?? "",
            notes: annotation?.notes ?? "",
          }}
        />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="label-faint">{label}</dt>
      <dd className="figure mt-0.5">{value}</dd>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
