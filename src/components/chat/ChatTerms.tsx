"use client";

import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { acceptTermsAction } from "@/lib/chat/actions";

/**
 * The gate in front of posting.
 *
 * ── Read without accepting, post only after ───────────────────────────────
 * Reading is passive; posting is publishing to other people, and that is the
 * act the terms are about. Blocking reading too would only teach people to
 * click through without looking.
 *
 * ⚠️ The wording below is a PLACEHOLDER and is not legal advice. Peter is
 * having proper terms drafted; the mechanism — versioned, dated, recorded per
 * user — is what is built here. Change CHAT_TERMS_VERSION when the wording
 * changes and everyone is asked again.
 */
export function ChatTerms({ version }: { version: string }) {
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-[var(--color-warn-line,var(--color-line))] bg-[var(--color-sunken)] p-5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-[var(--color-warn)]" />
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          Before you post
        </h2>
      </div>

      <div className="mt-3 space-y-2 text-xs leading-relaxed text-[var(--color-ink-mute)]">
        <p>
          Anything said in these rooms is the personal opinion of the member who
          wrote it. It is <strong>not financial advice</strong>, not a
          recommendation, and not a solicitation to trade. No one here is acting
          as your adviser.
        </p>
        <p>
          Trading carries risk and you can lose more than you deposit. Every
          decision you take is yours alone, whatever you read here.
        </p>
        <p>
          Messages are kept permanently and can be reviewed or removed by a
          moderator. Do not post anyone&apos;s personal information, and do not
          post material you have no right to share.
        </p>
        <p className="text-[var(--color-ink-faint)]">Terms version {version}</p>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-xs text-[var(--color-ink-dim)]">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-accent)]"
        />
        <span>I have read and accept these terms.</span>
      </label>

      <button
        disabled={!checked || pending}
        onClick={() =>
          start(async () => {
            const res = await acceptTermsAction();
            if (!res.ok) setError(res.error ?? "Could not record acceptance");
          })
        }
        className="mt-4 h-10 rounded-lg bg-[var(--color-accent)] px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Saving…" : "Accept and enable chat"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </div>
  );
}
