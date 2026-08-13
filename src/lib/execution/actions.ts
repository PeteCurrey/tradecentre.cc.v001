"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasSession } from "@/lib/auth/guard";
import { executionState, accounts } from "@/lib/db/schema";
import { BOOK_IDS, type BookId } from "@/lib/books";
import { ensureExecutionState, haltBook } from "./engine";

/**
 * Engine controls.
 *
 * Every one of these is a deliberate human act. The rules they enforce, in
 * order of how much they matter:
 *
 *   1. Arming ALWAYS lands in dry run. Going live is a separate second click,
 *      so the first arming of a book can never send an order.
 *   2. Live capital cannot be unlocked from the same call that arms. It has its
 *      own action and its own typed confirmation.
 *   3. Halting is instant, unconditional, and does not require the engine to be
 *      in any particular state — a kill switch that validates first is not a
 *      kill switch.
 *   4. Coming back from `halted` requires clearing the halt explicitly, so a
 *      tripped daily limit never resumes on its own at midnight.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const bookSchema = z.enum(BOOK_IDS);

async function authed(): Promise<boolean> {
  return hasSession();
}

function refresh() {
  revalidatePath("/engine");
  revalidatePath("/orders");
  revalidatePath("/");

  /**
   * Push the new arm state to every open browser at once.
   *
   * `revalidatePath` only refreshes the tab that made the request. Without this
   * a kill switch pressed on a phone would leave a desktop showing an armed
   * rail for up to a full broadcast interval — the one situation where a stale
   * "it's running" indicator is genuinely dangerous.
   *
   * Not awaited: the action must not fail because a fan-out did.
   */
  void import("@/lib/desk/broadcast")
    .then((m) => m.broadcastNow())
    .catch(() => {
      /* the periodic loop will catch up */
    });
}

/**
 * Arm a book.
 *
 * Forces `dryRun` back on regardless of its previous value. That is the whole
 * safety property: no sequence of clicks arms a book straight into live order
 * submission, including re-arming one that was live before it was disarmed.
 */
export async function armBook(book: string): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  const parsed = bookSchema.safeParse(book);
  if (!parsed.success) return { ok: false, error: "Unknown book" };

  await ensureExecutionState();

  const [row] = await db
    .select()
    .from(executionState)
    .where(eq(executionState.book, parsed.data));

  if (row?.state === "halted") {
    return {
      ok: false,
      error: "Book is halted. Clear the halt first — deliberately, not by re-arming.",
    };
  }

  await db
    .update(executionState)
    .set({
      state: "armed",
      dryRun: true,
      armedAt: new Date(),
      haltedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(executionState.book, parsed.data));

  refresh();
  return { ok: true };
}

export async function disarmBook(book: string): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  const parsed = bookSchema.safeParse(book);
  if (!parsed.success) return { ok: false, error: "Unknown book" };

  await db
    .update(executionState)
    .set({ state: "disarmed", armedAt: null, updatedAt: new Date() })
    .where(eq(executionState.book, parsed.data));

  refresh();
  return { ok: true };
}

/**
 * Arm every book that can actually run — the "Enable Auto Trading" switch.
 *
 * Convenience over `armBook`, and nothing more. It holds the same invariants,
 * because a one-click control is exactly where they would be most tempting to
 * relax:
 *
 *   • every book still lands in DRY RUN, so this button can never place an
 *     order no matter how many times it is pressed
 *   • halted books are SKIPPED, not cleared — a tripped limit still requires
 *     someone to look at why
 *   • books with no account, no instruments or no patterns are skipped, since
 *     arming them would show an armed badge over something that permits nothing
 *
 * Returns what it did rather than a bare ok, so the UI can say "2 of 4 armed"
 * and name the ones it left alone instead of implying the whole desk is live.
 */
export type ArmAllResult = {
  ok: boolean;
  armed: BookId[];
  skipped: { book: BookId; reason: string }[];
  error?: string;
};

export async function armAll(): Promise<ArmAllResult> {
  if (!(await authed())) {
    return { ok: false, armed: [], skipped: [], error: "Not signed in" };
  }

  await ensureExecutionState();

  const [states, accountRows] = await Promise.all([
    db.select().from(executionState),
    db.select().from(accounts).where(eq(accounts.active, true)),
  ]);

  const hasAccount = new Set(accountRows.map((a) => a.book as BookId));
  const armed: BookId[] = [];
  const skipped: { book: BookId; reason: string }[] = [];

  for (const state of states) {
    const book = state.book as BookId;

    if (state.state === "halted") {
      skipped.push({ book, reason: state.haltedReason ?? "Halted" });
      continue;
    }
    if (!hasAccount.has(book)) {
      skipped.push({ book, reason: "No active OANDA account" });
      continue;
    }
    if (state.instrumentAllowlist.length === 0) {
      skipped.push({ book, reason: "No instruments permitted" });
      continue;
    }
    if (state.enabledPatternIds.length === 0) {
      skipped.push({ book, reason: "No patterns enabled" });
      continue;
    }

    await db
      .update(executionState)
      .set({
        state: "armed",
        // Same forced reset as armBook. Re-arming a book that was live before
        // it was disarmed must not resume sending orders.
        dryRun: true,
        armedAt: new Date(),
        haltedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(executionState.book, book));
    armed.push(book);
  }

  refresh();
  return { ok: true, armed, skipped };
}

/** Disarm every book at once. The counterpart to `armAll`. */
export async function disarmAll(): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };

  await db
    .update(executionState)
    .set({ state: "disarmed", armedAt: null, updatedAt: new Date() })
    .where(eq(executionState.state, "armed"));

  refresh();
  return { ok: true };
}

/**
 * The kill switch. Halts every book at once, armed or not.
 *
 * No validation, no confirmation dialog on the server side, no partial
 * application — it writes `halted` to all four rows and returns. Halting a book
 * that was already disarmed is harmless and deliberate: after pressing this,
 * nothing can start trading without a human clearing the halt.
 */
export async function killAll(reason = "Kill switch"): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  await ensureExecutionState();
  for (const book of BOOK_IDS) {
    await haltBook(book, reason);
  }
  refresh();
  return { ok: true };
}

/**
 * Clear a halt. Lands the book in `disarmed`, never straight back to `armed` —
 * whatever tripped the halt deserves a look before the engine runs again.
 */
export async function clearHalt(book: string): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  const parsed = bookSchema.safeParse(book);
  if (!parsed.success) return { ok: false, error: "Unknown book" };

  await db
    .update(executionState)
    .set({ state: "disarmed", haltedReason: null, armedAt: null, updatedAt: new Date() })
    .where(eq(executionState.book, parsed.data));

  refresh();
  return { ok: true };
}

/**
 * Leave dry run — the click that lets orders reach the broker.
 *
 * Requires the book to be armed already, so the sequence is always
 * arm → observe a tick → go live, and never one action.
 */
export async function setDryRun(book: string, dryRun: boolean): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  const parsed = bookSchema.safeParse(book);
  if (!parsed.success) return { ok: false, error: "Unknown book" };

  const [row] = await db
    .select()
    .from(executionState)
    .where(eq(executionState.book, parsed.data));
  if (!row) return { ok: false, error: "No execution state for this book" };

  if (!dryRun && row.state !== "armed") {
    return { ok: false, error: "Arm the book before taking it out of dry run" };
  }

  await db
    .update(executionState)
    .set({ dryRun, updatedAt: new Date() })
    .where(eq(executionState.book, parsed.data));

  refresh();
  return { ok: true };
}

/**
 * Unlock live capital.
 *
 * Guards read this column rather than the environment, so a book mapped to a
 * live OANDA account still cannot trade real money until this is true. Every
 * account today is practice; this exists so that stays a choice.
 */
export async function setAllowLiveCapital(
  book: string,
  allow: boolean,
  confirmation?: string,
): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  const parsed = bookSchema.safeParse(book);
  if (!parsed.success) return { ok: false, error: "Unknown book" };

  // Typed confirmation, not a checkbox: this is the only switch in the app that
  // stands between the engine and real money.
  if (allow && confirmation?.trim().toUpperCase() !== "LIVE CAPITAL") {
    return { ok: false, error: 'Type "LIVE CAPITAL" to confirm' };
  }

  await db
    .update(executionState)
    .set({ allowLiveCapital: allow, updatedAt: new Date() })
    .where(eq(executionState.book, parsed.data));

  refresh();
  return { ok: true };
}

const limitsSchema = z.object({
  book: bookSchema,
  maxOpenPositions: z.coerce.number().int().min(0).max(20),
  maxRiskMultiple: z.coerce.number().min(0).max(3),
  instrumentAllowlist: z.array(z.string().regex(/^[A-Z0-9]+_[A-Z0-9]+$/)).max(40),
  enabledPatternIds: z.array(z.coerce.number().int().positive()).max(50),
});

/**
 * The permission surface: which instruments, which patterns, how much.
 *
 * Both lists are empty by default and an empty list permits nothing, so a book
 * that has never been configured cannot trade even while armed and live.
 */
export async function setBookLimits(input: unknown): Promise<ActionResult> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };

  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  await db
    .update(executionState)
    .set({
      maxOpenPositions: d.maxOpenPositions,
      maxRiskMultiple: String(d.maxRiskMultiple),
      instrumentAllowlist: [...new Set(d.instrumentAllowlist)],
      enabledPatternIds: [...new Set(d.enabledPatternIds)],
      updatedAt: new Date(),
    })
    .where(eq(executionState.book, d.book));

  refresh();
  return { ok: true };
}

/**
 * Run one tick by hand.
 *
 * Useful before trusting the scheduler: arm a book in dry run, press this, and
 * read exactly what the engine would have sent in the order log.
 */
export async function runTickNow(): Promise<
  { ok: true; results: unknown } | { ok: false; error: string }
> {
  if (!(await authed())) return { ok: false, error: "Not signed in" };
  const { runTick } = await import("./engine");
  try {
    const results = await runTick();
    refresh();
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Books that have an account behind them, for the UI to grey out the rest. */
export async function booksWithAccounts(): Promise<BookId[]> {
  const rows = await db.select().from(accounts).where(eq(accounts.active, true));
  return [...new Set(rows.map((r) => r.book as BookId))];
}
