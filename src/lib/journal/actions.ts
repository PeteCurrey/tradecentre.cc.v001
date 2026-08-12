"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasSession } from "@/lib/auth/guard";
import { tradeAnnotations } from "@/lib/db/schema";
import { ALL_MISTAKES } from "./taxonomy";

/**
 * Annotation writes.
 *
 * Annotations live in their own table keyed on the BROKER's trade id, never on
 * the derived row id. Trades are wiped and rebuilt whenever derivation logic
 * changes, and this is what guarantees that cannot orphan Peter's notes.
 */

const VALID_MISTAKES = new Set(ALL_MISTAKES.map((m) => m.id));

const schema = z.object({
  accountId: z.string().min(1),
  oandaTradeId: z.string().min(1),
  patternId: z.coerce.number().int().positive().nullable().optional(),
  conviction: z.enum(["A+", "A", "B", "C"]).nullable().optional(),
  /** Overrides the horizon inferred from hold time. Null means "use inferred". */
  horizonOverride: z
    .enum(["scalp", "intraday", "swing", "position"])
    .nullable()
    .optional(),
  processGrade: z.enum(["A", "B", "C", "D", "F"]).nullable().optional(),
  mistakes: z.array(z.string()).default([]),
  reasoning: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveAnnotation(input: unknown): Promise<SaveResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  // Reject unknown mistake ids rather than storing them: an id outside the
  // taxonomy would vanish silently from every Mistakes & Leaks total.
  const unknown = data.mistakes.filter((m) => !VALID_MISTAKES.has(m));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown mistake tag: ${unknown.join(", ")}` };
  }

  const values = {
    accountId: data.accountId,
    oandaTradeId: data.oandaTradeId,
    patternId: data.patternId ?? null,
    conviction: data.conviction ?? null,
    horizonOverride: data.horizonOverride ?? null,
    processGrade: data.processGrade ?? null,
    mistakes: data.mistakes,
    reasoning: data.reasoning?.trim() || null,
    notes: data.notes?.trim() || null,
    updatedAt: new Date(),
  };

  await db
    .insert(tradeAnnotations)
    .values(values)
    .onConflictDoUpdate({
      target: [tradeAnnotations.accountId, tradeAnnotations.oandaTradeId],
      set: {
        patternId: values.patternId,
        conviction: values.conviction,
        horizonOverride: values.horizonOverride,
        processGrade: values.processGrade,
        mistakes: values.mistakes,
        reasoning: values.reasoning,
        notes: values.notes,
        updatedAt: values.updatedAt,
        // patternConfirmed is set separately when an engine suggestion is
        // accepted; a manual save must not silently mark it confirmed.
      },
    });

  revalidatePath(`/trades/${data.oandaTradeId}`);
  revalidatePath("/trades");
  return { ok: true };
}
