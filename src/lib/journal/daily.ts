"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasSession } from "@/lib/auth/guard";
import {
  dailyPlans,
  dailyReviews,
  opportunities,
  stateLogs,
  watchlistLevels,
} from "@/lib/db/schema";
import { BOOK_IDS } from "@/lib/books";

/**
 * The daily loop's writes: plan, opportunities, review, state, watchlist.
 *
 * All five key on the London day rather than an id, which is what makes them
 * idempotent — saving twice updates one row instead of accumulating drafts.
 *
 * These capture CONTEXT, never numbers. Every figure in this app comes from the
 * broker ledger; nothing here can change a P&L, an R multiple or a fill price.
 * That separation is the reason the journal can be trusted: no amount of
 * typing in these forms can alter what actually happened.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function guard(): Promise<boolean> {
  return hasSession();
}

/* -------------------------------------------------------------------------- */
/* Pre-market plan                                                             */
/* -------------------------------------------------------------------------- */

const planSchema = z.object({
  day: z.string().regex(DAY),
  bias: z.record(z.string(), z.string().max(500)).default({}),
  levels: z.record(z.string(), z.array(z.number())).default({}),
  setupsHunted: z.array(z.coerce.number().int().positive()).default([]),
  notes: z.string().max(20000).nullable().optional(),
});

export async function saveDailyPlan(input: unknown): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const values = {
    day: d.day,
    bias: d.bias,
    levels: d.levels,
    setupsHunted: d.setupsHunted,
    notes: d.notes?.trim() || null,
    updatedAt: new Date(),
  };

  await db
    .insert(dailyPlans)
    .values(values)
    .onConflictDoUpdate({
      target: dailyPlans.day,
      // aiDraft is left alone: a manual save must not wipe a generated brief.
      set: {
        bias: values.bias,
        levels: values.levels,
        setupsHunted: values.setupsHunted,
        notes: values.notes,
        updatedAt: values.updatedAt,
      },
    });

  revalidatePath("/pre-market");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

const oppSchema = z.object({
  day: z.string().regex(DAY),
  instrument: z.string().regex(/^[A-Z0-9]+_[A-Z0-9]+$/),
  // Only "spotted" is writable from the UI. An AI or engine candidate must be
  // written by the AI or the engine, or the three-way comparison the screen
  // exists for would be meaningless.
  source: z.literal("spotted"),
  book: z.enum(BOOK_IDS).nullable().optional(),
  conviction: z.enum(["A+", "A", "B", "C"]).nullable().optional(),
  score: z.coerce.number().min(0).max(100).nullable().optional(),
  reasoning: z.string().max(5000).nullable().optional(),
  invalidation: z.string().max(2000).nullable().optional(),
});

export async function logOpportunity(input: unknown): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };

  const parsed = oppSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  await db.insert(opportunities).values({
    day: d.day,
    instrument: d.instrument,
    source: d.source,
    book: d.book ?? null,
    conviction: d.conviction ?? null,
    score: d.score ?? null,
    reasoning: d.reasoning?.trim() || null,
    invalidation: d.invalidation?.trim() || null,
  });

  revalidatePath("/opportunities");
  return { ok: true };
}

/**
 * Mark an opportunity as taken, optionally linking the trade it became.
 *
 * The link is what turns the screen from a list into a measurement: spotted vs
 * taken vs what it would have done is the only honest test of selection.
 */
export async function markOpportunityTaken(
  id: number,
  taken: boolean,
  link?: { accountId: string; oandaTradeId: string },
): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };

  await db
    .update(opportunities)
    .set({
      taken,
      linkedAccountId: taken ? (link?.accountId ?? null) : null,
      linkedOandaTradeId: taken ? (link?.oandaTradeId ?? null) : null,
    })
    .where(eq(opportunities.id, id));

  revalidatePath("/opportunities");
  return { ok: true };
}

export async function deleteOpportunity(id: number): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };
  await db.delete(opportunities).where(eq(opportunities.id, id));
  revalidatePath("/opportunities");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* End of day review                                                           */
/* -------------------------------------------------------------------------- */

const reviewSchema = z.object({
  day: z.string().regex(DAY),
  processGrade: z.enum(["A", "B", "C", "D", "F"]).nullable().optional(),
  adherencePct: z.coerce.number().min(0).max(100).nullable().optional(),
  whatWorked: z.string().max(20000).nullable().optional(),
  whatBroke: z.string().max(20000).nullable().optional(),
  tomorrow: z.string().max(20000).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
});

export async function saveDailyReview(input: unknown): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const set = {
    processGrade: d.processGrade ?? null,
    adherencePct: d.adherencePct ?? null,
    whatWorked: d.whatWorked?.trim() || null,
    whatBroke: d.whatBroke?.trim() || null,
    tomorrow: d.tomorrow?.trim() || null,
    notes: d.notes?.trim() || null,
    updatedAt: new Date(),
  };

  await db
    .insert(dailyReviews)
    .values({ day: d.day, ...set })
    .onConflictDoUpdate({ target: dailyReviews.day, set });

  revalidatePath("/review");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* State log                                                                   */
/* -------------------------------------------------------------------------- */

const stateSchema = z.object({
  day: z.string().regex(DAY),
  sleep: z.coerce.number().int().min(1).max(5).nullable().optional(),
  energy: z.coerce.number().int().min(1).max(5).nullable().optional(),
  focus: z.coerce.number().int().min(1).max(5).nullable().optional(),
  emotionPre: z.string().max(200).nullable().optional(),
  emotionDuring: z.string().max(200).nullable().optional(),
  emotionPost: z.string().max(200).nullable().optional(),
  tiltMarkers: z.array(z.string().max(60)).max(12).default([]),
  notes: z.string().max(5000).nullable().optional(),
});

export async function saveStateLog(input: unknown): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };

  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const set = {
    sleep: d.sleep ?? null,
    energy: d.energy ?? null,
    focus: d.focus ?? null,
    emotionPre: d.emotionPre?.trim() || null,
    emotionDuring: d.emotionDuring?.trim() || null,
    emotionPost: d.emotionPost?.trim() || null,
    tiltMarkers: d.tiltMarkers,
    notes: d.notes?.trim() || null,
  };

  await db
    .insert(stateLogs)
    .values({ day: d.day, ...set })
    .onConflictDoUpdate({ target: stateLogs.day, set });

  revalidatePath("/psychology");
  revalidatePath("/review");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Watchlist                                                                   */
/* -------------------------------------------------------------------------- */

const levelSchema = z.object({
  instrument: z.string().regex(/^[A-Z0-9]+_[A-Z0-9]+$/),
  price: z.coerce.number().positive(),
  label: z.string().max(120).nullable().optional(),
  kind: z.enum(["level", "support", "resistance", "target"]).default("level"),
});

export async function addWatchLevel(input: unknown): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };

  const parsed = levelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  await db.insert(watchlistLevels).values({
    instrument: d.instrument,
    price: String(d.price),
    label: d.label?.trim() || null,
    kind: d.kind,
  });

  revalidatePath("/watchlist");
  return { ok: true };
}

export async function setWatchLevelActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };
  await db.update(watchlistLevels).set({ active }).where(eq(watchlistLevels.id, id));
  revalidatePath("/watchlist");
  return { ok: true };
}

export async function deleteWatchLevel(id: number): Promise<ActionResult> {
  if (!(await guard())) return { ok: false, error: "Not signed in" };
  await db.delete(watchlistLevels).where(eq(watchlistLevels.id, id));
  revalidatePath("/watchlist");
  return { ok: true };
}
