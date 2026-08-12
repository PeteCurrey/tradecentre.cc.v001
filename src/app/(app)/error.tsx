"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type HealthCheck = { name: string; ok: boolean; detail?: string };

/**
 * Error boundary.
 *
 * Next strips server error messages in production, leaving only a digest — so
 * showing `error.message` would just say "an error occurred". Instead this
 * calls the health endpoint and reports what is ACTUALLY broken, which is the
 * question you have when a screen dies.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setChecks(d.checks ?? []))
      .catch(() => setChecks([]));
  }, []);

  const failing = (checks ?? []).filter((c) => !c.ok);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="mb-4 flex items-center gap-2.5">
          <AlertTriangle className="size-5 text-[var(--color-loss)]" />
          <h1 className="display text-lg">This screen failed to load</h1>
        </div>

        <div className="card p-5">
          {checks === null ? (
            <p className="text-sm text-[var(--color-ink-mute)]">Checking services…</p>
          ) : failing.length > 0 ? (
            <>
              <p className="text-sm text-[var(--color-ink-dim)]">
                {failing.length === 1 ? "One service is" : `${failing.length} services are`}{" "}
                not reachable:
              </p>
              <ul className="mt-3 space-y-2">
                {failing.map((c) => (
                  <li
                    key={c.name}
                    className="rounded-lg bg-[var(--color-loss-wash)] px-3 py-2"
                  >
                    <span className="text-[13px] font-medium text-[var(--color-loss)]">
                      {c.name}
                    </span>
                    {c.detail && (
                      <span className="mt-0.5 block font-mono text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                        {c.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {failing.some((c) => c.name === "database") && (
                <p className="mt-3 rounded-lg bg-[var(--color-warn-wash)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-warn)]">
                  If this is a hosted deployment, check that DATABASE_URL uses Supabase&apos;s
                  session pooler. The direct host <code>db.&lt;ref&gt;.supabase.co</code> is
                  IPv6-only and unreachable from IPv4 platforms such as Railway.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--color-ink-dim)]">
                All services report healthy, so this is likely a bug in the page itself.
              </p>
              {error.digest && (
                <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-mute)]">
                  digest {error.digest}
                </p>
              )}
            </>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
            >
              <RefreshCw className="size-3.5" />
              Try again
            </button>
            <a
              href="/api/health"
              className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-line-strong)]"
            >
              Full health report
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
