import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Ban, Crosshair, Info, Settings2, Target } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { patterns as patternsTable } from "@/lib/db/schema";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { HORIZONS, type HorizonId } from "@/lib/books";
import {
  describeCondition,
  describeStop,
  describeTarget,
  describeTrigger,
} from "@/lib/patterns/describe";
import type { Condition, ManagementRule, StopRule, TargetRule } from "@/lib/patterns/dsl";

export const dynamic = "force-dynamic";

export default async function PatternDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireSession();
  const { slug } = await params;

  const [pattern] = await db
    .select()
    .from(patternsTable)
    .where(eq(patternsTable.slug, slug))
    .limit(1);

  if (!pattern) notFound();

  const tags = pattern.tags as {
    horizons?: string[];
    conditions?: string[];
    timeframes?: string[];
    instrumentClasses?: string[];
  };
  const ctx = pattern.contextFilters as {
    direction?: string;
    timeframe?: string;
    notes?: string[];
    invalidationRule?: Condition | null;
    stop?: StopRule;
    targets?: TargetRule[];
    management?: ManagementRule | null;
  };

  const trigger = (pattern.triggerRules as Condition[])[0];
  const conditions = trigger ? describeTrigger(trigger) : [];
  const horizon = (tags.horizons?.[0] ?? "intraday") as HorizonId;

  return (
    <>
      <Link
        href="/patterns"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-mute)] transition-colors hover:text-[var(--color-ink-dim)]"
      >
        <ArrowLeft className="size-3.5" />
        Pattern Library
      </Link>

      <PageHeader
        title={pattern.name}
        subtitle={pattern.summary ?? undefined}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-warn)]">
            {pattern.status}
          </span>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Meta label="Horizon">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: HORIZONS[horizon].colorVar }}
            />
            {HORIZONS[horizon].label}
          </span>
        </Meta>
        <Meta label="Timeframe">{ctx.timeframe ?? tags.timeframes?.[0] ?? "—"}</Meta>
        <Meta label="Direction">{ctx.direction ?? "—"}</Meta>
        <Meta label="Family">{tags.conditions?.[0] ?? "—"}</Meta>
        <Meta label="Instruments">{(tags.instrumentClasses ?? []).join(", ") || "—"}</Meta>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            title="Trigger"
            action={<Crosshair className="size-3.5 text-[var(--color-ink-faint)]" />}
          />
          <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
            All of the following must hold on the signal bar. Entry is the next bar&apos;s open.
          </p>
          <ol className="mt-3 space-y-2">
            {conditions.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                <span className="figure mt-0.5 grid size-4 shrink-0 place-items-center rounded bg-[var(--color-sunken)] text-[10px] text-[var(--color-ink-mute)]">
                  {i + 1}
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Invalidation"
            action={<Ban className="size-3.5 text-[var(--color-ink-faint)]" />}
          />
          <p className="mt-3 text-[13px] leading-relaxed">{pattern.invalidation}</p>
          {ctx.invalidationRule && (
            <div className="mt-3 rounded-lg bg-[var(--color-sunken)] px-3 py-2">
              <span className="label-faint">Checked automatically as</span>
              <p className="mt-1 text-[12px] text-[var(--color-ink-dim)]">
                {describeCondition(ctx.invalidationRule)}
              </p>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Stop & targets"
            action={<Target className="size-3.5 text-[var(--color-ink-faint)]" />}
          />
          <dl className="mt-3 space-y-2.5 text-[13px]">
            <div>
              <dt className="label-faint">Stop</dt>
              <dd className="mt-0.5">{ctx.stop ? describeStop(ctx.stop) : "—"}</dd>
            </div>
            {(ctx.targets ?? []).map((t, i) => (
              <div key={i}>
                <dt className="label-faint">Target {i + 1}</dt>
                <dd className="mt-0.5">{describeTarget(t)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Management"
            action={<Settings2 className="size-3.5 text-[var(--color-ink-faint)]" />}
          />
          {ctx.management ? (
            <dl className="mt-3 space-y-2.5 text-[13px]">
              {ctx.management.breakevenAtR !== undefined && (
                <Row label="Breakeven">
                  move the stop to entry at +{ctx.management.breakevenAtR}R
                </Row>
              )}
              {ctx.management.scaleOutFraction !== undefined && (
                <Row label="Scale out">
                  take {Math.round(ctx.management.scaleOutFraction * 100)}% off at the first target
                  <span className="mt-1 block text-[11px] text-[var(--color-warn)]">
                    Not modelled by the backtester — results assume all-or-nothing exits.
                  </span>
                </Row>
              )}
              {ctx.management.flattenAtHour !== undefined && (
                <Row label="Flatten">
                  close by {String(ctx.management.flattenAtHour).padStart(2, "0")}:00 London
                </Row>
              )}
              {ctx.management.trailOn && <Row label="Trail">on a moving reference</Row>}
            </dl>
          ) : (
            <p className="mt-3 text-[13px] text-[var(--color-ink-mute)]">
              No management rules — the trade runs to its stop or target.
            </p>
          )}
        </Card>
      </div>

      {(ctx.notes ?? []).length > 0 && (
        <Card className="mt-4 p-5">
          <CardHeader
            title="Context & caveats"
            action={<Info className="size-3.5 text-[var(--color-ink-faint)]" />}
          />
          <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
            Judgement, not code. Nothing here is evaluated automatically.
          </p>
          <ul className="mt-3 space-y-2">
            {(ctx.notes ?? []).map((n, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
                <span className="text-[var(--color-ink-dim)]">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2.5 py-1.5 text-xs">
      <span className="label-faint">{label}</span>
      <span className="text-[var(--color-ink)]">{children}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
