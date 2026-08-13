"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, FlaskConical, Loader2 } from "lucide-react";
import { screenPatterns } from "@/lib/backtest/actions";
import type { ScreenRun } from "@/lib/backtest/run";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { RMultiple } from "@/components/ui/Money";
import { clsx } from "@/lib/clsx";

export type SeedPattern = {
  slug: string;
  name: string;
  horizon: string;
  family: string;
  timeframe: string;
  instrumentClasses: string[];
};

/** Measured universe (§8e). Adding one without measuring its spread is a bug. */
const INSTRUMENTS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "XAU_USD",
  "XAG_USD",
  "SPX500_USD",
  "NAS100_USD",
  "US30_USD",
  "UK100_GBP",
  "JP225_USD",
  "WTICO_USD",
];

export function ScreenRunner({ patterns }: { patterns: SeedPattern[] }) {
  const [pending, startTransition] = useTransition();
  const [run, setRun] = useState<ScreenRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [instruments, setInstruments] = useState<string[]>(["EUR_USD", "XAU_USD"]);
  const [slugs, setSlugs] = useState<string[]>([]);
  const [windows, setWindows] = useState(6);
  const [fdr, setFdr] = useState(0.1);

  const tested = (slugs.length || patterns.length) * instruments.length;

  function go() {
    setError(null);
    setRun(null);
    startTransition(async () => {
      const res = await screenPatterns({
        instruments,
        slugs: slugs.length ? slugs : undefined,
        windows,
        fdr,
      });
      if (!res.ok) setError(res.error);
      else setRun(res.run);
    });
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader
          title="Screen"
          action={
            <button
              onClick={go}
              disabled={pending || instruments.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FlaskConical className="size-3.5" />
              )}
              Run the gate
            </button>
          }
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <span className="label-faint">Instruments</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {INSTRUMENTS.map((i) => {
                const on = instruments.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() =>
                      setInstruments((s) =>
                        on ? s.filter((x) => x !== i) : [...s, i],
                      )
                    }
                    className={clsx(
                      "rounded-full border px-2.5 py-1 text-[11px]",
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
            <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">
              Only instruments whose spread has actually been measured. Guessing a spread
              has been wrong four times, most recently by 5× on JP225 — which would have
              turned a losing strategy into a winning one.
            </p>
          </div>

          <div>
            <span className="label-faint">
              Patterns {slugs.length ? `(${slugs.length})` : "(all)"}
            </span>
            <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1">
              {patterns.map((p) => {
                const on = slugs.includes(p.slug);
                return (
                  <label
                    key={p.slug}
                    className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSlugs((s) => (on ? s.filter((x) => x !== p.slug) : [...s, p.slug]))
                      }
                      className="accent-[var(--color-accent)]"
                    />
                    <span className={on ? "text-[var(--color-ink)]" : undefined}>
                      {p.name}
                    </span>
                    <span className="label-faint">
                      {p.horizon} · {p.timeframe}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="label-faint">Windows</span>
            <input
              type="number"
              min={2}
              max={12}
              value={windows}
              onChange={(e) => setWindows(Number(e.target.value))}
              className="mt-1 block w-24 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-2 py-1 figure text-sm outline-none focus:border-[var(--color-accent-line)]"
            />
          </label>
          <label className="block">
            <span className="label-faint">False discovery rate</span>
            <input
              type="number"
              step={0.05}
              min={0.01}
              max={0.5}
              value={fdr}
              onChange={(e) => setFdr(Number(e.target.value))}
              className="mt-1 block w-24 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-2 py-1 figure text-sm outline-none focus:border-[var(--color-accent-line)]"
            />
          </label>
          <p className="max-w-md text-[11px] text-[var(--color-ink-faint)]">
            This run will test <span className="figure">{tested}</span>{" "}
            pattern/instrument combinations in one screen. Every one is counted against the
            pass threshold — splitting them into separate runs and keeping the winners
            would quietly restore the problem the gate exists to control.
          </p>
        </div>

        {error && <p className="mt-3 text-xs text-[var(--color-warn)]">{error}</p>}
        {pending && (
          <p className="mt-3 text-xs text-[var(--color-ink-mute)]">
            Paging history from OANDA and running {tested} segmented backtests with a
            10,000-iteration bootstrap each. This takes a while the first time; bars are
            cached for subsequent runs.
          </p>
        )}
      </Card>

      {run && <Results run={run} />}
    </div>
  );
}

function Results({ run }: { run: ScreenRun }) {
  const { result } = run;
  const all = [...result.passed, ...result.rejected];

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Tested" value={<span className="figure">{result.testedCount}</span>} />
        <StatTile
          label="Passed"
          value={
            <span
              className={clsx(
                "figure",
                result.passed.length ? "text-[var(--color-accent)]" : undefined,
              )}
            >
              {result.passed.length}
            </span>
          }
        />
        <StatTile
          label="Expected to be luck"
          value={
            <span className="figure text-[var(--color-warn)]">
              {result.expectedFalsePositives.toFixed(1)}
            </span>
          }
          sub="of those passes"
        />
        <StatTile
          label="FDR"
          value={<span className="figure">{result.criteria.fdr}</span>}
        />
        <StatTile
          label="Windows"
          value={<span className="figure">{result.criteria.windows}</span>}
        />
        <StatTile
          label="Took"
          value={<span className="figure">{(run.durationMs / 1000).toFixed(0)}s</span>}
        />
      </div>

      {result.passed.length === 0 && (
        <Card className="p-5">
          <div className="flex items-start gap-2.5">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" />
            <div>
              <h2 className="label">Nothing passed</h2>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-mute)]">
                This is the expected result and the gate working correctly, not a failure.
                Screening {result.testedCount} candidates and finding none that clears a
                multiplicity-corrected threshold is what should usually happen. A screen
                that keeps finding winners is broken.
              </p>
            </div>
          </div>
        </Card>
      )}

      {result.passed.length > 0 && (
        <div className="rounded-[var(--radius-tile)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3.5 py-2.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
            <p className="text-xs leading-relaxed text-[var(--color-warn)]">
              <strong>
                {result.passed.length} passed, of which roughly{" "}
                {result.expectedFalsePositives.toFixed(1)} are expected to be noise.
              </strong>{" "}
              Passing this gate earns a place on a demo book, not live capital. Promotion
              stays a manual decision, and nothing here changes that.
            </p>
          </div>
        </div>
      )}

      {run.errors.length > 0 && (
        <Card className="p-4">
          <span className="label-faint">Skipped</span>
          <ul className="mt-1.5 space-y-0.5">
            {run.errors.map((e, i) => (
              <li key={i} className="text-xs text-[var(--color-warn)]">
                {e}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-5 pb-3">
          <CardHeader title="Every candidate" action={<span className="label-faint">passes first</span>} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
                <Th>Pattern</Th>
                <Th>Instrument</Th>
                <Th align="right">Trades</Th>
                <Th align="right">Windows</Th>
                <Th align="right">Consistency</Th>
                <Th align="right">Total R</Th>
                <Th align="right">Avg R</Th>
                <Th align="right">p</Th>
                <Th align="right">q</Th>
                <Th>Verdict</Th>
              </tr>
            </thead>
            <tbody>
              {all.map((v) => (
                <tr
                  key={`${v.slug}-${v.instrument}`}
                  className="border-b border-[var(--color-line)]/60 last:border-0"
                >
                  <Td className="font-medium">{v.slug}</Td>
                  <Td className="text-[var(--color-ink-dim)]">{v.instrument}</Td>
                  <Td align="right" className="figure text-[var(--color-ink-dim)]">
                    {v.segmented.pooled.trades}
                  </Td>
                  <Td align="right" className="figure text-[var(--color-ink-mute)]">
                    {v.segmented.windowsPositive}/{v.segmented.windowsWithTrades}
                  </Td>
                  <Td align="right" className="figure">
                    {v.segmented.consistency.toFixed(2)}
                  </Td>
                  <Td align="right">
                    <RMultiple value={v.segmented.pooled.totalR} decimals={1} />
                  </Td>
                  <Td align="right">
                    <RMultiple value={v.segmented.pooled.avgR} />
                  </Td>
                  <Td align="right" className="figure text-[var(--color-ink-mute)]">
                    {v.significance.pValue.toFixed(3)}
                  </Td>
                  <Td align="right" className="figure text-[var(--color-ink-mute)]">
                    {v.qValue.toFixed(3)}
                  </Td>
                  <Td>
                    <span
                      className={clsx(
                        "text-xs",
                        v.passed
                          ? "font-semibold text-[var(--color-accent)]"
                          : "text-[var(--color-ink-faint)]",
                      )}
                    >
                      {v.passed ? "passed" : v.reason}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <span className="label-faint">History used</span>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {run.history.map((h, i) => (
            <span key={i} className="text-xs text-[var(--color-ink-mute)]">
              {h.instrument} {h.granularity} ·{" "}
              <span className="figure">{h.bars.toLocaleString()}</span> bars
              {h.from && ` from ${h.from.slice(0, 10)}`}
            </span>
          ))}
        </div>
      </Card>
    </>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={clsx("label-faint px-3 py-2.5", align === "right" ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={clsx("px-3 py-2", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </td>
  );
}
