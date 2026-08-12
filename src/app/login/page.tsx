"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Lock } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        // Full navigation so the server re-renders with the session cookie.
        router.replace(next);
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Sign-in failed");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-[var(--color-accent)]">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
              <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="#000" fillOpacity={0.85} />
            </svg>
          </div>
          <div>
            <div className="display text-lg leading-none">Trading Desk</div>
            <div className="label-faint mt-1">Private</div>
          </div>
        </div>

        <form onSubmit={submit} className="card p-5">
          <label htmlFor="password" className="label mb-2 block">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] pl-9 pr-3 text-sm outline-none transition-colors focus:border-[var(--color-accent-line)]"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-[var(--color-loss-wash)] px-3 py-2 text-xs text-[var(--color-loss)]"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="mt-4 h-11 w-full rounded-lg bg-[var(--color-accent)] text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          This dashboard holds a live broker connection.
          <br />
          It reads your account and never places orders.
        </p>
      </div>
    </div>
  );
}
