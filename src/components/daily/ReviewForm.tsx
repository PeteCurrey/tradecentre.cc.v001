"use client";

import { useState } from "react";
import { saveDailyReview } from "@/lib/journal/daily";
import { Card, CardHeader } from "@/components/ui/Card";
import { PROCESS_GRADES } from "@/lib/journal/taxonomy";
import { ErrorNote, Field, SaveButton, TextArea, useSaver } from "./Fields";
import { clsx } from "@/lib/clsx";

export type ReviewData = {
  day: string;
  processGrade: string | null;
  adherencePct: number | null;
  whatWorked: string | null;
  whatBroke: string | null;
  tomorrow: string | null;
  notes: string | null;
  aiDraft: string | null;
};

export function ReviewForm({ review }: { review: ReviewData }) {
  const { save, pending, saved, error } = useSaver();

  const [grade, setGrade] = useState(review.processGrade);
  const [adherence, setAdherence] = useState<number | null>(review.adherencePct);
  const [worked, setWorked] = useState(review.whatWorked ?? "");
  const [broke, setBroke] = useState(review.whatBroke ?? "");
  const [tomorrow, setTomorrow] = useState(review.tomorrow ?? "");
  const [notes, setNotes] = useState(review.notes ?? "");

  function submit() {
    save(() =>
      saveDailyReview({
        day: review.day,
        processGrade: grade,
        adherencePct: adherence,
        whatWorked: worked,
        whatBroke: broke,
        tomorrow,
        notes,
      }),
    );
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="End of day"
        action={<SaveButton onClick={submit} pending={pending} saved={saved} />}
      />

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field
            label="Process grade"
            hint="Grade the execution, not the result. A well-executed loser is an A; a sloppy winner is a C."
          >
            <div className="flex flex-wrap gap-1.5">
              {PROCESS_GRADES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGrade(grade === g.id ? null : g.id)}
                  title={g.hint}
                  className={clsx(
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    grade === g.id
                      ? "border-[var(--color-accent-line)] bg-[var(--color-accent)] text-black"
                      : "border-[var(--color-line)] text-[var(--color-ink-mute)] hover:border-[var(--color-line-strong)]",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {grade && (
              <p className="mt-1.5 text-[11px] text-[var(--color-ink-faint)]">
                {PROCESS_GRADES.find((g) => g.id === grade)?.hint}
              </p>
            )}
          </Field>

          <Field
            label="Rule adherence"
            hint="Rough percentage of decisions that followed the plan. A number you can be honest about beats a precise one."
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={adherence ?? 0}
                onChange={(e) => setAdherence(Number(e.target.value))}
                className="flex-1 accent-[var(--color-accent)]"
              />
              <span className="figure w-12 text-right text-sm">
                {adherence === null ? "—" : `${adherence}%`}
              </span>
              {adherence !== null && (
                <button
                  onClick={() => setAdherence(null)}
                  className="text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-warn)]"
                >
                  clear
                </button>
              )}
            </div>
          </Field>

          <Field label="What worked" hint="Process, not outcome — what you'd want to repeat.">
            <TextArea value={worked} onChange={setWorked} rows={5} />
          </Field>
        </div>

        <div className="space-y-4">
          <Field label="What broke" hint="The specific decision, not the losing trade.">
            <TextArea value={broke} onChange={setBroke} rows={5} />
          </Field>

          <Field label="Tomorrow" hint="One thing. A list of six is a list of none.">
            <TextArea value={tomorrow} onChange={setTomorrow} rows={4} />
          </Field>

          <Field label="Notes">
            <TextArea value={notes} onChange={setNotes} rows={4} />
          </Field>
        </div>
      </div>

      <ErrorNote error={error} />
    </Card>
  );
}
