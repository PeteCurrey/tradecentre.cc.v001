"use server";

import { revalidatePath } from "next/cache";
import { hasSession } from "@/lib/auth/guard";
import { syncAndDerive } from "./rebuild";

/**
 * In-app sync.
 *
 * Deliberately manual rather than automatic on page load: a sync on every
 * render would hammer OANDA, make navigation slow, and rebuild the trades
 * table constantly for no benefit. Peter presses it when he has traded.
 */

export type SyncActionResult =
  | { ok: true; newTransactions: number; totalTrades: number; seconds: number; errors: string[] }
  | { ok: false; error: string };

/** Guards against overlapping runs — two concurrent rebuilds would race on the
 *  wholesale delete-and-reinsert and could briefly empty the trades table. */
let running = false;

export async function syncNow(): Promise<SyncActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };
  if (running) return { ok: false, error: "A sync is already running" };

  running = true;
  try {
    const summary = await syncAndDerive();
    revalidatePath("/", "layout");
    return {
      ok: true,
      newTransactions: summary.totalNew,
      totalTrades: summary.totalTrades,
      seconds: Number((summary.durationMs / 1000).toFixed(1)),
      errors: summary.errors,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    running = false;
  }
}
