"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { setHorizonThresholds } from "@/lib/settings/actions";
import { HORIZONS, type HorizonThresholds } from "@/lib/books";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";

/**
 * Where one horizon ends and the next begins.
 *
 * These are Peter's boundaries, not mine — where a scalp stops being a scalp is
 * a judgement about his own trading. Changing them requires a re-derive, since
 * horizon is computed at derivation time, and the UI says so rather than
 * leaving stale classifications in place silently.
 */
export function HorizonConfig({ initial }: { initial: HorizonThresholds }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    v.scalpMaxMinutes !== initial.scalpMaxMinutes ||
    v.intradayMaxMinutes !== initial.intradayMaxMinutes ||
    v.swingMaxMinutes !== initial.swingMaxMinutes;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setHorizonThresholds(v);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Hold-time boundaries"
        action={
          (dirty || saved) && (
            <button
              onClick={save}
              disabled={pending}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                saved && !dirty
                  ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                  : "bg-[var(--color-accent)] text-black hover:opacity-90",
              )}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : saved && !dirty ? (
                <Check className="size-3.5" />
              ) : null}
              {pending ? "Saving" : saved && !dirty ? "Saved" : "Save"}
            </button>
          )
        }
      />
      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        Horizon is a per-trade tag, inferred from how long you actually held.
        Books are your instrument-class accounts and are separate.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-[var(--color-loss-wash)] px-3 py-2 text-xs text-[var(--color-loss)]">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-2.5">
        <Bound
          horizon="scalp"
          label="Scalp up to"
          minutes={v.scalpMaxMinutes}
          onChange={(m) => {
            setSaved(false);
            setV((s) => ({ ...s, scalpMaxMinutes: m }));
          }}
        />
        <Bound
          horizon="intraday"
          label="Intraday up to"
          minutes={v.intradayMaxMinutes}
          onChange={(m) => {
            setSaved(false);
            setV((s) => ({ ...s, intradayMaxMinutes: m }));
          }}
        />
        <Bound
          horizon="swing"
          label="Swing up to"
          minutes={v.swingMaxMinutes}
          onChange={(m) => {
            setSaved(false);
            setV((s) => ({ ...s, swingMaxMinutes: m }));
          }}
        />
        <div className="flex items-center gap-2.5 rounded-lg bg-[var(--color-sunken)] px-3 py-2.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: HORIZONS.position.colorVar }}
          />
          <span className="flex-1 text-[13px]">Anything longer</span>
          <span className="label-faint">Position</span>
        </div>
      </div>

      {saved && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warn)]" />
          <p className="text-xs text-[var(--color-warn)]">
            Existing trades keep the horizon they were derived with. Press{" "}
            <strong>Sync</strong> to reclassify them.
          </p>
        </div>
      )}
    </Card>
  );
}

function Bound({
  horizon,
  label,
  minutes,
  onChange,
}: {
  horizon: "scalp" | "intraday" | "swing";
  label: string;
  minutes: number;
  onChange: (m: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-[var(--color-sunken)] px-3 py-2.5">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: HORIZONS[horizon].colorVar }}
      />
      <span className="flex-1 text-[13px]">{label}</span>
      <input
        type="number"
        min={1}
        value={minutes}
        onChange={(e) => onChange(Number(e.target.value))}
        className="figure h-8 w-24 rounded-md border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-right text-[13px] outline-none focus:border-[var(--color-accent-line)]"
      />
      <span className="w-16 shrink-0 text-[11px] text-[var(--color-ink-mute)]">
        min{minutes >= 60 ? ` · ${humanise(minutes)}` : ""}
      </span>
    </div>
  );
}

function humanise(minutes: number): string {
  if (minutes < 1440) return `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}h`;
  return `${(minutes / 1440).toFixed(minutes % 1440 ? 1 : 0)}d`;
}
