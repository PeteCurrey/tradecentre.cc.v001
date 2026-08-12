"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasSession } from "@/lib/auth/guard";
import { accounts, appConfig, books } from "@/lib/db/schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

const BOOK_IDS = ["primary", "fx", "indices", "commodities"] as const;

/**
 * Remap an OANDA account to a book.
 *
 * The initial mapping is arbitrary — OANDA gives no hint which sub-account is
 * meant to be which book — so this needs to be changeable. Trades carry the
 * book they were derived with, so remapping requires a re-derive to take
 * effect on historical trades; the UI says so rather than silently leaving
 * stale values.
 */
export async function setAccountBook(
  accountId: string,
  book: string,
): Promise<ActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = z.enum(BOOK_IDS).safeParse(book);
  if (!parsed.success) return { ok: false, error: "Unknown book" };

  await db
    .update(accounts)
    .set({ book: parsed.data })
    .where(eq(accounts.id, accountId));

  revalidatePath("/settings");
  return { ok: true };
}

const riskSchema = z.object({
  book: z.enum(BOOK_IDS),
  // 0.05%–5%. The upper bound is a guard rail, not a recommendation: at 5% a
  // run of six losses is roughly a quarter of the account.
  baseRiskPct: z.coerce.number().min(0.05).max(5),
  dailyLimitR: z.coerce.number().min(0.5).max(20),
  multipliers: z.object({
    "A+": z.coerce.number().min(0).max(5),
    A: z.coerce.number().min(0).max(5),
    B: z.coerce.number().min(0).max(5),
    C: z.coerce.number().min(0).max(5),
  }),
});

export async function setBookRisk(input: unknown): Promise<ActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = riskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  await db
    .update(books)
    .set({
      baseRiskPct: String(d.baseRiskPct),
      dailyLimitR: String(d.dailyLimitR),
      convictionMultipliers: d.multipliers,
    })
    .where(eq(books.id, d.book));

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}

const horizonSchema = z
  .object({
    scalpMaxMinutes: z.coerce.number().min(1).max(1440),
    intradayMaxMinutes: z.coerce.number().min(2).max(10080),
    swingMaxMinutes: z.coerce.number().min(60).max(525600),
  })
  // Overlapping boundaries would make classification order-dependent and the
  // resulting stats meaningless.
  .refine((v) => v.scalpMaxMinutes < v.intradayMaxMinutes, {
    message: "Scalp boundary must be below the intraday boundary",
  })
  .refine((v) => v.intradayMaxMinutes < v.swingMaxMinutes, {
    message: "Intraday boundary must be below the swing boundary",
  });

export async function setHorizonThresholds(input: unknown): Promise<ActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = horizonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await db
    .insert(appConfig)
    .values({ id: 1, horizonThresholds: parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: { horizonThresholds: parsed.data, updatedAt: new Date() },
    });

  revalidatePath("/settings");
  return { ok: true };
}

export async function setAccountActive(
  accountId: string,
  active: boolean,
): Promise<ActionResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };
  await db.update(accounts).set({ active }).where(eq(accounts.id, accountId));
  revalidatePath("/settings");
  return { ok: true };
}
