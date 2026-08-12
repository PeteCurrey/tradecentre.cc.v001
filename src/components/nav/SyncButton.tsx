"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { syncNow } from "@/lib/trades/sync-action";
import { clsx } from "@/lib/clsx";

/**
 * Pull the ledger and rebuild trades on demand.
 *
 * Manual by design — see the note in sync-action.ts. The result is reported
 * concretely (how many new transactions, how long) rather than as a silent
 * spinner, because "did that actually do anything?" is the question you want
 * answered after pressing it.
 */
export function SyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function run() {
    setResult(null);
    setFailed(false);
    startTransition(async () => {
      const res = await syncNow();
      if (!res.ok) {
        setFailed(true);
        setResult(res.error);
        return;
      }
      const parts = [
        res.newTransactions > 0
          ? `${res.newTransactions} new`
          : "up to date",
        `${res.totalTrades} trades`,
        `${res.seconds}s`,
      ];
      if (res.errors.length > 0) {
        setFailed(true);
        parts.push(`${res.errors.length} error${res.errors.length === 1 ? "" : "s"}`);
      }
      setResult(parts.join(" · "));
      router.refresh();
      // Clear after a beat so the bar doesn't accumulate stale status text.
      setTimeout(() => setResult(null), 6000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          className={clsx(
            "hidden text-[11px] lg:inline",
            failed ? "text-[var(--color-loss)]" : "text-[var(--color-ink-mute)]",
          )}
        >
          {result}
        </span>
      )}
      <button
        onClick={run}
        disabled={pending}
        title="Pull the OANDA ledger and rebuild trades"
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
          pending
            ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-accent)]"
            : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]",
        )}
      >
        {failed && !pending ? (
          <AlertTriangle className="size-3.5 text-[var(--color-loss)]" />
        ) : result && !pending ? (
          <Check className="size-3.5 text-[var(--color-accent)]" />
        ) : (
          <RefreshCw className={clsx("size-3.5", pending && "animate-spin")} />
        )}
        <span className="hidden sm:inline">{pending ? "Syncing" : "Sync"}</span>
      </button>
    </div>
  );
}
