"use server";

import { z } from "zod";
import { hasSession } from "@/lib/auth/guard";
import { runScreen, type ScreenRun } from "./run";

/**
 * The screening action.
 *
 * Results are returned, not stored. That is deliberate for now: a persisted
 * "last result" invites reading a stale verdict as current, and the run is
 * cheap enough to repeat. When rejected candidates need retaining with their
 * results (§8e, decision #71) that belongs in its own table with the criteria
 * and tested-count recorded alongside — not as a cached blob.
 */

const schema = z.object({
  instruments: z.array(z.string().regex(/^[A-Z0-9]+_[A-Z0-9]+$/)).min(1).max(8),
  slugs: z.array(z.string().max(80)).max(60).optional(),
  windows: z.coerce.number().int().min(2).max(12).optional(),
  fdr: z.coerce.number().min(0.01).max(0.5).optional(),
  minTrades: z.coerce.number().int().min(5).max(500).optional(),
  minConsistency: z.coerce.number().min(0).max(1).optional(),
});

export type ScreenActionResult =
  | { ok: true; run: ScreenRun }
  | { ok: false; error: string };

export async function screenPatterns(input: unknown): Promise<ScreenActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  try {
    const run = await runScreen({
      instruments: d.instruments,
      slugs: d.slugs,
      criteria: {
        windows: d.windows,
        fdr: d.fdr,
        minTrades: d.minTrades,
        minConsistency: d.minConsistency,
      },
    });
    return { ok: true, run };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
