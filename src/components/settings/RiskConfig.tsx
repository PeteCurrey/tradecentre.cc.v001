"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { setBookRisk } from "@/lib/settings/actions";
import { BOOKS, CONVICTION_GRADES, type BookId, type Conviction } from "@/lib/books";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";

export type BookRiskRow = {
  id: BookId;
  baseRiskPct: number;
  dailyLimitR: number;
  multipliers: Record<Conviction, number>;
};

export function RiskConfig({ rows }: { rows: BookRiskRow[] }) {
  return (
    <Card className="p-5">
      <CardHeader title="Risk per book" />
      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        Percentages apply to that book&apos;s own equity, since each book is a separate
        sub-account. Position size = base risk × the conviction multiplier.
      </p>
      <div className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <BookRow key={r.id} row={r} />
        ))}
      </div>
    </Card>
  );
}

function BookRow({ row }: { row: BookRiskRow }) {
  const router = useRouter();
  const [values, setValues] = useState(row);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    values.baseRiskPct !== row.baseRiskPct ||
    values.dailyLimitR !== row.dailyLimitR ||
    CONVICTION_GRADES.some((g) => values.multipliers[g] !== row.multipliers[g]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setBookRisk({
        book: values.id,
        baseRiskPct: values.baseRiskPct,
        dailyLimitR: values.dailyLimitR,
        multipliers: values.multipliers,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium">
          <span
            className="size-2 rounded-full"
            style={{ background: BOOKS[row.id].colorVar }}
          />
          {BOOKS[row.id].label}
        </span>
        {(dirty || saved) && (
          <button
            onClick={save}
            disabled={pending}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
              saved
                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "bg-[var(--color-accent)] text-black hover:opacity-90",
            )}
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : saved ? (
              <Check className="size-3" />
            ) : null}
            {pending ? "Saving" : saved ? "Saved" : "Save"}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-[var(--color-loss)]">{error}</p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Num
          label="Base risk %"
          value={values.baseRiskPct}
          step={0.05}
          onChange={(v) => setValues((s) => ({ ...s, baseRiskPct: v }))}
        />
        <Num
          label="Daily limit (R)"
          value={values.dailyLimitR}
          step={0.5}
          onChange={(v) => setValues((s) => ({ ...s, dailyLimitR: v }))}
        />
      </div>

      <div className="mt-3">
        <div className="label-faint mb-1.5">Conviction multipliers</div>
        <div className="grid grid-cols-4 gap-2">
          {CONVICTION_GRADES.map((g) => (
            <Num
              key={g}
              label={g}
              value={values.multipliers[g]}
              step={0.25}
              onChange={(v) =>
                setValues((s) => ({ ...s, multipliers: { ...s.multipliers, [g]: v } }))
              }
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
          At {values.baseRiskPct}% base, an A+ risks{" "}
          <span className="figure text-[var(--color-ink-dim)]">
            {(values.baseRiskPct * values.multipliers["A+"]).toFixed(2)}%
          </span>{" "}
          and a C risks{" "}
          <span className="figure text-[var(--color-ink-dim)]">
            {(values.baseRiskPct * values.multipliers.C).toFixed(2)}%
          </span>
          . This only pays off if conviction predicts outcome — Performance measures whether
          it does.
        </p>
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="label-faint">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="figure mt-1 h-8 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-[13px] outline-none focus:border-[var(--color-accent-line)]"
      />
    </label>
  );
}
