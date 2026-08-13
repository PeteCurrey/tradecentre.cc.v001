import { requireSession } from "@/lib/auth/guard";
import { seedPatterns } from "@/lib/backtest/run";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Page";
import { ScreenRunner } from "@/components/backtest/ScreenRunner";
import { DEFAULT_CRITERIA } from "@/lib/backtest/gate";

export const dynamic = "force-dynamic";

/**
 * The backtest gate, as a screen rather than a test-suite capability.
 *
 * What makes this trustworthy is what it refuses to do: it will not screen a
 * subset and let the winners be pooled with an earlier run, it will not report
 * a pass without the tested-count that pass was adjusted for, and it will not
 * promote anything. Passing earns a demo book, never live capital.
 */
export default async function BacktestPage() {
  await requireSession();
  const patterns = seedPatterns();

  return (
    <>
      <PageHeader
        title="Backtest"
        subtitle={`${patterns.length} candidate patterns · contiguous out-of-sample segmentation with multiplicity control`}
      />

      <Card className="mb-4 p-5">
        <CardHeader title="Read this before reading a result" />
        <div className="mt-2 grid gap-4 text-xs leading-relaxed text-[var(--color-ink-mute)] lg:grid-cols-2">
          <div className="space-y-2">
            <p>
              Every pattern in the library is a <strong>hypothesis</strong> drawn from
              public technical literature. None is known to work on these instruments, at
              these costs, in current conditions. They exist to be measured.
            </p>
            <p>
              Screening many candidates against one history manufactures winners. With
              twenty tries something clears p&lt;0.05 roughly two times in three even when
              nothing works — so the gate segments the history into windows, requires
              consistency across them rather than a good total, and adjusts the threshold
              for how many candidates were tested in the same run.
            </p>
          </div>
          <div className="space-y-2">
            <p>
              <strong>Expect nothing to pass.</strong> A screen that usually returns an
              empty list is working. One that keeps finding winners is broken.
            </p>
            <p>
              Defaults: {DEFAULT_CRITERIA.windows} windows ·{" "}
              {DEFAULT_CRITERIA.minTrades} trades minimum ·{" "}
              {DEFAULT_CRITERIA.minConsistency} consistency ·{" "}
              {DEFAULT_CRITERIA.minWindowsWithTrades} windows must have traded · FDR{" "}
              {DEFAULT_CRITERIA.fdr} · {DEFAULT_CRITERIA.iterations.toLocaleString()}{" "}
              bootstrap iterations.
            </p>
            <p>
              Costs are per-instrument <em>measured</em> spreads, not estimates. Loosening
              the criteria below is allowed and is your call — but a pass earned by
              lowering the bar is a description of this dataset, not a finding.
            </p>
          </div>
        </div>
      </Card>

      <ScreenRunner patterns={patterns} />
    </>
  );
}
