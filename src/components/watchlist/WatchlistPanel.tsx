"use client";

import { useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import {
  addWatchLevel,
  deleteWatchLevel,
  setWatchLevelActive,
} from "@/lib/journal/daily";
import { Card, CardHeader } from "@/components/ui/Card";
import { useLive } from "@/components/AppShell";
import { ErrorNote, Field, SaveButton, TextInput, useSaver } from "@/components/daily/Fields";
import { clsx } from "@/lib/clsx";

export type LevelRow = {
  id: number;
  instrument: string;
  price: number;
  label: string | null;
  kind: string;
  active: boolean;
};

const KINDS = ["level", "support", "resistance", "target"] as const;

/**
 * Watchlist & Levels.
 *
 * Distance to a level is shown as a PERCENTAGE of price, not in points, because
 * 20 points means something completely different on EURUSD and on NAS100.
 * Percentage is the only form that ranks correctly across the whole universe.
 */
export function WatchlistPanel({ rows }: { rows: LevelRow[] }) {
  const { ticks, state } = useLive();

  const byInstrument = new Map<string, LevelRow[]>();
  for (const r of rows) {
    byInstrument.set(r.instrument, [...(byInstrument.get(r.instrument) ?? []), r]);
  }

  // Nearest level first — the whole point is knowing what is about to matter.
  const instruments = [...byInstrument.entries()]
    .map(([instrument, levels]) => {
      const mid = ticks.get(instrument)?.mid ?? null;
      const nearest = mid
        ? Math.min(
            ...levels
              .filter((l) => l.active)
              .map((l) => Math.abs((l.price - mid) / mid)),
            Infinity,
          )
        : Infinity;
      return { instrument, levels, mid, nearest };
    })
    .sort((a, b) => a.nearest - b.nearest);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {instruments.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-[var(--color-ink-mute)]">
              No levels marked yet. Add one on the right and it shows up here, on the
              pre-market plan, and in the price feed&apos;s subscription list.
            </p>
          </Card>
        ) : (
          instruments.map(({ instrument, levels, mid }) => (
            <InstrumentCard
              key={instrument}
              instrument={instrument}
              levels={levels}
              mid={mid}
              streaming={state === "live"}
            />
          ))
        )}
      </div>

      <AddLevelForm />
    </div>
  );
}

function InstrumentCard({
  instrument,
  levels,
  mid,
  streaming,
}: {
  instrument: string;
  levels: LevelRow[];
  mid: number | null;
  streaming: boolean;
}) {
  const { save, pending, error } = useSaver();
  const dp = mid === null ? 5 : mid >= 1000 ? 2 : mid >= 100 ? 3 : mid >= 10 ? 4 : 5;

  return (
    <Card className="p-5">
      <CardHeader
        title={instrument}
        action={
          <span
            className={clsx(
              "figure text-sm",
              streaming && mid !== null
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-ink-mute)]",
            )}
          >
            {mid !== null ? mid.toFixed(dp) : "no price"}
          </span>
        }
      />

      <div className="mt-3 space-y-1">
        {levels
          .sort((a, b) => b.price - a.price)
          .map((l) => {
            const distance = mid !== null ? ((l.price - mid) / mid) * 100 : null;
            const close = distance !== null && Math.abs(distance) < 0.25;
            return (
              <div
                key={l.id}
                className={clsx(
                  "flex items-center gap-3 rounded-lg border px-3 py-1.5",
                  close
                    ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)]"
                    : "border-[var(--color-line)]",
                  !l.active && "opacity-50",
                )}
              >
                <span className="figure w-24 text-[13px]">{l.price.toFixed(dp)}</span>
                <span className="label-faint w-20">{l.kind}</span>
                <span className="flex-1 truncate text-xs text-[var(--color-ink-dim)]">
                  {l.label}
                </span>
                <span
                  className={clsx(
                    "figure w-16 text-right text-xs",
                    close ? "text-[var(--color-accent)]" : "text-[var(--color-ink-mute)]",
                  )}
                >
                  {distance !== null
                    ? `${distance >= 0 ? "+" : ""}${distance.toFixed(2)}%`
                    : "—"}
                </span>
                <button
                  onClick={() => save(() => setWatchLevelActive(l.id, !l.active))}
                  disabled={pending}
                  title={l.active ? "Mute" : "Unmute"}
                  className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
                >
                  {l.active ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
                <button
                  onClick={() => save(() => deleteWatchLevel(l.id))}
                  disabled={pending}
                  className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-warn)]"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}

function AddLevelForm() {
  const { save, pending, saved, error } = useSaver();
  const [instrument, setInstrument] = useState("");
  const [price, setPrice] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("level");

  function submit() {
    save(async () => {
      const res = await addWatchLevel({
        instrument: instrument.trim().toUpperCase(),
        price: Number(price),
        label,
        kind,
      });
      if (res.ok) {
        setPrice("");
        setLabel("");
      }
      return res;
    });
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Add a level"
        action={<SaveButton onClick={submit} pending={pending} saved={saved} label="Add" />}
      />
      <div className="mt-4 space-y-3">
        <Field label="Instrument">
          <TextInput value={instrument} onChange={setInstrument} placeholder="XAU_USD" />
        </Field>
        <Field label="Price">
          <TextInput value={price} onChange={setPrice} placeholder="2355.40" />
        </Field>
        <Field label="Kind">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-[11px] capitalize",
                  kind === k
                    ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-ink-mute)]",
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Label" hint="Why it matters. 'Feb high' beats 'resistance'.">
          <TextInput value={label} onChange={setLabel} placeholder="Feb high, untested" />
        </Field>
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        Instruments here are added to the price stream at the next restart, so a watched
        instrument gets a live price without a separate subscription list to maintain.
      </p>
      <ErrorNote error={error} />
    </Card>
  );
}
