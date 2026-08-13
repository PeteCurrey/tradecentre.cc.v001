import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { aiRuns } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * The AI call path, with cost logged on every request.
 *
 * Two rules:
 *
 *   1. EVERY call is written to `ai_runs`, including the ones that fail.
 *      A failed call still consumed tokens up to the point it failed, and a
 *      cost table with only the successes understates spend precisely when
 *      something is going wrong.
 *   2. Cost is computed from the response's own token counts against a rate
 *      table, not estimated from string lengths. Rates are stated per model so
 *      a wrong figure is visible and fixable rather than mysterious.
 */

/** USD per million tokens. Update when Anthropic's published pricing changes. */
const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const DEFAULT_MODEL = "claude-opus-5";

export type AiTask =
  | "ask"
  | "eod_draft"
  | "grade"
  | "premarket"
  | "scan_context"
  | "meta"
  | "pretrade";

export type AiResult =
  | { ok: true; text: string; costUsd: number; model: string; latencyMs: number }
  | { ok: false; error: string };

function costOf(model: string, inTok: number, outTok: number): number {
  const rate = RATES[model];
  if (!rate) return 0;
  return (inTok / 1_000_000) * rate.input + (outTok / 1_000_000) * rate.output;
}

export async function runAi(opts: {
  task: AiTask;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  maxTokens?: number;
  meta?: Record<string, unknown>;
}): Promise<AiResult> {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      // Adaptive thinking: the model decides how much reasoning a question
      // needs. "How did June go?" and "is my conviction scale working?" are
      // very different questions and should not cost the same.
      thinking: { type: "adaptive" },
      system: opts.system,
      messages: opts.messages,
    });

    const latencyMs = Date.now() - started;

    // A refusal is a successful HTTP response with no usable content — check
    // it before reading blocks, or the answer silently becomes an empty string.
    if (response.stop_reason === "refusal") {
      await log({
        task: opts.task,
        model,
        response,
        latencyMs,
        ok: false,
        error: "refused",
        meta: opts.meta,
      });
      return {
        ok: false,
        error: "The model declined to answer this one. Rephrasing usually helps.",
      };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    await log({ task: opts.task, model, response, latencyMs, ok: true, meta: opts.meta });

    return {
      ok: true,
      text,
      costUsd: costOf(model, response.usage.input_tokens, response.usage.output_tokens),
      model,
      latencyMs,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const error = e instanceof Error ? e.message : String(e);

    await db.insert(aiRuns).values({
      task: opts.task,
      provider: "anthropic",
      model,
      latencyMs,
      ok: false,
      error,
      meta: opts.meta ?? {},
    });

    return { ok: false, error };
  }
}

async function log(o: {
  task: AiTask;
  model: string;
  response: Anthropic.Message;
  latencyMs: number;
  ok: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const inTok = o.response.usage.input_tokens;
  const outTok = o.response.usage.output_tokens;

  await db.insert(aiRuns).values({
    task: o.task,
    provider: "anthropic",
    model: o.model,
    promptTokens: inTok,
    completionTokens: outTok,
    costUsd: String(costOf(o.model, inTok, outTok).toFixed(6)),
    latencyMs: o.latencyMs,
    ok: o.ok,
    error: o.error ?? null,
    meta: {
      ...(o.meta ?? {}),
      stopReason: o.response.stop_reason,
      cacheRead: o.response.usage.cache_read_input_tokens ?? 0,
    },
  });
}
