"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { saveAnnotation } from "@/lib/journal/actions";
import {
  MISTAKE_CATEGORIES,
  PROCESS_GRADES,
  type ProcessGrade,
} from "@/lib/journal/taxonomy";
import {
  CONVICTION_COLOR_VAR,
  CONVICTION_GRADES,
  HORIZONS,
  HORIZON_IDS,
  type Conviction,
  type HorizonId,
} from "@/lib/books";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";

export type AnnotationValues = {
  patternId: number | null;
  conviction: Conviction | null;
  horizonOverride: HorizonId | null;
  processGrade: ProcessGrade | null;
  mistakes: string[];
  reasoning: string;
  notes: string;
};

export function AnnotationForm({
  accountId,
  oandaTradeId,
  initial,
  patterns,
  inferredHorizon,
}: {
  accountId: string;
  oandaTradeId: string;
  initial: AnnotationValues;
  patterns: Array<{ id: number; name: string; horizon: string }>;
  /** What hold time classified this as, so the override shows what it replaces. */
  inferredHorizon: HorizonId | null;
}) {
  const [values, setValues] = useState<AnnotationValues>(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof AnnotationValues>(key: K, value: AnnotationValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }

  function toggleMistake(id: string) {
    setValues((v) => ({
      ...v,
      mistakes: v.mistakes.includes(id)
        ? v.mistakes.filter((m) => m !== id)
        : [...v.mistakes, id],
    }));
    setSaved(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveAnnotation({ accountId, oandaTradeId, ...values });
      if (res.ok) {
        setSaved(true);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Journal"
        action={
          <button
            onClick={submit}
            disabled={pending}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              saved
                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "bg-[var(--color-accent)] text-black hover:opacity-90",
              pending && "opacity-60",
            )}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : saved ? (
              <Check className="size-3.5" />
            ) : null}
            {pending ? "Saving" : saved ? "Saved" : "Save"}
          </button>
        }
      />

      {error && (
        <p className="mt-3 rounded-lg bg-[var(--color-loss-wash)] px-3 py-2 text-xs text-[var(--color-loss)]">
          {error}
        </p>
      )}

      {/* ---- Pattern ---- */}
      <Field label="Pattern" className="mt-4">
        <select
          value={values.patternId ?? ""}
          onChange={(e) => update("patternId", e.target.value ? Number(e.target.value) : null)}
          className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent-line)]"
        >
          <option value="">Untagged</option>
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.horizon})
            </option>
          ))}
        </select>
      </Field>

      {/* ---- Conviction ---- */}
      <Field
        label="Conviction"
        hint="What you thought at entry — sizing depends on this, so the app checks whether it actually predicts outcome."
        className="mt-4"
      >
        <div className="flex gap-1.5">
          {CONVICTION_GRADES.map((g) => {
            const active = values.conviction === g;
            return (
              <button
                key={g}
                onClick={() => update("conviction", active ? null : g)}
                className={clsx(
                  "h-9 flex-1 rounded-lg border text-[13px] font-semibold transition-colors",
                  active
                    ? "border-transparent text-black"
                    : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]",
                )}
                style={active ? { background: CONVICTION_COLOR_VAR[g] } : undefined}
              >
                {g}
              </button>
            );
          })}
        </div>
      </Field>

      {/* ---- Horizon override ---- */}
      <Field
        label="Hold time"
        hint={
          inferredHorizon
            ? `Classified as ${HORIZONS[inferredHorizon].label} from the actual hold. Override only if that misreads your intent.`
            : "No hold time yet — the trade is still open."
        }
        className="mt-4"
      >
        <div className="flex gap-1.5">
          <button
            onClick={() => update("horizonOverride", null)}
            className={clsx(
              "h-9 flex-1 rounded-lg border text-[11px] font-semibold transition-colors",
              values.horizonOverride === null
                ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]",
            )}
          >
            Auto
          </button>
          {HORIZON_IDS.map((h) => {
            const active = values.horizonOverride === h;
            return (
              <button
                key={h}
                title={HORIZONS[h].description}
                onClick={() => update("horizonOverride", active ? null : h)}
                className={clsx(
                  "h-9 flex-1 rounded-lg border text-[11px] font-semibold transition-colors",
                  active
                    ? "border-transparent text-black"
                    : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]",
                )}
                style={active ? { background: HORIZONS[h].colorVar } : undefined}
              >
                {HORIZONS[h].label}
              </button>
            );
          })}
        </div>
      </Field>

      {/* ---- Process grade ---- */}
      <Field
        label="Process grade"
        hint="Grade the execution, NOT the outcome. A well-executed loser is an A; a sloppy winner is a C."
        className="mt-4"
      >
        <div className="flex gap-1.5">
          {PROCESS_GRADES.map((g) => {
            const active = values.processGrade === g.id;
            return (
              <button
                key={g.id}
                title={g.hint}
                onClick={() => update("processGrade", active ? null : g.id)}
                className={clsx(
                  "h-9 flex-1 rounded-lg border text-[13px] font-semibold transition-colors",
                  active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]",
                )}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </Field>

      {/* ---- Mistakes ---- */}
      <Field label="Mistakes" hint="Each one gets costed in R across the Mistakes & Leaks screen." className="mt-4">
        <div className="space-y-3">
          {MISTAKE_CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <div className="label-faint mb-1.5">{cat.label}</div>
              <div className="flex flex-wrap gap-1">
                {cat.items.map((m) => {
                  const active = values.mistakes.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleMistake(m.id)}
                      className={clsx(
                        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                        active
                          ? "border-[var(--color-warn)] bg-[var(--color-warn-wash)] text-[var(--color-warn)]"
                          : "border-[var(--color-line)] text-[var(--color-ink-mute)] hover:border-[var(--color-line-strong)]",
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Field>

      <Field label="Why I took it" className="mt-4">
        <textarea
          rows={3}
          value={values.reasoning}
          onChange={(e) => update("reasoning", e.target.value)}
          placeholder="What you saw at the time…"
          className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent-line)]"
        />
      </Field>

      <Field label="Review notes" className="mt-4">
        <textarea
          rows={3}
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="With hindsight…"
          className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent-line)]"
        />
      </Field>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="label mb-1.5">{label}</div>
      {hint && (
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-ink-mute)]">{hint}</p>
      )}
      {children}
    </div>
  );
}
