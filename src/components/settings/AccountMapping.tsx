"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { setAccountBook } from "@/lib/settings/actions";
import { BOOKS, BOOK_IDS, type BookId } from "@/lib/books";
import { Card, CardHeader } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";

export type AccountRow = {
  id: string;
  book: string;
  environment: "live" | "practice";
  currency: string;
  alias: string | null;
  active: boolean;
  tradeCount: number;
};

export function AccountMapping({ rows }: { rows: AccountRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function assign(accountId: string, book: string) {
    setError(null);
    startTransition(async () => {
      const res = await setAccountBook(accountId, book);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChanged(true);
      router.refresh();
    });
  }

  const live = rows.filter((r) => r.environment === "live");
  const practice = rows.filter((r) => r.environment === "practice");

  return (
    <Card className="p-5">
      <CardHeader title="Accounts" />
      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        OANDA gives no indication which sub-account is meant to be which book, so the
        initial mapping was arbitrary. Set it to what you actually intend.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-[var(--color-loss-wash)] px-3 py-2 text-xs text-[var(--color-loss)]">
          {error}
        </p>
      )}

      {changed && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn-wash)] px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warn)]" />
          <p className="text-xs text-[var(--color-warn)]">
            Existing trades still carry the book they were derived with. Press{" "}
            <strong>Sync</strong> to re-derive them under the new mapping.
          </p>
        </div>
      )}

      {[
        { label: "Live", list: live },
        { label: "Practice", list: practice },
      ].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label} className="mt-4">
            <div className="label-faint mb-2 flex items-center gap-1.5">
              {label === "Practice" && (
                <FlaskConical className="size-3 text-[var(--color-warn)]" />
              )}
              {label}
            </div>
            <div className="space-y-1.5">
              {list.map((a) => (
                <div
                  key={a.id}
                  className={clsx(
                    "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5",
                    a.environment === "practice"
                      ? "border-[var(--color-warn)]/25 bg-[var(--color-warn-wash)]/30"
                      : "border-[var(--color-line)] bg-[var(--color-sunken)]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="figure text-[13px]">{a.id}</div>
                    <div className="text-[11px] text-[var(--color-ink-mute)]">
                      {a.currency}
                      {a.alias ? ` · ${a.alias}` : ""} ·{" "}
                      {a.tradeCount > 0
                        ? `${a.tradeCount} trades`
                        : "no trades yet"}
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {BOOK_IDS.map((b: BookId) => {
                      const active = a.book === b;
                      return (
                        <button
                          key={b}
                          disabled={pending}
                          onClick={() => assign(a.id, b)}
                          className={clsx(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50",
                            active
                              ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-ink)]"
                              : "border-[var(--color-line)] text-[var(--color-ink-mute)] hover:border-[var(--color-line-strong)]",
                          )}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{
                              background: active
                                ? BOOKS[b].colorVar
                                : "var(--color-line-strong)",
                            }}
                          />
                          {BOOKS[b].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
      )}
    </Card>
  );
}
