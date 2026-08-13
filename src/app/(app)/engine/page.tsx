import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { accounts, executionState, patterns, trades } from "@/lib/db/schema";
import { ensureExecutionState } from "@/lib/execution/engine";
import { schedulerStatus } from "@/lib/execution/scheduler";
import { EnginePanel, type EngineBookRow } from "@/components/execution/EnginePanel";
import { PageHeader } from "@/components/ui/Page";
import { BOOK_IDS, type BookId } from "@/lib/books";

export const dynamic = "force-dynamic";

/**
 * Engine controls.
 *
 * Deliberately built and shipped BEFORE anything could call `runTick()` on a
 * schedule: the controls exist before the thing they control can run, so there
 * is never a window where the engine is live and the only way to stop it is a
 * redeploy.
 *
 * The instrument list is the verified traded universe (§8e) rather than every
 * OANDA instrument — an allowlist offering 123 choices is not an allowlist.
 */
const UNIVERSE = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "AUD_USD",
  "XAU_USD",
  "XAG_USD",
  "NAS100_USD",
  "SPX500_USD",
  "US30_USD",
  "UK100_GBP",
  "JP225_USD",
  "WTICO_USD",
];

export default async function EnginePage() {
  await requireSession();
  await ensureExecutionState();

  const [states, accountRows, patternRows, openTrades] = await Promise.all([
    db.select().from(executionState),
    db.select().from(accounts).where(eq(accounts.active, true)),
    db.select().from(patterns).orderBy(asc(patterns.name)),
    db.select().from(trades).where(eq(trades.state, "open")),
  ]);

  const rows: EngineBookRow[] = BOOK_IDS.map((book: BookId) => {
    const s = states.find((x) => x.book === book);
    const account =
      accountRows.find((a) => a.book === book && a.environment === "live") ??
      accountRows.find((a) => a.book === book);

    return {
      book,
      state: (s?.state ?? "disarmed") as EngineBookRow["state"],
      dryRun: s?.dryRun ?? true,
      allowLiveCapital: s?.allowLiveCapital ?? false,
      instrumentAllowlist: s?.instrumentAllowlist ?? [],
      enabledPatternIds: s?.enabledPatternIds ?? [],
      maxOpenPositions: s?.maxOpenPositions ?? 2,
      maxRiskMultiple: Number(s?.maxRiskMultiple ?? 1.5),
      haltedReason: s?.haltedReason ?? null,
      armedAt: s?.armedAt?.toISOString() ?? null,
      accountId: account?.id ?? null,
      environment: (account?.environment ?? null) as EngineBookRow["environment"],
      openPositions: openTrades.filter((t) => t.book === book).length,
    };
  });

  const status = schedulerStatus();

  return (
    <>
      <PageHeader
        title="Engine"
        subtitle="Arm, disarm and halt the autonomous engine, per book"
      />
      <EnginePanel
        rows={rows}
        patterns={patternRows.map((p) => ({ id: p.id, name: p.name, status: p.status }))}
        instruments={UNIVERSE}
        scheduler={{
          running: status.running,
          intervalMs: status.intervalMs,
          lastTickAt: status.lastTickAt,
          lastError: status.lastError,
          ticks: status.ticks,
        }}
      />
    </>
  );
}
