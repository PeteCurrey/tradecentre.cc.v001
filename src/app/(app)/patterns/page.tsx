import Link from "next/link";
import { asc } from "drizzle-orm";
import { FlaskConical, ShieldCheck, Archive } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { patterns as patternsTable } from "@/lib/db/schema";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { HORIZONS, HORIZON_IDS, type HorizonId } from "@/lib/books";
import { describeTrigger } from "@/lib/patterns/describe";
import type { Condition } from "@/lib/patterns/dsl";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

const FAMILY_LABEL: Record<string, string> = {
  liquidity: "Liquidity",
  "price-action": "Price action",
  indicator: "Indicator",
  session: "Session",
};

const STATUS: Record<string, { label: string; icon: typeof FlaskConical; className: string }> = {
  incubating: {
    label: "Incubating",
    icon: FlaskConical,
    className: "border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] text-[var(--color-warn)]",
  },
  live: {
    label: "Live",
    icon: ShieldCheck,
    className: "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]",
  },
  retired: {
    label: "Retired",
    icon: Archive,
    className: "border-[var(--color-line)] text-[var(--color-ink-mute)]",
  },
};

export default async function PatternLibraryPage() {
  await requireSession();

  const rows = await db.select().from(patternsTable).orderBy(asc(patternsTable.id));

  // Grouped by HORIZON — a pattern's hold time is a property of the setup.
  // Books are instrument-class accounts and are a separate dimension.
  const byHorizon = new Map<string, typeof rows>();
  for (const p of rows) {
    const tags = p.tags as { horizons?: string[] };
    const h = tags.horizons?.[0] ?? "unassigned";
    if (!byHorizon.has(h)) byHorizon.set(h, []);
    byHorizon.get(h)!.push(p);
  }

  const liveCount = rows.filter((p) => p.status === "live").length;

  return (
    <>
      <PageHeader
        title="Pattern Library"
        subtitle={`${rows.length} patterns · ${liveCount} live · ${rows.length - liveCount} awaiting promotion`}
      />

      {/* The honesty banner. These are hypotheses until Peter's own data says
          otherwise, and the screen should say so rather than imply authority. */}
      <div className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
        <p className="text-xs leading-relaxed text-[var(--color-warn)]">
          These are <strong>candidates, not edges</strong>. Every one is drawn from public
          technical literature and none is known to be profitable on your instruments at your
          costs. They exist to be measured — backtest, then demo, then live only once your own
          data earns it.
        </p>
      </div>

      <div className="space-y-6">
        {HORIZON_IDS.map((h: HorizonId) => {
          const list = byHorizon.get(h) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={h}>
              <div className="mb-2.5 flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: HORIZONS[h].colorVar }}
                />
                <h2 className="display text-sm">{HORIZONS[h].label}</h2>
                <span className="label-faint">
                  {HORIZONS[h].description} · {list.length} patterns
                </span>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {list.map((p) => {
                  const tags = p.tags as {
                    conditions?: string[];
                    timeframes?: string[];
                    instrumentClasses?: string[];
                  };
                  const ctx = p.contextFilters as { direction?: string };
                  const trigger = (p.triggerRules as Condition[])[0];
                  const conditions = trigger ? describeTrigger(trigger) : [];
                  const status = STATUS[p.status] ?? STATUS.incubating;
                  const StatusIcon = status.icon;

                  return (
                    <Link key={p.slug} href={`/patterns/${p.slug}`} className="group">
                      <Card className="h-full p-4 transition-colors group-hover:border-[var(--color-line-strong)]">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-[15px] font-semibold leading-tight">{p.name}</h3>
                          <span
                            className={clsx(
                              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              status.className,
                            )}
                          >
                            <StatusIcon className="size-2.5" />
                            {status.label}
                          </span>
                        </div>

                        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-mute)]">
                          {p.summary}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-1">
                          <Tag>{FAMILY_LABEL[tags.conditions?.[0] ?? ""] ?? "—"}</Tag>
                          <Tag>{tags.timeframes?.[0] ?? "—"}</Tag>
                          <Tag
                            className={
                              ctx.direction === "long"
                                ? "text-[var(--color-accent)]"
                                : undefined
                            }
                          >
                            {ctx.direction ?? "—"}
                          </Tag>
                        </div>

                        <div className="mt-3 border-t border-[var(--color-line)] pt-2.5">
                          <span className="label-faint">Triggers when</span>
                          <ul className="mt-1.5 space-y-1">
                            {conditions.slice(0, 3).map((c, i) => (
                              <li
                                key={i}
                                className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-ink-dim)]"
                              >
                                <span className="text-[var(--color-ink-faint)]">·</span>
                                <span>{c}</span>
                              </li>
                            ))}
                            {conditions.length > 3 && (
                              <li className="pl-3 text-[11px] text-[var(--color-ink-faint)]">
                                +{conditions.length - 3} more
                              </li>
                            )}
                          </ul>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-mute)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
