import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { books as booksTable, executionState, patterns } from "@/lib/db/schema";
import { loadTrades } from "@/lib/analytics/load";
import { summarise } from "@/lib/analytics/stats";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RMultiple } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/Page";
import { BOOKS, BOOK_IDS, type BookId, type Conviction } from "@/lib/books";
import { MISTAKE_CATEGORIES, PROCESS_GRADES } from "@/lib/journal/taxonomy";
import { clsx } from "@/lib/clsx";

export const dynamic = "force-dynamic";

/**
 * Playbook & Rules.
 *
 * Deliberately NOT a free-text document. Every rule shown here is read from the
 * configuration the system actually enforces — book risk, daily limits,
 * conviction multipliers, engine guards — so the playbook cannot drift away
 * from behaviour. A written rule that the software ignores is worse than no
 * rule, because it creates the belief that something is being enforced.
 *
 * Where a rule is genuinely a matter of judgement rather than enforcement, it
 * is labelled as such rather than dressed up as a control.
 */
export default async function PlaybookPage() {
  await requireSession();
  const user = await requireUser();

  const [bookRows, states, patternRows, trades] = await Promise.all([
    db.select().from(booksTable),
    db.select().from(executionState),
    db.select().from(patterns).where(eq(patterns.status, "live")).orderBy(asc(patterns.name)),
    loadTrades({ userId: user.id }),
  ]);

  const s = summarise(trades);
  const cfg = new Map(bookRows.map((b) => [b.id as BookId, b]));
  const state = new Map(states.map((x) => [x.book as BookId, x]));

  const enforced = [
    {
      rule: "Every trade carries a hard stop",
      by: "Not enforced by software — this is your discipline. The engine refuses to submit an order without one, but a manual trade can be placed without.",
      status:
        trades.filter((t) => t.rMultiple === null).length === 0
          ? ("held" as const)
          : ("broken" as const),
      detail: `${trades.filter((t) => t.rMultiple === null).length} of ${trades.length} closed trades have no computable R.`,
    },
    {
      rule: "The engine cannot place an order without a stop",
      by: "guards.ts — a null stop price is refused before anything reaches the broker.",
      status: "enforced" as const,
      detail: "Deny by default: missing or unparseable input is a refusal, not a pass.",
    },
    {
      rule: "The engine cannot trade real money without an explicit unlock",
      by: "executionState.allowLiveCapital, read by the guards rather than inferred from the environment.",
      status: "enforced" as const,
      detail: `${states.filter((x) => x.allowLiveCapital).length} of ${BOOK_IDS.length} books unlocked.`,
    },
    {
      rule: "Arming a book never sends an order on its own",
      by: "armBook() forces dryRun back on every time, so going live is always a second deliberate click.",
      status: "enforced" as const,
      detail: `${states.filter((x) => x.state === "armed" && !x.dryRun).length} books armed and live.`,
    },
    {
      rule: "Only allow-listed instruments and patterns can be traded",
      by: "Empty lists permit nothing, and both default to empty.",
      status: "enforced" as const,
      detail: `${new Set(states.flatMap((x) => x.enabledPatternIds)).size} patterns and ${new Set(states.flatMap((x) => x.instrumentAllowlist)).size} instruments enabled in total.`,
    },
    {
      rule: "A stop can never be moved further from entry",
      by: "manage.ts clamps it, the engine passes the current stop as context, and execution.ts refuses a loosening modify.",
      status: "enforced" as const,
      detail: "Checked in three independent places, plus a property test sweeping both directions.",
    },
    {
      rule: "Promotion to live capital is a manual decision",
      by: "Nothing in the codebase changes a pattern's status on a passing backtest.",
      status: "enforced" as const,
      detail: `${patternRows.length} patterns currently marked live.`,
    },
    {
      rule: "Trade the plan, or record that you didn't",
      by: "Judgement. The review screen marks off-plan trades, but only for trades you have tagged.",
      status: "judgement" as const,
      detail: "Naming setups in the morning is what makes this checkable in the evening.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Playbook"
        subtitle="The rules, read from the configuration that actually enforces them"
        action={
          <Link
            href="/settings"
            className="rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
          >
            Change them
          </Link>
        }
      />

      <Card className="mb-4 p-5">
        <CardHeader title="Risk limits, per book" />
        <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
          Percentages apply to each book&apos;s own equity, because each book is a separate
          sub-account. A blown book cannot reach another&apos;s capital — that isolation is
          enforced by the broker, not by tagging.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className="label-faint py-2 text-left">Book</th>
                <th className="label-faint py-2 text-right">Base risk</th>
                <th className="label-faint py-2 text-right">Daily limit</th>
                <th className="label-faint py-2 text-right">A+</th>
                <th className="label-faint py-2 text-right">A</th>
                <th className="label-faint py-2 text-right">B</th>
                <th className="label-faint py-2 text-right">C</th>
                <th className="label-faint py-2 text-right">Max open</th>
                <th className="label-faint py-2 text-right">Max risk ×</th>
              </tr>
            </thead>
            <tbody>
              {BOOK_IDS.map((b) => {
                const c = cfg.get(b);
                const st = state.get(b);
                const mult = (c?.convictionMultipliers ?? {}) as Record<Conviction, number>;
                return (
                  <tr key={b} className="border-b border-[var(--color-line)]/60 last:border-0">
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: BOOKS[b].colorVar }}
                        />
                        {BOOKS[b].label}
                      </span>
                    </td>
                    <td className="figure py-2 text-right">{Number(c?.baseRiskPct ?? 0)}%</td>
                    <td className="figure py-2 text-right">
                      {Number(c?.dailyLimitR ?? 0).toFixed(1)}R
                    </td>
                    {(["A+", "A", "B", "C"] as Conviction[]).map((g) => (
                      <td key={g} className="figure py-2 text-right text-[var(--color-ink-dim)]">
                        {mult[g] ?? "—"}×
                      </td>
                    ))}
                    <td className="figure py-2 text-right text-[var(--color-ink-mute)]">
                      {st?.maxOpenPositions ?? "—"}
                    </td>
                    <td className="figure py-2 text-right text-[var(--color-ink-mute)]">
                      {st ? `${Number(st.maxRiskMultiple).toFixed(2)}×` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
          Conviction multipliers are only rational if conviction predicts outcome. That is
          measured directly on{" "}
          <Link href="/performance" className="text-[var(--color-accent)]">
            Performance
          </Link>{" "}
          — if A+ does not beat B, this table is losing money.
        </p>
      </Card>

      <Card className="mb-4 p-5">
        <CardHeader title="What the software actually enforces" />
        <div className="mt-3 space-y-2">
          {enforced.map((r) => (
            <div
              key={r.rule}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3.5 py-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{r.rule}</span>
                <span
                  className={clsx(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    r.status === "enforced"
                      ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                      : r.status === "held"
                        ? "bg-[var(--color-line)] text-[var(--color-ink-dim)]"
                        : "bg-[var(--color-warn-wash)] text-[var(--color-warn)]",
                  )}
                >
                  {r.status === "judgement" ? "your judgement" : r.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                {r.by}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-mute)]">{r.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Pre-trade checklist" />
          <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
            Six questions, because a checklist you skip is worse than none.
          </p>
          <ol className="mt-3 space-y-2">
            {[
              "Is this one of the setups I named this morning?",
              "Where is the stop, and is it a level rather than a number I like?",
              "What size does that stop imply at this book's base risk?",
              "What would make me wrong, and would I actually act on it?",
              "Am I inside my daily limit, counting what is already open?",
              "Is anything correlated already on?",
            ].map((q, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] text-[var(--color-ink-dim)]">
                <span className="figure shrink-0 text-[var(--color-accent)]">{i + 1}</span>
                {q}
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-5">
          <CardHeader title="How trades are graded" />
          <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
            Process, deliberately independent of outcome.
          </p>
          <div className="mt-3 space-y-1.5">
            {PROCESS_GRADES.map((g) => (
              <div key={g.id} className="flex gap-3 text-[13px]">
                <span className="w-4 font-semibold text-[var(--color-accent)]">{g.label}</span>
                <span className="text-[var(--color-ink-dim)]">{g.hint}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Without this separation you unconsciously learn that whatever made money was
            correct, which is how a sound process gets abandoned after two bad trades.
          </p>
          <div className="mt-4">
            <span className="label-faint">Mistake taxonomy</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MISTAKE_CATEGORIES.map((c) => (
                <span
                  key={c.id}
                  className="rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink-mute)]"
                >
                  {c.label} · {c.items.length}
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Closed trades"
          value={<span className="figure">{s.trades}</span>}
          sub={`${s.independentExits} independent`}
        />
        <StatTile
          label="Trades with a stop"
          value={
            <span className="figure">
              {s.trades
                ? `${(((s.trades - trades.filter((t) => t.rMultiple === null).length) / s.trades) * 100).toFixed(0)}%`
                : "—"}
            </span>
          }
        />
        <StatTile label="Expectancy" value={
          s.expectancyR === null ? <span className="text-[var(--color-ink-faint)]">—</span> : <RMultiple value={s.expectancyR} />
        } />
        <StatTile
          label="Live patterns"
          value={<span className="figure">{patternRows.length}</span>}
        />
      </div>
    </>
  );
}
