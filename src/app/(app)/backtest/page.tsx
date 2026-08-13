import { Database } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { historyCoverage } from "@/lib/candles/backfill";
import { expectedBarsPerYear } from "@/lib/candles/pagination";
import { SEED_PATTERNS } from "@/lib/patterns/seed";
import type { Granularity } from "@/lib/oanda/types";
import { ScreenRunner } from "./ScreenRunner";

export const dynamic = "force-dynamic";

/**
 * Backtest screening.
 *
 * Reads stored history only — it never fetches. A screen that quietly pulled
 * candles would give different answers depending on what happened to be cached,
 * which defeats the point. Missing history shows as missing.
 */
export default async function BacktestPage() {
  await requireSession();

  const coverage = await historyCoverage();

  if (coverage.length === 0) {
    return (
      <>
        <PageHeader
          title="Backtest"
          subtitle="Screen the pattern library against stored history"
        />
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Database className="size-5 text-[var(--color-ink-faint)]" />
            <p className="max-w-md text-sm text-[var(--color-ink-mute)]">
              No historical candles are stored yet. Backfill the instrument universe before
              screening — nothing is shown here until real history exists.
            </p>
          </div>
        </Card>
      </>
    );
  }

  // Only offer a granularity the library actually has patterns for. Running an
  // M5 pattern against H1 bars silently evaluates a different strategy.
  const libraryTimeframes = new Set(SEED_PATTERNS.map((p) => p.timeframe));
  const stored = new Set(coverage.map((c) => c.granularity));
  const runnable = [...libraryTimeframes].filter((t) => stored.has(t)).sort();

  const instruments = [...new Set(coverage.map((c) => c.instrument))].sort();

  const totalBars = coverage.reduce((s, c) => s + c.bars, 0);

  return (
    <>
      <PageHeader
        title="Backtest"
        subtitle="Screen the pattern library against stored history"
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Stored history"
            action={
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-mute)]">
                <Database size={13} />
                {totalBars.toLocaleString()} bars
              </span>
            }
          />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--color-ink-mute)]">
                  <th className="py-1.5 pr-3 font-normal">Instrument</th>
                  <th className="py-1.5 pr-3 font-normal">Granularity</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Bars</th>
                  <th className="py-1.5 pr-3 font-normal">From</th>
                  <th className="py-1.5 pr-3 font-normal">To</th>
                  <th className="py-1.5 text-right font-normal">Years</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => {
                  const years =
                    c.from && c.to
                      ? (c.to.getTime() - c.from.getTime()) / (365.25 * 864e5)
                      : 0;
                  const expected = Math.round(
                    expectedBarsPerYear(c.granularity as Granularity) * years,
                  );
                  // Well under expectation means gaps, which would quietly
                  // shrink every backtest run on it.
                  const thin = expected > 0 && c.bars < expected * 0.8;
                  return (
                    <tr
                      key={`${c.instrument}-${c.granularity}`}
                      className="border-t border-[var(--color-line)]"
                    >
                      <td className="py-1.5 pr-3">{c.instrument}</td>
                      <td className="py-1.5 pr-3 text-[var(--color-ink-dim)]">{c.granularity}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {c.bars.toLocaleString()}
                        {thin ? (
                          <span
                            className="ml-1.5 text-[var(--color-warn)]"
                            title={`Expected ~${expected.toLocaleString()} for this span — there are gaps`}
                          >
                            thin
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[var(--color-ink-dim)]">
                        {c.from?.toISOString().slice(0, 10) ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[var(--color-ink-dim)]">
                        {c.to?.toISOString().slice(0, 10) ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{years.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {runnable.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-warn)]">
              History is stored, but none of it matches a granularity the pattern library uses.
              Library timeframes: {[...libraryTimeframes].sort().join(", ")}. Stored:{" "}
              {[...stored].sort().join(", ")}. Backfill a matching granularity before screening.
            </p>
          </Card>
        ) : (
          <ScreenRunner
            instruments={instruments.map((i) => ({
              instrument: i,
              bars: coverage
                .filter((c) => c.instrument === i)
                .reduce((s, c) => s + c.bars, 0),
              granularity: "",
            }))}
            granularities={runnable}
          />
        )}
      </div>
    </>
  );
}
