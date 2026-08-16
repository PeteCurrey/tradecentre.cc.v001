import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { currentUser } from "@/lib/identity/user";
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

  // Every query below names this member. The engine page is the one screen that
  // can start real orders, so an unscoped read here is not a privacy slip — it
  // is showing someone another member's arm switches.
  const user = await currentUser();
  if (!user) notFound();
  await ensureExecutionState(user.id);

  const myAccounts = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.active, true)));

  const [states, accountRows, patternRows, openTrades] = await Promise.all([
    db.select().from(executionState).where(eq(executionState.userId, user.id)),
    myAccounts,
    // The house library plus this member's own patterns — nothing of anyone
    // else's, whatever they have named it.
    db
      .select()
      .from(patterns)
      .where(or(isNull(patterns.userId), eq(patterns.userId, user.id)))
      .orderBy(asc(patterns.name)),
    db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.state, "open"),
          inArray(
            trades.accountId,
            db
              .select({ id: accounts.id })
              .from(accounts)
              .where(eq(accounts.userId, user.id)),
          ),
        ),
      ),
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
