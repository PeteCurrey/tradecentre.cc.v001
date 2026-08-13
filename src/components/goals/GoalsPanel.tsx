"use client";

import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { addGoal, deleteGoal } from "@/lib/goals/actions";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  ErrorNote,
  Field,
  SaveButton,
  TextArea,
  TextInput,
  useSaver,
} from "@/components/daily/Fields";
import { GOAL_METRICS, metricDef, type GoalMetric, type GoalProgress } from "@/lib/goals/score";
import { BOOKS, BOOK_IDS, type BookId } from "@/lib/books";
import { clsx } from "@/lib/clsx";

export type GoalRow = {
  id: number;
  period: string;
  metric: GoalMetric;
  target: number;
  book: BookId | null;
  note: string | null;
  progress: GoalProgress;
};

export function GoalsPanel({
  goals,
  periods,
}: {
  goals: GoalRow[];
  periods: { month: string; quarter: string; year: string };
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <GoalList goals={goals} />
      <AddGoal periods={periods} />
    </div>
  );
}

function GoalList({ goals }: { goals: GoalRow[] }) {
  const { save, pending, error } = useSaver();

  if (goals.length === 0) {
    return (
      <Card className="p-8">
        <h2 className="label">No goals set</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
          Every goal here names a metric the app already computes from the broker ledger,
          so progress is measured rather than self-reported. That is the constraint worth
          keeping: a goal you tick off yourself is a note, and notes belong in the daily
          review.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
          Worth considering a process goal before a P&amp;L one. &ldquo;Rule adherence
          above 90%&rdquo; is something you control; &ldquo;+20R this quarter&rdquo; is
          mostly a statement about the market.
        </p>
      </Card>
    );
  }

  const byPeriod = new Map<string, GoalRow[]>();
  for (const g of goals) {
    byPeriod.set(g.period, [...(byPeriod.get(g.period) ?? []), g]);
  }

  return (
    <div className="space-y-4">
      {[...byPeriod.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([period, rows]) => (
          <Card key={period} className="p-5">
            <CardHeader
              title={period}
              action={
                <span className="label-faint">
                  {rows.filter((r) => r.progress.met).length}/{rows.length} met
                </span>
              }
            />
            <div className="mt-3 space-y-2.5">
              {rows.map((g) => {
                const def = metricDef(g.metric);
                const p = g.progress;
                return (
                  <div
                    key={g.id}
                    className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{def.label}</span>
                      <span className="text-xs text-[var(--color-ink-mute)]">
                        {def.lowerIsBetter ? "at most" : "at least"}{" "}
                        <span className="figure">{def.format(g.target)}</span>
                      </span>
                      {g.book && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-mute)]">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: BOOKS[g.book].colorVar }}
                          />
                          {BOOKS[g.book].label}
                        </span>
                      )}
                      {p.met && (
                        <span className="inline-flex items-center gap-1 rounded bg-[var(--color-accent-wash)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
                          <Check className="size-3" /> met
                        </span>
                      )}
                      <button
                        onClick={() => save(() => deleteGoal(g.id))}
                        disabled={pending}
                        className="ml-auto rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-warn)]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-3">
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                        {p.fraction !== null && (
                          <div
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                              width: `${p.fraction * 100}%`,
                              // Progress is interface state, not money.
                              background: "var(--color-accent)",
                              opacity: p.met ? 1 : 0.6,
                            }}
                          />
                        )}
                      </div>
                      <span className="figure w-20 text-right text-xs">
                        {p.actual === null ? (
                          <span className="text-[var(--color-ink-faint)]">no data</span>
                        ) : (
                          def.format(p.actual)
                        )}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <span className="text-[11px] text-[var(--color-ink-faint)]">
                        {p.sample} trades
                        {p.sample > 0 && p.independentExits < p.sample * 0.5 && (
                          <span className="text-[var(--color-warn)]">
                            {" "}
                            · only {p.independentExits} independent exits
                          </span>
                        )}
                      </span>
                      {g.note && (
                        <span className="text-[11px] text-[var(--color-ink-mute)]">
                          {g.note}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      <ErrorNote error={error} />
    </div>
  );
}

function AddGoal({ periods }: { periods: { month: string; quarter: string; year: string } }) {
  const { save, pending, saved, error } = useSaver();
  const [period, setPeriod] = useState(periods.month);
  const [metric, setMetric] = useState<GoalMetric>("adherence_pct");
  const [target, setTarget] = useState("90");
  const [book, setBook] = useState<BookId | null>(null);
  const [note, setNote] = useState("");

  const def = metricDef(metric);

  function submit() {
    save(async () => {
      const res = await addGoal({
        period,
        metric,
        target: Number(target),
        book,
        note,
      });
      if (res.ok) setNote("");
      return res;
    });
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Set a goal"
        action={<SaveButton onClick={submit} pending={pending} saved={saved} label="Add" />}
      />

      <div className="mt-4 space-y-3">
        <Field label="Period">
          <div className="flex flex-wrap gap-1.5">
            {[periods.month, periods.quarter, periods.year].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-[11px]",
                  period === p
                    ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-ink-mute)]",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-1.5">
            <TextInput value={period} onChange={setPeriod} placeholder="2026-08" />
          </div>
        </Field>

        <Field label="Metric" hint={def.hint}>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as GoalMetric)}
            className="w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent-line)]"
          >
            {GOAL_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={def.lowerIsBetter ? "Ceiling" : "Target"}>
          <TextInput value={target} onChange={setTarget} placeholder="90" />
        </Field>

        <Field label="Book" hint="Leave unset for all live books.">
          <div className="flex flex-wrap gap-1.5">
            {BOOK_IDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBook(book === b ? null : b)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                  book === b
                    ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-ink-mute)]",
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: BOOKS[b].colorVar }}
                />
                {BOOKS[b].label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Note">
          <TextArea value={note} onChange={setNote} rows={2} placeholder="Why this one." />
        </Field>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Drawdown and trade count score as ceilings automatically — set as
        higher-is-better, a drawdown goal would congratulate you for a bigger loss.
      </p>

      <ErrorNote error={error} />
    </Card>
  );
}
