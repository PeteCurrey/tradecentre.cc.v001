import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { accounts, executionState, patterns } from "@/lib/db/schema";
import { loadTrades } from "@/lib/analytics/load";
import { groupBy, summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BOOKS, type BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Idea Lab — the incubation pipeline.
 *
 *   generated (incubating) → backtest gate → demo book → threshold → live
 *
 * The screen's job is to show where each candidate actually is in that
 * pipeline, and to make the gaps obvious. Promotion to live is a manual act by
 * Peter and never automatic on a passing backtest — a pattern that clears the
 * gate has earned a demo book, which is a different thing from having earned
 * capital.
 */

const STAGES = [
  {
    id: "generated",
    label: "Generated",
    hint: "Written from public technical literature. Nothing measured yet.",
  },
  {
    id: "backtested",
    label: "Through the gate",
    hint: "Screened with multiplicity control. Most candidates die here, as they should.",
  },
  {
    id: "demo",
    label: "Forward-tested",
    hint: "Running on a demo book with real spreads and real fills.",
  },
  {
    id: "live",
    label: "Live",
    hint: "Promoted by hand, on evidence. Never automatically.",
  },
] as const;

export default async function IdeaLabPage() {
  await requireSession();
  const user = await requireUser();

  const [patternRows, states, accountRows, demoTrades] = await Promise.all([
    db.select().from(patterns).orderBy(asc(patterns.name)),
    db.select().from(executionState),
    db.select().from(accounts).where(eq(accounts.active, true)),
    loadTrades({ userId: user.id, demo: true }),
  ]);

  const incubating = patternRows.filter((p) => p.status === "incubating");
  const live = patternRows.filter((p) => p.status === "live");
  const retired = patternRows.filter((p) => p.status === "retired");

  // A pattern is "enabled somewhere" if any book permits the engine to trade it.
  const enabledAnywhere = new Set(states.flatMap((s) => s.enabledPatternIds));
  const armedBooks = states.filter((s) => s.state === "armed");
  const dryRunOnly = armedBooks.every((s) => s.dryRun);

  const byPattern = groupBy(demoTrades, (t) => t.patternId);
  const demoSummary = summarise(demoTrades);

  const practiceAccounts = accountRows.filter((a) => a.environment === "practice");

  return (
    <>
      <PageHeader
        title="Idea Lab"
        subtitle={`${patternRows.length} candidates · ${incubating.length} incubating · ${live.length} live`}
        action={
          <Link
            href="/backtest"
            className="rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
          >
            Run the gate
          </Link>
        }
      />

      {/* ---- The pipeline, as it actually stands ------------------------- */}
      <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((s, i) => {
          const count =
            s.id === "generated"
              ? incubating.length
              : s.id === "backtested"
                ? 0
                : s.id === "demo"
                  ? enabledAnywhere.size
                  : live.length;
          return (
            <Card key={s.id} className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="label-faint">
                  {i + 1}. {s.label}
                </span>
                <span
                  className={clsx(
                    "figure text-lg",
                    count ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]",
                  )}
                >
                  {count}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                {s.hint}
              </p>
              {s.id === "backtested" && (
                <p className="mt-1.5 text-[11px] text-[var(--color-warn)]">
                  Gate results are not persisted yet — run one on the Backtest screen and
                  read it there.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Demo accounts"
          value={<span className="figure">{practiceAccounts.length}</span>}
        />
        <StatTile
          label="Demo trades"
          value={<span className="figure">{demoTrades.length}</span>}
          sub={`${demoSummary.independentExits} independent`}
        />
        <StatTile label="Demo R" value={<RMultiple value={demoSummary.totalR} decimals={1} />} />
        <StatTile
          label="Patterns enabled"
          value={
            <span
              className={clsx(
                "figure",
                enabledAnywhere.size ? "text-[var(--color-accent)]" : undefined,
              )}
            >
              {enabledAnywhere.size}
            </span>
          }
          sub="across all books"
        />
        <StatTile
          label="Books armed"
          value={
            <span
              className={clsx(
                "figure",
                armedBooks.length ? "text-[var(--color-accent)]" : undefined,
              )}
            >
              {armedBooks.length}
            </span>
          }
          sub={armedBooks.length ? (dryRunOnly ? "all dry run" : "some live") : undefined}
        />
        <StatTile label="Retired" value={<span className="figure">{retired.length}</span>} />
      </div>

      {enabledAnywhere.size === 0 && (
        <div className="mb-4 rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-sunken)] px-3.5 py-2.5">
          <p className="text-xs leading-relaxed text-[var(--color-ink-mute)]">
            No pattern is enabled on any book, so the engine permits nothing regardless of
            what is armed. That is the correct resting state: enabling a pattern is the
            decision that matters, and it is yours to make on the{" "}
            <Link href="/engine" className="text-[var(--color-accent)]">
              engine screen
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="p-5 pb-3">
            <CardHeader title="Candidates" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                  <th className="label-faint px-3 py-2.5 text-left">Pattern</th>
                  <th className="label-faint px-3 py-2.5 text-left">Status</th>
                  <th className="label-faint px-3 py-2.5 text-left">Enabled</th>
                  <th className="label-faint px-3 py-2.5 text-right">Demo trades</th>
                  <th className="label-faint px-3 py-2.5 text-right">Demo R</th>
                  <th className="label-faint px-3 py-2.5 text-left">Tags</th>
                </tr>
              </thead>
              <tbody>
                {patternRows.map((p) => {
                  const demo = byPattern.find((g) => g.key === p.id);
                  const tags = p.tags as {
                    horizons?: string[];
                    conditions?: string[];
                  };
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-card-raised)]"
                    >
                      <td className="px-3 py-2 font-medium">
                        <Link
                          href={`/patterns/${p.slug}`}
                          className="hover:text-[var(--color-accent)]"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={clsx(
                            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            p.status === "live"
                              ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                              : "bg-[var(--color-line)] text-[var(--color-ink-mute)]",
                          )}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {enabledAnywhere.has(p.id) ? (
                          <span className="text-xs text-[var(--color-accent)]">yes</span>
                        ) : (
                          <span className="text-xs text-[var(--color-ink-faint)]">no</span>
                        )}
                      </td>
                      <td className="figure px-3 py-2 text-right text-[var(--color-ink-dim)]">
                        {demo?.summary.trades ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {demo ? (
                          <RMultiple value={demo.summary.totalR} decimals={1} />
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[var(--color-ink-faint)]">
                        {[...(tags.horizons ?? []), ...(tags.conditions ?? [])]
                          .slice(0, 3)
                          .join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader title="Demo books" />
            <div className="mt-3 space-y-2">
              {practiceAccounts.map((a) => {
                const set = demoTrades.filter((t) => t.book === a.book);
                const s = summarise(set);
                return (
                  <div
                    key={a.id}
                    className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: BOOKS[a.book as BookId]?.colorVar }}
                        />
                        {BOOKS[a.book as BookId]?.label ?? a.book}
                      </span>
                      <span className="figure text-[11px] text-[var(--color-ink-mute)]">
                        {set.length} trades
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] text-[var(--color-ink-faint)]">{a.id}</span>
                      <RMultiple value={s.totalR} decimals={1} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Why promotion stays manual" />
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
              A pattern that clears the gate has shown it was not obviously noise on the
              history it was tested against. That is a much weaker claim than &ldquo;this
              makes money&rdquo;, and it is the strongest claim any backtest can make.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
              So a pass earns a demo book and nothing more. What happens there — with real
              spreads, real fills and real gaps — is the evidence that matters, and the
              decision to act on it is yours.
            </p>
          </Card>

          {demoTrades.length > 0 && byPattern.length === 0 && (
            <Card className="p-5">
              <CardHeader title="Demo trades are untagged" />
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
                There are {demoTrades.length} demo trades but none carries a pattern tag,
                so none of them can tell you anything about a specific candidate. They were
                placed by hand rather than by the engine — which is fine, but it means the
                per-pattern column above stays empty until the engine places them or you
                tag them.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
