"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  deleteOpportunity,
  logOpportunity,
  markOpportunityTaken,
} from "@/lib/journal/daily";
import { Card, CardHeader } from "@/components/ui/Card";
import { BOOKS, BOOK_IDS, CONVICTION_GRADES, type BookId } from "@/lib/books";
import { ErrorNote, Field, SaveButton, TextArea, TextInput, useSaver } from "./Fields";
import { clsx } from "@/lib/clsx";

export type OppRow = {
  id: number;
  day: string;
  instrument: string;
  source: "spotted" | "ai" | "engine";
  book: BookId | null;
  conviction: string | null;
  score: number | null;
  reasoning: string | null;
  invalidation: string | null;
  taken: boolean;
  patternName: string | null;
};

const SOURCE_LABEL: Record<OppRow["source"], string> = {
  spotted: "Spotted",
  ai: "AI",
  engine: "Engine",
};

export function OpportunityPanel({ day, rows }: { day: string; rows: OppRow[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <OpportunityList rows={rows} />
      <SpotForm day={day} />
    </div>
  );
}

function OpportunityList({ rows }: { rows: OppRow[] }) {
  const { save, pending, error } = useSaver();

  if (rows.length === 0) {
    return (
      <Card className="p-8">
        <h2 className="label">Nothing logged for this day</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
          Log what you see as you see it — including the ones you decide not to take. The
          screen&apos;s real output is the comparison over time between what you spotted,
          what the engine spotted, and what you actually traded. That measures selection,
          which nothing else here does.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-3">
        <CardHeader title="Candidates" action={<span className="label-faint">{rows.length}</span>} />
      </div>
      <div className="divide-y divide-[var(--color-line)]/60">
        {rows.map((o) => (
          <div key={o.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{o.instrument}</span>
              <span
                className={clsx(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  o.source === "spotted"
                    ? "bg-[var(--color-line)] text-[var(--color-ink-dim)]"
                    : "bg-[var(--color-accent-wash)] text-[var(--color-accent)]",
                )}
              >
                {SOURCE_LABEL[o.source]}
              </span>
              {o.book && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-mute)]">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: BOOKS[o.book].colorVar }}
                  />
                  {BOOKS[o.book].label}
                </span>
              )}
              {o.conviction && (
                <span className="label-faint">{o.conviction}</span>
              )}
              {o.score !== null && (
                <span className="figure text-[11px] text-[var(--color-ink-mute)]">
                  {o.score.toFixed(0)}/100
                </span>
              )}
              {o.patternName && (
                <span className="text-[11px] text-[var(--color-ink-faint)]">
                  {o.patternName}
                </span>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => save(() => markOpportunityTaken(o.id, !o.taken))}
                  disabled={pending}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                    o.taken
                      ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                      : "border-[var(--color-line)] text-[var(--color-ink-mute)]",
                  )}
                >
                  <Check className="size-3" />
                  {o.taken ? "Taken" : "Not taken"}
                </button>
                <button
                  onClick={() => save(() => deleteOpportunity(o.id))}
                  disabled={pending}
                  className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-warn)]"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>

            {o.reasoning && (
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-dim)]">
                {o.reasoning}
              </p>
            )}
            {o.invalidation && (
              <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                Invalid if: {o.invalidation}
              </p>
            )}
          </div>
        ))}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}

function SpotForm({ day }: { day: string }) {
  const { save, pending, saved, error } = useSaver();
  const [instrument, setInstrument] = useState("");
  const [book, setBook] = useState<BookId | null>(null);
  const [conviction, setConviction] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [invalidation, setInvalidation] = useState("");

  function submit() {
    save(async () => {
      const res = await logOpportunity({
        day,
        instrument: instrument.trim().toUpperCase(),
        source: "spotted",
        book,
        conviction,
        reasoning,
        invalidation,
      });
      if (res.ok) {
        setInstrument("");
        setReasoning("");
        setInvalidation("");
      }
      return res;
    });
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Log what you spotted"
        action={
          <SaveButton onClick={submit} pending={pending} saved={saved} label="Add" />
        }
      />
      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        Only your own sightings can be added here. AI and engine candidates are written by
        the AI and the engine — otherwise the three-way comparison would measure nothing.
      </p>

      <div className="mt-4 space-y-3">
        <Field label="Instrument">
          <TextInput
            value={instrument}
            onChange={setInstrument}
            placeholder="XAU_USD"
          />
        </Field>

        <Field label="Book">
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

        <Field label="Conviction">
          <div className="flex gap-1.5">
            {CONVICTION_GRADES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setConviction(conviction === g ? null : g)}
                className={clsx(
                  "rounded-md border px-2.5 py-1 text-[11px] font-semibold",
                  conviction === g
                    ? "border-[var(--color-accent-line)] bg-[var(--color-accent)] text-black"
                    : "border-[var(--color-line)] text-[var(--color-ink-mute)]",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Why" hint="Must be interrogable later. 'Looked good' tells you nothing in March.">
          <TextArea value={reasoning} onChange={setReasoning} rows={3} />
        </Field>

        <Field label="What would invalidate it">
          <TextArea value={invalidation} onChange={setInvalidation} rows={2} />
        </Field>
      </div>

      <ErrorNote error={error} />
    </Card>
  );
}

export function AddHint() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-faint)]">
      <Plus className="size-3" /> log as you see it
    </span>
  );
}
