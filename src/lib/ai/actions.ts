"use server";

import { z } from "zod";
import { hasSession } from "@/lib/auth/guard";
import { buildAskContext } from "./context";
import { runAi } from "./router";

/**
 * Ask — questions about Peter's own trading record, in plain English.
 *
 * The system prompt is doing real work here, and the parts that matter are the
 * prohibitions: the model answers from a supplied brief of pre-computed
 * figures, and is told plainly to say when the brief cannot answer the
 * question rather than reasoning its way to a plausible number.
 *
 * A confidently wrong figure in a trading journal is worse than "I can't tell
 * from this data" — it is indistinguishable from a real one.
 */

const SYSTEM = `You answer questions about one trader's own historical record.

WHAT YOU HAVE
A brief of figures already computed by the application from the broker's ledger.
Those figures are facts. Quote them directly.

HARD RULES
1. Answer ONLY from the brief. If it does not contain what is needed, say so
   plainly and name what would be needed. Never estimate, extrapolate, or infer
   a number that is not there.
2. Do not do arithmetic beyond trivial comparison. If a question needs a figure
   the brief does not carry, that is a "the data doesn't answer that" reply, not
   a calculation.
3. Always carry the sample size. A rate over 6 independent exits is not
   evidence, and you must say so when you quote it. The brief states how many
   INDEPENDENT EXITS sit behind the trade count — that, not the trade count, is
   the number of real outcomes.
4. Trades with no R multiple are excluded from R figures. If a question touches
   them, say which figures they are missing from.
5. You are not a financial adviser and must not tell them what to trade, when to
   trade, or how much to risk. Describing what their record shows is fine.
   Recommending a position is not.
6. Be direct and brief. Lead with the answer. No preamble, no restating the
   question, no closing offers of further help.

TONE
Write like a colleague reading the same spreadsheet: plain sentences, specific
numbers, and an honest "that isn't measurable here" when it isn't.`;

const schema = z.object({
  question: z.string().min(3).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20000),
      }),
    )
    .max(20)
    .default([]),
});

export type AskResult =
  | { ok: true; answer: string; costUsd: number; model: string; latencyMs: number; brief: string }
  | { ok: false; error: string };

export async function askQuestion(input: unknown): Promise<AskResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { question, history } = parsed.data;

  const context = await buildAskContext();

  if (context.trades === 0) {
    return {
      ok: false,
      error:
        "There are no closed trades to ask about yet. Sync the ledger from OANDA first.",
    };
  }

  // The brief rides on the first user turn rather than in the system prompt, so
  // follow-up questions in a conversation reuse the same cached prefix instead
  // of re-sending it.
  const messages =
    history.length > 0
      ? [...history, { role: "user" as const, content: question }]
      : [
          {
            role: "user" as const,
            content: `${context.brief}\n\n---\n\nQuestion: ${question}`,
          },
        ];

  const result = await runAi({
    task: "ask",
    system: SYSTEM,
    messages,
    meta: { trades: context.trades, questionChars: question.length },
  });

  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    answer: result.text,
    costUsd: result.costUsd,
    model: result.model,
    latencyMs: result.latencyMs,
    brief: context.brief,
  };
}
