"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasSession } from "@/lib/auth/guard";
import { goals } from "@/lib/db/schema";
import { BOOK_IDS } from "@/lib/books";
import { GOAL_METRICS, metricDef, type GoalMetric } from "./score";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  period: z.string().regex(/^\d{4}(-(\d{2}|Q[1-4]))?$/, "Period must be 2026, 2026-08 or 2026-Q3"),
  metric: z.enum(GOAL_METRICS.map((m) => m.id) as [GoalMetric, ...GoalMetric[]]),
  target: z.coerce.number().finite(),
  book: z.enum(BOOK_IDS).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function addGoal(input: unknown): Promise<ActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  await db.insert(goals).values({
    period: d.period.toUpperCase(),
    metric: d.metric,
    target: String(d.target),
    // Derived from the metric, never taken from the caller — a drawdown goal
    // scored as higher-is-better would congratulate you for a bigger loss.
    lowerIsBetter: metricDef(d.metric).lowerIsBetter,
    book: d.book ?? null,
    note: d.note?.trim() || null,
  });

  revalidatePath("/goals");
  return { ok: true };
}

export async function deleteGoal(id: number): Promise<ActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };
  await db.delete(goals).where(eq(goals.id, id));
  revalidatePath("/goals");
  return { ok: true };
}
