"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Loader2,
  Play,
  Power,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  armBook,
  clearHalt,
  disarmBook,
  killAll,
  runTickNow,
  setAllowLiveCapital,
  setBookLimits,
  setDryRun,
} from "@/lib/execution/actions";
import { BOOKS, type BookId } from "@/lib/books";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";

export type EngineBookRow = {
  book: BookId;
  state: "disarmed" | "armed" | "halted";
  dryRun: boolean;
  allowLiveCapital: boolean;
  instrumentAllowlist: string[];
  enabledPatternIds: number[];
  maxOpenPositions: number;
  maxRiskMultiple: number;
  haltedReason: string | null;
  armedAt: string | null;
  /** Null when no OANDA account maps to this book — nothing can run. */
  accountId: string | null;
  environment: "live" | "practice" | null;
  openPositions: number;
};

export type PatternOption = { id: number; name: string; status: string };

export function EnginePanel({
  rows,
  patterns,
  instruments,
  scheduler,
}: {
  rows: EngineBookRow[];
  patterns: PatternOption[];
  instruments: string[];
  scheduler: { running: boolean; intervalMs: number; lastTickAt: string | null; lastError: string | null; ticks: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState<string | null>(null);

  const anyArmed = rows.some((r) => r.state === "armed");
  const anyLive = rows.some((r) => r.state === "armed" && !r.dryRun);

  function kill() {
    startTransition(async () => {
      await killAll("Kill switch pressed");
      router.refresh();
    });
  }

  function manualTick() {
    setTick(null);
    startTransition(async () => {
      const res = await runTickNow();
      setTick(
        res.ok
          ? `Tick complete — see the order log for anything it decided.`
          : `Tick failed: ${res.error}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- Kill switch, first thing on the page and always reachable ---- */}
      <Card className={clsx("p-4", anyLive && "border-[var(--color-warn)]/50")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="label">Engine</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
              {anyLive ? (
                <span className="text-[var(--color-warn)]">
                  At least one book is armed and out of dry run — orders will reach the
                  broker.
                </span>
              ) : anyArmed ? (
                "Armed in dry run. Orders are computed and logged, never sent."
              ) : (
                "Nothing armed. The scheduler is ticking, but no book permits an order."
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={manualTick}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent-line)] hover:text-[var(--color-accent)]"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Run one tick
            </button>
            <button
              onClick={kill}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-warn)]/60 bg-[var(--color-warn-wash)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--color-warn)] transition-colors hover:bg-[var(--color-warn)] hover:text-black"
            >
              <Power className="size-3.5" />
              Halt everything
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-mute)]">
          <span>
            Scheduler{" "}
            <span className={scheduler.running ? "text-[var(--color-accent)]" : undefined}>
              {scheduler.running ? "running" : "stopped"}
            </span>{" "}
            · every {scheduler.intervalMs / 1000}s
          </span>
          <span>{scheduler.ticks} ticks this process</span>
          <span>
            Last tick{" "}
            {scheduler.lastTickAt
              ? new Date(scheduler.lastTickAt).toLocaleTimeString("en-GB")
              : "— none yet"}
          </span>
          {scheduler.lastError && (
            <span className="text-[var(--color-warn)]">Last error: {scheduler.lastError}</span>
          )}
        </div>

        {tick && <p className="mt-2 text-xs text-[var(--color-ink-dim)]">{tick}</p>}
      </Card>

      {rows.map((row) => (
        <BookControls
          key={row.book}
          row={row}
          patterns={patterns}
          instruments={instruments}
        />
      ))}
    </div>
  );
}

function BookControls({
  row,
  patterns,
  instruments,
}: {
  row: EngineBookRow;
  patterns: PatternOption[];
  instruments: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState("");
  const [limits, setLimits] = useState({
    maxOpenPositions: row.maxOpenPositions,
    maxRiskMultiple: row.maxRiskMultiple,
    instrumentAllowlist: row.instrumentAllowlist,
    enabledPatternIds: row.enabledPatternIds,
  });
  const [savedLimits, setSavedLimits] = useState(false);

  const def = BOOKS[row.book];
  const armed = row.state === "armed";
  const halted = row.state === "halted";
  const live = armed && !row.dryRun;
  const permitsNothing =
    limits.instrumentAllowlist.length === 0 || limits.enabledPatternIds.length === 0;

  const limitsDirty =
    limits.maxOpenPositions !== row.maxOpenPositions ||
    limits.maxRiskMultiple !== row.maxRiskMultiple ||
    limits.instrumentAllowlist.join() !== row.instrumentAllowlist.join() ||
    limits.enabledPatternIds.join() !== row.enabledPatternIds.join();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      router.refresh();
    });
  }

  return (
    <Card className={clsx("p-4", live && "border-[var(--color-warn)]/40")}>
      <CardHeader
        title={def.label}
        action={
          <span
            className={clsx(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              halted
                ? "bg-[var(--color-warn-wash)] text-[var(--color-warn)]"
                : armed
                  ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                  : "bg-[var(--color-line)] text-[var(--color-ink-mute)]",
            )}
          >
            {halted ? "halted" : armed ? (row.dryRun ? "armed · dry run" : "armed · live") : "disarmed"}
          </span>
        }
      />

      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        {row.accountId ? (
          <>
            {row.accountId} · {row.environment} · {row.openPositions} open
          </>
        ) : (
          <span className="text-[var(--color-warn)]">
            No active OANDA account maps to this book — nothing can run here.
          </span>
        )}
      </p>

      {halted && (
        <div className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          <div className="text-xs leading-relaxed text-[var(--color-warn)]">
            <strong>Halted.</strong> {row.haltedReason ?? "No reason recorded."} Clearing this
            returns the book to <em>disarmed</em>, not to armed — whatever tripped it is worth
            reading first.
            <button
              onClick={() => run(() => clearHalt(row.book))}
              disabled={pending}
              className="ml-2 rounded border border-[var(--color-warn)]/60 px-2 py-0.5 font-semibold"
            >
              Clear halt
            </button>
          </div>
        </div>
      )}

      {/* ---- Arm / dry run ------------------------------------------------ */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {armed ? (
          <button
            onClick={() => run(() => disarmBook(row.book))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
          >
            <Square className="size-3.5" /> Disarm
          </button>
        ) : (
          <button
            onClick={() => run(() => armBook(row.book))}
            disabled={pending || halted || !row.accountId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
          >
            <ShieldCheck className="size-3.5" /> Arm (dry run)
          </button>
        )}

        {armed && (
          <button
            onClick={() => run(() => setDryRun(row.book, !row.dryRun))}
            disabled={pending}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold",
              row.dryRun
                ? "border-[var(--color-warn)]/60 text-[var(--color-warn)]"
                : "border-[var(--color-line-strong)] text-[var(--color-ink-dim)]",
            )}
          >
            {row.dryRun ? "Send orders for real" : "Back to dry run"}
          </button>
        )}

        {permitsNothing && (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-mute)]">
            <Ban className="size-3.5" />
            No instruments or no patterns enabled — this book permits nothing.
          </span>
        )}
      </div>

      {/* ---- Live capital ------------------------------------------------- */}
      <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="label-faint">Real money</span>
            <p className="mt-0.5 text-xs text-[var(--color-ink-mute)]">
              Guards read this, not the environment. A live account still cannot be traded
              until it is unlocked here.
            </p>
          </div>
          {row.allowLiveCapital ? (
            <button
              onClick={() => run(() => setAllowLiveCapital(row.book, false))}
              disabled={pending}
              className="rounded-md border border-[var(--color-warn)]/60 bg-[var(--color-warn-wash)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-warn)]"
            >
              Unlocked — lock it
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                value={confirmLive}
                onChange={(e) => setConfirmLive(e.target.value)}
                placeholder="Type LIVE CAPITAL"
                className="w-40 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-card)] px-2 py-1 text-[11px] outline-none focus:border-[var(--color-accent-line)]"
              />
              <button
                onClick={() => run(() => setAllowLiveCapital(row.book, true, confirmLive))}
                disabled={pending}
                className="rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ink-dim)]"
              >
                Unlock
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---- Permission surface ------------------------------------------ */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <span className="label-faint">Instruments permitted</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {instruments.map((i) => {
              const on = limits.instrumentAllowlist.includes(i);
              return (
                <button
                  key={i}
                  onClick={() =>
                    setLimits((l) => ({
                      ...l,
                      instrumentAllowlist: on
                        ? l.instrumentAllowlist.filter((x) => x !== i)
                        : [...l.instrumentAllowlist, i],
                    }))
                  }
                  className={clsx(
                    "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    on
                      ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                      : "border-[var(--color-line)] text-[var(--color-ink-mute)]",
                  )}
                >
                  {i}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="label-faint">Patterns permitted</span>
          <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1">
            {patterns.length === 0 && (
              <p className="text-xs text-[var(--color-ink-mute)]">No patterns in the library.</p>
            )}
            {patterns.map((p) => {
              const on = limits.enabledPatternIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setLimits((l) => ({
                        ...l,
                        enabledPatternIds: on
                          ? l.enabledPatternIds.filter((x) => x !== p.id)
                          : [...l.enabledPatternIds, p.id],
                      }))
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  <span className={on ? "text-[var(--color-ink)]" : undefined}>{p.name}</span>
                  {p.status !== "live" && (
                    <span className="label-faint">{p.status}</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <NumField
          label="Max open positions"
          value={limits.maxOpenPositions}
          step={1}
          onChange={(v) => setLimits((l) => ({ ...l, maxOpenPositions: v }))}
        />
        <NumField
          label="Max risk multiple"
          value={limits.maxRiskMultiple}
          step={0.25}
          onChange={(v) => setLimits((l) => ({ ...l, maxRiskMultiple: v }))}
        />
        {(limitsDirty || savedLimits) && (
          <button
            onClick={() => {
              setSavedLimits(false);
              run(async () => {
                const res = await setBookLimits({ book: row.book, ...limits });
                if (res.ok) {
                  setSavedLimits(true);
                  setTimeout(() => setSavedLimits(false), 3000);
                }
                return res;
              });
            }}
            disabled={pending}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold",
              savedLimits
                ? "bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
                : "bg-[var(--color-accent)] text-black",
            )}
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : savedLimits ? (
              <Check className="size-3" />
            ) : null}
            {savedLimits ? "Saved" : "Save limits"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
    </Card>
  );
}

function NumField({
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
        className="mt-1 block w-28 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-2 py-1 figure text-sm outline-none focus:border-[var(--color-accent-line)]"
      />
    </label>
  );
}
