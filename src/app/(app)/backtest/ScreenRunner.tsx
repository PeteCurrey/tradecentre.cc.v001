"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, Play, XCircle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";
import { runScreenAction, type ScreenState } from "./actions";

const INITIAL: ScreenState = { ok: false, message: "" };

/** Money is the only thing that may be green or red. */
function R({ value }: { value: number }) {
  return (
    <span
      className={clsx(
        "figure tabular-nums",
        value > 0 ? "money-up" : value < 0 ? "money-down" : "money-flat",
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}R
    </span>
  );
}

const SELECT =
  "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent-line)]";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-wash)] px-3 text-[11px] font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent-wash)] disabled:opacity-50"
    >
      <Play size={14} />
      {pending ? "Screening…" : "Run screen"}
    </button>
  );
}

export function ScreenRunner({
  instruments,
  granularities,
}: {
  instruments: Array<{ instrument: string; bars: number; granularity: string }>;
  granularities: string[];
}) {
  const [state, action] = useActionState(runScreenAction, INITIAL);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Run a screen" />
        <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="label-faint">Instrument</span>
            <select name="instrument" className={SELECT} defaultValue={instruments[0]?.instrument}>
              {instruments.map((i) => (
                <option key={i.instrument} value={i.instrument}>
                  {i.instrument}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-faint">Granularity</span>
            <select name="granularity" className={SELECT} defaultValue={granularities[0]}>
              {granularities.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <SubmitButton />
        </form>

        <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
          Every pattern is screened in one pass, so the pass threshold accounts for how many were
          tried. Screening in smaller batches would make it easier to pass, not harder — which is
          why it is not offered.
        </p>
      </Card>

      {state.message && !state.ok ? (
        <Card>
          <div className="flex items-start gap-2 text-[var(--color-warn)]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p className="text-sm">{state.message}</p>
          </div>
        </Card>
      ) : null}

      {state.ok && state.rows ? (
        <>
          <Card>
            <CardHeader
              title={`${state.instrument} · ${state.granularity}`}
              action={
                <span className="text-xs text-[var(--color-ink-mute)]">
                  {state.bars?.toLocaleString()} bars · {state.from} → {state.to}
                </span>
              }
            />
            <div className="mt-3 flex flex-wrap gap-6 text-sm">
              <div>
                <span className="label-faint">Tested</span>
                <div className="figure">{state.testedCount}</div>
              </div>
              <div>
                <span className="label-faint">Passed</span>
                <div className="figure">{state.rows.filter((r) => r.passed).length}</div>
              </div>
              <div>
                <span className="label-faint">Expected to be luck</span>
                <div className="figure text-[var(--color-warn)]">
                  {state.expectedFalsePositives?.toFixed(1)}
                </div>
              </div>
            </div>
            {state.rows.every((r) => !r.passed) ? (
              <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
                Nothing survived. That is the expected result far more often than not — these are
                hypotheses drawn from public technical literature, and most do not survive contact
                with real costs.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Verdicts" />
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--color-ink-mute)]">
                    <th className="py-1.5 pr-3 font-normal">Pattern</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Trades</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Total</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Avg</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Win%</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Max DD</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Windows</th>
                    <th className="py-1.5 pr-3 text-right font-normal">q</th>
                    <th className="py-1.5 font-normal">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r) => (
                    <tr key={r.slug} className="border-t border-[var(--color-line)] align-top">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          {r.passed ? (
                            <CheckCircle2 size={13} className="text-[var(--color-accent)]" />
                          ) : (
                            <XCircle size={13} className="text-[var(--color-ink-mute)]" />
                          )}
                          <span>{r.name}</span>
                        </div>
                        <div className="text-xs text-[var(--color-ink-mute)]">
                          {r.slug} · {r.direction}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.trades}</td>
                      <td className="py-2 pr-3 text-right">
                        <R value={r.totalR} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <R value={r.avgR} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.trades > 0 ? `${(r.winRate * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.maxDrawdownR.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.windowsPositive}/{r.windowsWithTrades}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.qValue.toFixed(3)}</td>
                      <td className="py-2 text-xs text-[var(--color-ink-mute)]">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
              q is the false-discovery-adjusted significance across all {state.testedCount}{" "}
              patterns tested here. Windows shows how many separate periods were profitable — a
              pattern that made everything in one window is one lucky regime, not an edge.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
