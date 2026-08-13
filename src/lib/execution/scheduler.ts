import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionState } from "@/lib/db/schema";
import { DISPLAY_TZ, partsIn } from "@/lib/time";

/**
 * The tick scheduler.
 *
 * A plain interval rather than a job queue, because the app is a single
 * always-on process and a queue would add a failure mode without adding a
 * capability.
 *
 * Four properties that matter more than the scheduling itself:
 *
 *   • SINGLE FLIGHT. A tick that overruns its interval must not overlap with
 *     the next one — two concurrent ticks would each see the other's orders as
 *     not-yet-placed and could double a position.
 *   • NO ARMED BOOKS, NO WORK. The loop wakes, sees nothing armed, and returns
 *     without touching the broker. Idle costs one query.
 *   • MARKET HOURS ONLY. FX is shut from Friday evening to Sunday evening;
 *     ticking through the weekend just logs errors.
 *   • ERRORS NEVER STOP THE LOOP. A thrown tick is logged and the next one runs
 *     — an engine that silently stops managing open positions after one bad
 *     response is more dangerous than one that retries.
 */

/** Every 60s: the engine scans M5 bars, so faster adds calls, not information. */
export const TICK_INTERVAL_MS = 60_000;

/**
 * State lives on globalThis, not in module scope.
 *
 * `instrumentation.ts` and the Engine page do not necessarily get the same
 * copy of this module — Next can load a server module more than once across
 * bundle layers, and each copy gets its own `let`. That made the Engine screen
 * report "Scheduler stopped" while the scheduler was demonstrably running and
 * logging ticks, which is the wrong answer on the one screen you would consult
 * to find out. It would also let a second copy start a second interval.
 */
const g = globalThis as unknown as {
  __engineScheduler?: { timer: NodeJS.Timeout | null; inFlight: boolean; status: SchedulerStatus };
};

export type SchedulerStatus = {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastTickMs: number | null;
  lastError: string | null;
  ticks: number;
  skippedOverlaps: number;
};

const state = (g.__engineScheduler ??= {
  timer: null,
  inFlight: false,
  status: {
    running: false,
    intervalMs: TICK_INTERVAL_MS,
    lastTickAt: null,
    lastTickMs: null,
    lastError: null,
    ticks: 0,
    skippedOverlaps: 0,
  },
});

const status = state.status;

export function schedulerStatus(): SchedulerStatus {
  return { ...status, running: state.timer !== null };
}

/**
 * FX market hours, in London time. Deliberately conservative at the edges —
 * the cost of missing the first minutes of Sunday's open is nil, and the cost
 * of trading into a closed or gapping book is not.
 */
export function marketOpen(at: Date = new Date()): boolean {
  const { hour, weekday } = partsIn(at, DISPLAY_TZ);
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return hour >= 23;
  if (weekday === "Fri") return hour < 21;
  return true;
}

async function anyBookArmed(): Promise<boolean> {
  const rows = await db
    .select({ book: executionState.book })
    .from(executionState)
    .where(eq(executionState.state, "armed"))
    .limit(1);
  return rows.length > 0;
}

async function tick(): Promise<void> {
  if (state.inFlight) {
    status.skippedOverlaps++;
    console.warn("[engine] previous tick still running — skipping this one");
    return;
  }

  const open = marketOpen();

  /**
   * A skipped tick still reports itself.
   *
   * Nothing armed, or the market shut, is a REASON — and a scan panel that goes
   * silent looks identical to one that has crashed. Publishing an empty scan
   * says "I ran, there was nothing to do", which is the distinction the whole
   * telemetry surface exists to make.
   */
  if (!(await anyBookArmed()) || !open) {
    const { publishIdleScan } = await import("./telemetry");
    publishIdleScan({ nextAt: Date.now() + TICK_INTERVAL_MS, marketOpen: open });
    return;
  }

  state.inFlight = true;
  const started = Date.now();
  try {
    const { runTick } = await import("./engine");
    const results = await runTick({
      nextTickAt: Date.now() + TICK_INTERVAL_MS,
      marketOpen: open,
    });

    status.ticks++;
    status.lastTickAt = new Date().toISOString();
    status.lastTickMs = Date.now() - started;
    status.lastError = null;

    for (const r of results) {
      // Only say something when the tick did something. A line a minute saying
      // "nothing happened" makes the lines that matter unreadable.
      if (r.managed || r.submitted || r.rejected || r.errors.length) {
        console.log(
          `[engine] ${r.book}: managed ${r.managed} · scanned ${r.scanned} · ` +
            `submitted ${r.submitted} · rejected ${r.rejected}` +
            (r.errors.length ? ` · errors: ${r.errors.join("; ")}` : ""),
        );
      }
    }
  } catch (e) {
    status.lastError = (e as Error).message;
    console.error("[engine] tick failed:", status.lastError);
  } finally {
    state.inFlight = false;
  }
}

export function startScheduler(): void {
  if (state.timer) return;
  state.timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  // Never hold the process open on the engine's account.
  state.timer.unref?.();
  status.running = true;
  console.log(`[engine] scheduler started — tick every ${TICK_INTERVAL_MS / 1000}s`);
}

export function stopScheduler(): void {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
  status.running = false;
}
