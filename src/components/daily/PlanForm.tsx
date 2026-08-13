"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveDailyPlan } from "@/lib/journal/daily";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  ErrorNote,
  Field,
  SaveButton,
  TextArea,
  TextInput,
  useSaver,
} from "./Fields";

export type PlanData = {
  day: string;
  bias: Record<string, string>;
  levels: Record<string, number[]>;
  setupsHunted: number[];
  notes: string | null;
  aiDraft: string | null;
};

export function PlanForm({
  plan,
  patterns,
}: {
  plan: PlanData;
  patterns: Array<{ id: number; name: string; status: string }>;
}) {
  const { save, pending, saved, error } = useSaver();

  const [bias, setBias] = useState<Array<[string, string]>>(
    Object.entries(plan.bias),
  );
  const [levels, setLevels] = useState<Array<[string, string]>>(
    Object.entries(plan.levels).map(([k, v]) => [k, v.join(", ")]),
  );
  const [setups, setSetups] = useState<number[]>(plan.setupsHunted);
  const [notes, setNotes] = useState(plan.notes ?? "");

  function submit() {
    save(() =>
      saveDailyPlan({
        day: plan.day,
        bias: Object.fromEntries(bias.filter(([k]) => k.trim())),
        levels: Object.fromEntries(
          levels
            .filter(([k]) => k.trim())
            .map(([k, v]) => [
              k,
              v
                .split(/[,\s]+/)
                .map(Number)
                .filter((n) => Number.isFinite(n) && n > 0),
            ]),
        ),
        setupsHunted: setups,
        notes,
      }),
    );
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Today's plan"
        action={<SaveButton onClick={submit} pending={pending} saved={saved} />}
      />

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field
            label="Bias"
            hint="One line per instrument — the condition, not a prediction. 'Long above 1.0850' beats 'bullish'."
          >
            <div className="space-y-1.5">
              {bias.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <TextInput
                    value={k}
                    onChange={(nv) =>
                      setBias((b) => b.map((row, j) => (j === i ? [nv, row[1]] : row)))
                    }
                    placeholder="EUR_USD"
                    className="w-32 shrink-0"
                  />
                  <TextInput
                    value={v}
                    onChange={(nv) =>
                      setBias((b) => b.map((row, j) => (j === i ? [row[0], nv] : row)))
                    }
                    placeholder="long above 1.0850, flat below"
                  />
                  <button
                    onClick={() => setBias((b) => b.filter((_, j) => j !== i))}
                    className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-warn)]"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <AddRow onClick={() => setBias((b) => [...b, ["", ""]])} label="Add instrument" />
            </div>
          </Field>

          <Field
            label="Key levels"
            hint="Comma-separated prices. These are what the watchlist and alerts key on."
          >
            <div className="space-y-1.5">
              {levels.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <TextInput
                    value={k}
                    onChange={(nv) =>
                      setLevels((l) => l.map((row, j) => (j === i ? [nv, row[1]] : row)))
                    }
                    placeholder="XAU_USD"
                    className="w-32 shrink-0"
                  />
                  <TextInput
                    value={v}
                    onChange={(nv) =>
                      setLevels((l) => l.map((row, j) => (j === i ? [row[0], nv] : row)))
                    }
                    placeholder="2340, 2355.5, 2372"
                  />
                  <button
                    onClick={() => setLevels((l) => l.filter((_, j) => j !== i))}
                    className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-warn)]"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <AddRow onClick={() => setLevels((l) => [...l, ["", ""]])} label="Add instrument" />
            </div>
          </Field>
        </div>

        <div className="space-y-4">
          <Field
            label="Setups hunted"
            hint="Naming them in advance is what makes 'traded outside the plan' checkable afterwards."
          >
            {patterns.length === 0 ? (
              <p className="text-xs text-[var(--color-ink-mute)]">
                No patterns in the library yet.
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {patterns.map((p) => {
                  const on = setups.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSetups((s) =>
                            on ? s.filter((x) => x !== p.id) : [...s, p.id],
                          )
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <span className={on ? "text-[var(--color-ink)]" : undefined}>
                        {p.name}
                      </span>
                      {p.status !== "live" && (
                        <span className="label-faint">{p.status}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Notes" hint="What would make today an A+ day, and what would make you stop.">
            <TextArea
              value={notes}
              onChange={setNotes}
              rows={7}
              placeholder="Conditions that make this a good day to trade. Conditions that mean stepping away."
            />
          </Field>
        </div>
      </div>

      <ErrorNote error={error} />
    </Card>
  );
}

function AddRow({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--color-line-strong)] px-2 py-1 text-[11px] text-[var(--color-ink-mute)] hover:border-[var(--color-accent-line)] hover:text-[var(--color-accent)]"
    >
      <Plus className="size-3" />
      {label}
    </button>
  );
}
