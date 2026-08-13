"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Send, Sparkles } from "lucide-react";
import { askQuestion } from "@/lib/ai/actions";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";

type Turn = {
  role: "user" | "assistant";
  content: string;
  costUsd?: number;
  latencyMs?: number;
};

const SUGGESTIONS = [
  "Which instrument costs me the most in spread relative to what it earns?",
  "Does my conviction grading actually predict outcome?",
  "What does my worst drawdown look like, and did I recover from it?",
  "Which hour of the day do I trade worst, and is the sample big enough to matter?",
  "How much of my record has no stop recorded, and what does that hide?",
];

export function AskPanel({ trades, hasKey }: { trades: number; hasKey: boolean }) {
  const [pending, startTransition] = useTransition();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);

  const spend = turns.reduce((s, t) => s + (t.costUsd ?? 0), 0);

  function ask(question: string) {
    if (!question.trim() || pending) return;
    setError(null);
    setInput("");

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: question }]);

    startTransition(async () => {
      const res = await askQuestion({ question, history });
      if (!res.ok) {
        setError(res.error);
        // Drop the unanswered question rather than leaving it hanging in the
        // transcript as though it had been asked and ignored.
        setTurns((t) => t.slice(0, -1));
        return;
      }
      setBrief(res.brief);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: res.answer,
          costUsd: res.costUsd,
          latencyMs: res.latencyMs,
        },
      ]);
    });
  }

  if (!hasKey) {
    return (
      <Card className="p-8">
        <h2 className="label">No Anthropic API key configured</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-mute)]">
          Set <code className="figure text-[var(--color-accent)]">ANTHROPIC_API_KEY</code> in
          the environment and restart. Every call is logged to{" "}
          <code className="figure">ai_runs</code> with its token count and cost, so spend is
          visible in the app from the first question rather than discovered on a bill.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex min-h-[26rem] flex-col p-5">
        <CardHeader
          title="Ask"
          action={
            <span className="label-faint">
              {turns.length > 0 && `$${spend.toFixed(4)} this session`}
            </span>
          }
        />

        <div className="mt-4 flex-1 space-y-4 overflow-y-auto">
          {turns.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-[var(--color-ink-mute)]">
                Questions are answered from a brief of figures this app already computed from
                your ledger — the same functions that render the analytics screens. The model
                is told not to calculate anything new and to say when the data can&apos;t
                answer, because a confidently wrong number here is indistinguishable from a
                real one.
              </p>
              <div className="space-y-1.5">
                <span className="label-faint">Try</span>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2 text-left text-[13px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent-line)] hover:text-[var(--color-accent)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i}>
              {t.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--color-accent-wash)] px-3.5 py-2 text-[13px] text-[var(--color-accent)]">
                    {t.content}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start gap-2.5">
                    <Sparkles className="mt-1 size-3.5 shrink-0 text-[var(--color-accent)]" />
                    <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">
                      {t.content}
                    </div>
                  </div>
                  <div className="mt-1 pl-6 text-[10px] text-[var(--color-ink-faint)]">
                    ${t.costUsd?.toFixed(4)} · {((t.latencyMs ?? 0) / 1000).toFixed(1)}s
                  </div>
                </div>
              )}
            </div>
          ))}

          {pending && (
            <div className="flex items-center gap-2.5 text-[13px] text-[var(--color-ink-mute)]">
              <Loader2 className="size-3.5 animate-spin text-[var(--color-accent)]" />
              Reading {trades} trades…
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-[var(--color-warn)]">{error}</p>}

        <div className="mt-4 flex items-end gap-2 border-t border-[var(--color-line)] pt-4">
          <textarea
            value={input}
            rows={2}
            placeholder="Ask about your own record…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            className="flex-1 resize-none rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-sunken)] px-3 py-2 text-[13px] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent-line)]"
          />
          <button
            onClick={() => ask(input)}
            disabled={pending || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Ask
          </button>
        </div>
      </Card>

      {brief && (
        <Card className="p-5">
          <button
            onClick={() => setShowBrief((s) => !s)}
            className="flex w-full items-center justify-between gap-2"
          >
            <span className="label">Exactly what the model was given</span>
            <ChevronDown
              className={clsx(
                "size-4 text-[var(--color-ink-mute)] transition-transform",
                showBrief && "rotate-180",
              )}
            />
          </button>
          <p className="mt-1 text-left text-xs text-[var(--color-ink-mute)]">
            If an answer looks wrong, its input is here. Nothing else was sent.
          </p>
          {showBrief && (
            <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] p-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
              {brief}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}
