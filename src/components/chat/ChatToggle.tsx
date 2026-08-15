"use client";

import { useState, useTransition } from "react";
import { clsx } from "@/lib/clsx";
import { setChatEnabled } from "@/lib/chat/onboarding";

/**
 * The chat switch, once the wizard is done.
 *
 * Turning it off stops posting; it does not un-accept the terms or release the
 * username, so turning it back on does not re-run the wizard. Acceptance is
 * something that happened, not a setting.
 */
export function ChatToggle({
  enabled,
  username,
}: {
  enabled: boolean;
  username: string;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-3">
      {username && (
        <span className="label-faint text-[11px]">
          Posting as <span className="text-[var(--color-ink-dim)]">{username}</span>
        </span>
      )}
      <button
        role="switch"
        aria-checked={on}
        aria-label="Chat enabled"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const next = !on;
            setOn(next);
            const res = await setChatEnabled(next);
            // Put the switch back if the server refused, rather than leaving
            // the UI claiming a state the database does not have.
            if (!res.ok) setOn(!next);
          })
        }
        className={clsx(
          "relative h-6 w-11 rounded-full transition-colors disabled:opacity-50",
          // Accent = interface state. Never green: green means money here.
          on ? "bg-[var(--color-accent)]" : "bg-[var(--color-line)]",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 size-5 rounded-full bg-[var(--color-card)] transition-transform",
            on ? "translate-x-[1.375rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
