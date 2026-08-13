import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { orderLog, patterns } from "@/lib/db/schema";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { BOOKS, BOOK_IDS, type BookId } from "@/lib/books";
import { formatDateTime } from "@/lib/time";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Every order the engine considered, including the ones it refused to send.
 *
 * Rejections are the point of this screen as much as fills are. Without the
 * refused attempts the guards are unfalsifiable — you cannot tell a guard that
 * is working from one that never fires.
 */

const OUTCOMES = [
  "rejected_by_guard",
  "dry_run",
  "submitted",
  "filled",
  "broker_rejected",
  "error",
] as const;

const OUTCOME_LABEL: Record<string, string> = {
  rejected_by_guard: "Refused by a guard",
  dry_run: "Dry run",
  submitted: "Submitted",
  filled: "Filled",
  broker_rejected: "Broker rejected",
  error: "Error",
};

export default async function OrderLogPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; outcome?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  const bookFilter = BOOK_IDS.find((b) => b === params.book);
  const outcomeFilter = OUTCOMES.find((o) => o === params.outcome);

  const conditions = [
    bookFilter ? eq(orderLog.book, bookFilter) : undefined,
    outcomeFilter ? eq(orderLog.outcome, outcomeFilter) : undefined,
  ].filter(Boolean);

  const [rows, patternRows] = await Promise.all([
    db
      .select()
      .from(orderLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(orderLog.createdAt))
      .limit(400),
    db.select({ id: patterns.id, name: patterns.name }).from(patterns),
  ]);

  const patternName = new Map(patternRows.map((p) => [p.id, p.name]));

  const counts = Object.fromEntries(
    OUTCOMES.map((o) => [o, rows.filter((r) => r.outcome === o).length]),
  ) as Record<(typeof OUTCOMES)[number], number>;

  // Which guard refuses most. A guard that never fires is either redundant or
  // the engine is never getting far enough to reach it — both worth knowing.
  const byGuard = new Map<string, number>();
  for (const r of rows) {
    if (r.outcome !== "rejected_by_guard" || !r.rejectedBy) continue;
    byGuard.set(r.rejectedBy, (byGuard.get(r.rejectedBy) ?? 0) + 1);
  }
  const guards = [...byGuard.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Order Log"
        subtitle={`${rows.length} decisions${bookFilter ? ` · ${BOOKS[bookFilter].label}` : ""}`}
        action={
          <Link
            href="/engine"
            className="rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
          >
            Engine controls
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Chip href="/orders" active={!bookFilter && !outcomeFilter} label="All" />
        {BOOK_IDS.map((b) => (
          <Chip
            key={b}
            href={`/orders?book=${b}`}
            active={bookFilter === b}
            label={BOOKS[b].label}
            dot={BOOKS[b].colorVar}
          />
        ))}
        {OUTCOMES.map((o) => (
          <Chip
            key={o}
            href={`/orders?outcome=${o}`}
            active={outcomeFilter === o}
            label={`${OUTCOME_LABEL[o]} ${counts[o] || ""}`.trim()}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--color-ink-mute)]">
            Nothing yet. The engine writes here the moment it considers an order —
            including the ones it refuses. Arm a book in dry run on{" "}
            <Link href="/engine" className="text-[var(--color-accent)]">
              Engine
            </Link>{" "}
            and run a tick to see what it would do.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Considered" value={<span className="figure">{rows.length}</span>} />
            <StatTile
              label="Refused"
              value={
                <span className="figure text-[var(--color-warn)]">
                  {counts.rejected_by_guard}
                </span>
              }
              sub={guards[0] ? `most often: ${guards[0][0]}` : undefined}
            />
            <StatTile label="Dry run" value={<span className="figure">{counts.dry_run}</span>} />
            <StatTile
              label="Submitted"
              value={<span className="figure text-[var(--color-accent)]">{counts.submitted}</span>}
            />
            <StatTile
              label="Broker rejected"
              value={
                <span className="figure text-[var(--color-warn)]">{counts.broker_rejected}</span>
              }
            />
            <StatTile
              label="Errors"
              value={<span className="figure text-[var(--color-warn)]">{counts.error}</span>}
            />
          </div>

          {guards.length > 0 && (
            <Card className="mb-4 p-4">
              <h2 className="label">Which guard refused</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {guards.map(([g, n]) => (
                  <span
                    key={g}
                    className="rounded-full border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-ink-dim)]"
                  >
                    {g} <span className="figure text-[var(--color-warn)]">{n}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                    <Th>When</Th>
                    <Th>Book</Th>
                    <Th>Instrument</Th>
                    <Th>Side</Th>
                    <Th align="right">Units</Th>
                    <Th align="right">Stop</Th>
                    <Th>Pattern</Th>
                    <Th>Outcome</Th>
                    <Th>Why</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-card-raised)]"
                    >
                      <Td className="whitespace-nowrap text-[var(--color-ink-dim)]">
                        {formatDateTime(r.createdAt)}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: BOOKS[r.book as BookId]?.colorVar }}
                          />
                          <span className="text-[var(--color-ink-dim)]">
                            {BOOKS[r.book as BookId]?.label ?? r.book}
                          </span>
                        </span>
                      </Td>
                      <Td className="font-medium">{r.instrument}</Td>
                      <Td>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-dim)]">
                          {r.direction}
                        </span>
                      </Td>
                      <Td align="right" className="figure text-[var(--color-ink-dim)]">
                        {Number(r.units).toLocaleString()}
                      </Td>
                      <Td align="right" className="figure text-[var(--color-ink-mute)]">
                        {r.requestedStop ? Number(r.requestedStop).toFixed(5) : "—"}
                      </Td>
                      <Td className="text-[var(--color-ink-mute)]">
                        {r.patternId ? (patternName.get(r.patternId) ?? r.patternId) : "—"}
                      </Td>
                      <Td>
                        <span
                          className={clsx(
                            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            r.outcome === "submitted" || r.outcome === "filled"
                              ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                              : r.outcome === "dry_run"
                                ? "bg-[var(--color-line)] text-[var(--color-ink-dim)]"
                                : "bg-[var(--color-warn-wash)] text-[var(--color-warn)]",
                          )}
                        >
                          {OUTCOME_LABEL[r.outcome] ?? r.outcome}
                        </span>
                      </Td>
                      <Td className="max-w-[26rem] text-xs text-[var(--color-ink-mute)]">
                        {r.rejectedBy && (
                          <span className="mr-1.5 text-[var(--color-warn)]">{r.rejectedBy}:</span>
                        )}
                        {r.reason}
                      </Td>
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

function Chip({
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

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={clsx("label-faint px-3 py-2.5", align === "right" ? "text-right" : "text-left")}>
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
    <td className={clsx("px-3 py-2", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </td>
  );
}
