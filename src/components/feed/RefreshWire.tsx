"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { refreshWire } from "@/lib/feed/actions";

/**
 * Manual refresh.
 *
 * Slow on purpose — SEC's index is four throttled requests and takes ~10s — so
 * the pending state has to be honest rather than optimistic. This is also the
 * only place provider errors surface, since the background refresh has nobody
 * to tell.
 */
export function RefreshWire() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function go() {
    setNote(null);
    startTransition(async () => {
      const res = await refreshWire();
      setNote(
        res.ok
          ? `${res.written} items${res.pruned ? `, ${res.pruned} pruned` : ""}` +
              (res.errors.length ? ` · ${res.errors.join("; ")}` : "")
          : res.error,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      {note && (
        <span className="max-w-md truncate text-xs text-[var(--color-ink-mute)]" title={note}>
          {note}
        </span>
      )}
      <button
        onClick={go}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Refresh
      </button>
    </div>
  );
}
