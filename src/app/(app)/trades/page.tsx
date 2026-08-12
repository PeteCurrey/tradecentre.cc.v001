import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { trades as tradesTable, accounts as accountsTable } from "@/lib/db/schema";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Money, RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import {
  BOOKS,
  BOOK_IDS,
  HORIZONS,
  HORIZON_IDS,
  type BookId,
  type HorizonId,
} from "@/lib/books";
import { formatDateTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

const num = (v: string | null) => (v === null ? null : Number(v));

export default async function TradeLogPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; horizon?: string }>;
}) {
  // Second layer behind the proxy check — this one runs in the data path.
  await requireSession();

  const params = await searchParams;

  // Two independent dimensions: book is the instrument-class account, horizon
  // is hold time. Filtering by both answers "how do I do on gold swings?".
  const bookFilter = BOOK_IDS.find((b) => b === params.book);
  const horizonFilter = HORIZON_IDS.find((h) => h === params.horizon);

  const conditions = [
    bookFilter ? eq(tradesTable.book, bookFilter) : undefined,
    horizonFilter ? eq(tradesTable.horizon, horizonFilter) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(tradesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tradesTable.entryTime))
    .limit(500);

  const accounts = await db.select().from(accountsTable);
  const currency = accounts[0]?.currency ?? "GBP";

  // Stats over the returned set. Closed trades only — an open trade has no
  // realised result, and counting it as zero would drag every average down.
  const closed = rows.filter((r) => r.state === "closed");
  const withR = closed.filter((r) => r.rMultiple !== null);
  const wins = closed.filter((r) => Number(r.realizedPl) > 0);
  const losses = closed.filter((r) => Number(r.realizedPl) < 0);

  const totalPl = closed.reduce((s, r) => s + Number(r.realizedPl), 0);
  const totalR = withR.reduce((s, r) => s + (r.rMultiple ?? 0), 0);
  const spread = rows.reduce((s, r) => s + Number(r.spreadCost), 0);
  const grossWin = wins.reduce((s, r) => s + Number(r.realizedPl), 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + Number(r.realizedPl), 0));

  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgR = withR.length ? totalR / withR.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  /**
   * Independent exits, not trade count.
   *
   * Trades closed in the same minute are one decision expressed as several
   * positions — scaling into a basket and closing it together. Counting them as
   * independent samples badly inflates confidence: 50 positions closed in one
   * minute is ONE outcome, not fifty. Peter's swing set is exactly this, so the
   * number is shown next to the trade count rather than buried.
   */
  const exitMinutes = new Set(
    closed
      .filter((r) => r.exitTime)
      .map((r) => Math.floor(r.exitTime!.getTime() / 60_000)),
  );
  const independentExits = exitMinutes.size;
  const clustered = closed.length > 0 && independentExits < closed.length * 0.5;

  return (
    <>
      <PageHeader
        title="Trade Log"
        subtitle={
          `${rows.length} trades · ` +
          (bookFilter ? BOOKS[bookFilter].label : "all books") +
          (horizonFilter ? ` · ${HORIZONS[horizonFilter].label}` : "")
        }
      />

      {/* ---- Filters: book (account) and horizon (hold time) are separate ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="label-faint mr-1">Book</span>
        <FilterChip
          href={horizonFilter ? `/trades?horizon=${horizonFilter}` : "/trades"}
          active={!bookFilter}
          label="All"
        />
        {BOOK_IDS.map((b: BookId) => (
          <FilterChip
            key={b}
            href={`/trades?book=${b}${horizonFilter ? `&horizon=${horizonFilter}` : ""}`}
            active={bookFilter === b}
            label={BOOKS[b].label}
            dot={BOOKS[b].colorVar}
          />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="label-faint mr-1">Hold</span>
        <FilterChip
          href={bookFilter ? `/trades?book=${bookFilter}` : "/trades"}
          active={!horizonFilter}
          label="Any"
        />
        {HORIZON_IDS.map((h: HorizonId) => (
          <FilterChip
            key={h}
            href={`/trades?horizon=${h}${bookFilter ? `&book=${bookFilter}` : ""}`}
            active={horizonFilter === h}
            label={HORIZONS[h].label}
            dot={HORIZONS[h].colorVar}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--color-ink-mute)]">
            No trades in this book yet. Run{" "}
            <code className="figure text-[var(--color-accent)]">npm run sync</code> to pull
            the ledger from OANDA.
          </p>
        </Card>
      ) : (
        <>
          {/* ---- Summary ---- */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Net P&L"
              value={<Money value={totalPl} currency={currency} />}
              sub={`${closed.length} closed`}
            />
            <StatTile label="Total R" value={<RMultiple value={totalR} decimals={1} />} />
            <StatTile label="Average R" value={<RMultiple value={avgR} />} />
            <StatTile
              label="Win rate"
              value={<span className="figure">{winRate.toFixed(1)}%</span>}
              sub={`${wins.length}W / ${losses.length}L`}
            />
            <StatTile
              label="Independent exits"
              value={
                <span
                  className={clsx(
                    "figure",
                    clustered ? "text-[var(--color-warn)]" : undefined,
                  )}
                >
                  {independentExits}
                </span>
              }
              sub={
                clustered
                  ? `of ${closed.length} trades — clustered`
                  : `of ${closed.length} trades`
              }
            />
            <StatTile
              label="Profit factor"
              value={
                <span
                  className={clsx(
                    "figure",
                    profitFactor !== null && profitFactor >= 1 ? "money-up" : "money-down",
                  )}
                >
                  {profitFactor?.toFixed(2) ?? "—"}
                </span>
              }
            />
            <StatTile
              label="Spread paid"
              value={<span className="figure text-[var(--color-warn)]">
                {spread.toFixed(0)}
              </span>}
              sub={grossWin ? `${((spread / grossWin) * 100).toFixed(0)}% of gross wins` : undefined}
            />
          </div>

          {clustered && (
            <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
              <p className="text-xs leading-relaxed text-[var(--color-warn)]">
                <strong>
                  {closed.length} trades, but only {independentExits} independent exits.
                </strong>{" "}
                Positions closed in the same minute are one decision, not several. Treat the
                win rate and average R above as describing roughly {independentExits}{" "}
                outcomes — not {closed.length}.
              </p>
            </div>
          )}

          {/* ---- Blotter ---- */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                    <Th>Entry</Th>
                    <Th>Instrument</Th>
                    <Th>Book</Th>
                    <Th>Hold</Th>
                    <Th align="right">Side</Th>
                    <Th align="right">Units</Th>
                    <Th align="right">In</Th>
                    <Th align="right">Out</Th>
                    <Th align="right">Stop</Th>
                    <Th align="right">R</Th>
                    <Th align="right">P&amp;L</Th>
                    <Th align="right">Spread</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const bookDef = BOOKS[t.book as BookId];
                    return (
                      <tr
                        key={t.id}
                        className="border-b border-[var(--color-line)]/60 transition-colors last:border-0 hover:bg-[var(--color-card-raised)]"
                      >
                        <Td className="whitespace-nowrap text-[var(--color-ink-dim)]">
                          <Link href={`/trades/${t.id}`} className="hover:text-[var(--color-accent)]">
                            {formatDateTime(t.entryTime)}
                          </Link>
                        </Td>
                        <Td className="font-medium">
                          <Link href={`/trades/${t.id}`} className="hover:text-[var(--color-accent)]">
                            {t.instrument}
                          </Link>
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: bookDef?.colorVar }}
                            />
                            <span className="text-[var(--color-ink-dim)]">
                              {bookDef?.label ?? t.book}
                            </span>
                          </span>
                        </Td>
                        <Td>
                          {t.horizon ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="size-1.5 rounded-full"
                                style={{
                                  background: HORIZONS[t.horizon as HorizonId].colorVar,
                                }}
                              />
                              <span className="text-[var(--color-ink-mute)]">
                                {HORIZONS[t.horizon as HorizonId].label}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-ink-faint)]">open</span>
                          )}
                        </Td>
                        <Td align="right">
                          <span
                            className={clsx(
                              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              t.direction === "long"
                                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                                : "bg-[var(--color-line)] text-[var(--color-ink-dim)]",
                            )}
                          >
                            {t.direction}
                          </span>
                        </Td>
                        <Td align="right" className="figure text-[var(--color-ink-dim)]">
                          {Number(t.units).toLocaleString()}
                        </Td>
                        <Td align="right" className="figure">
                          {Number(t.entryPrice).toFixed(5)}
                        </Td>
                        <Td align="right" className="figure text-[var(--color-ink-dim)]">
                          {t.exitPrice ? Number(t.exitPrice).toFixed(5) : "—"}
                        </Td>
                        <Td align="right" className="figure text-[var(--color-ink-mute)]">
                          {t.plannedStop ? Number(t.plannedStop).toFixed(5) : "—"}
                        </Td>
                        <Td align="right">
                          {t.rMultiple !== null ? (
                            <RMultiple value={t.rMultiple} />
                          ) : (
                            <span className="text-[var(--color-ink-faint)]">—</span>
                          )}
                        </Td>
                        <Td align="right">
                          {num(t.realizedPl) !== null ? (
                            <Money value={Number(t.realizedPl)} currency={currency} />
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td align="right" className="figure text-[var(--color-ink-mute)]">
                          {Number(t.spreadCost).toFixed(2)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function FilterChip({
  href,
  active,
  label,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  dot?: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
          : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]",
      )}
    >
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
      {label}
    </Link>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={clsx(
        "label-faint px-3 py-2.5",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={clsx(
        "px-3 py-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
