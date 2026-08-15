"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { initials } from "@/lib/identity/profile";

/**
 * A room.
 *
 * ── Polling, and why the transport is not the price hub ───────────────────
 * lib/stream's SSE hub lives and dies with the OANDA price socket, so it is
 * down at weekends — exactly when there is time to talk. Chat polls instead,
 * incrementally: only messages newer than the newest one held are requested,
 * so a history that never gets shorter does not make the poll heavier.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 * Green and red mean money in this app and nothing else, so no message, name
 * or state uses them. Own messages are marked with the accent, which is the
 * interface-state colour everywhere else.
 */

const POLL_MS = 5_000;
const MAX_LENGTH = 2000;

export type Message = {
  id: number;
  userId: number;
  author: string;
  jobTitle: string | null;
  avatar: string | null;
  body: string;
  createdAt: string;
  deleted: boolean;
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function ChatRoom({
  room,
  initialMessages,
  me,
  canPost,
}: {
  room: string;
  initialMessages: Message[];
  me: number;
  canPost: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  /**
   * Only autoscroll when already at the bottom. Yanking someone back down
   * while they are reading history is the single most irritating thing a chat
   * can do.
   */
  const pinned = useRef(true);

  const newestId = messages.length ? messages[messages.length - 1].id : 0;

  const scrollToEnd = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToEnd();
    // Only on room change — later scrolling is governed by `pinned`.
  }, [room, scrollToEnd]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(
          `/api/chat/messages?room=${encodeURIComponent(room)}&after=${newestId}`,
        );
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled || !body.messages?.length) return;

        setMessages((prev) => {
          // The poll can race a just-sent message that is already in state.
          const seen = new Set(prev.map((m) => m.id));
          const fresh = body.messages.filter((m: Message) => !seen.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        if (pinned.current) requestAnimationFrame(scrollToEnd);
      } catch {
        // A dropped poll is not worth surfacing; the next one is 5s away.
      }
    }

    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [room, newestId, scrollToEnd]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, body }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Could not send");
        return;
      }
      setDraft("");
      setMessages((prev) =>
        prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message],
      );
      pinned.current = true;
      requestAnimationFrame(scrollToEnd);
    } catch {
      setError("Could not reach the server");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[24rem] flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1"
      >
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
            Nothing here yet.
          </p>
        )}

        {messages.map((m, i) => {
          const mine = m.userId === me;
          // Collapse the name when the same person speaks twice running.
          const runOn = i > 0 && messages[i - 1].userId === m.userId;
          return (
            <div
              key={m.id}
              className={clsx("flex gap-2.5 px-1 py-0.5", runOn ? "" : "mt-3")}
            >
              {/* The avatar column is always present, empty on a run-on, so
                  consecutive messages from one person stay left-aligned with
                  the first rather than stepping in and out. */}
              <div className="w-7 shrink-0">
                {!runOn &&
                  (m.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.avatar}
                      alt=""
                      className="size-7 rounded-full border border-[var(--color-line)] object-cover"
                    />
                  ) : (
                    <div className="grid size-7 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-sunken)] text-[10px] font-semibold text-[var(--color-ink-mute)]">
                      {initials(m.author)}
                    </div>
                  ))}
              </div>

              <div className="min-w-0 flex-1">
                {!runOn && (
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={clsx(
                        "text-xs font-semibold",
                        mine ? "text-[var(--color-accent)]" : "text-[var(--color-ink)]",
                      )}
                    >
                      {m.author}
                    </span>
                    {m.jobTitle && (
                      <span className="text-[10px] text-[var(--color-ink-faint)]">
                        {m.jobTitle}
                      </span>
                    )}
                    <span className="tabular-nums text-[10px] text-[var(--color-ink-faint)]">
                      {time(m.createdAt)}
                    </span>
                  </div>
                )}
                {m.deleted ? (
                  <p className="text-[13px] italic text-[var(--color-ink-faint)]">
                    Message removed
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-[var(--color-ink-dim)]">
                    {m.body}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canPost ? (
        <form onSubmit={send} className="mt-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line.
              if (e.key === "Enter" && !e.shiftKey) send(e as unknown as React.FormEvent);
            }}
            rows={1}
            placeholder={`Message ${room}`}
            className="max-h-32 min-h-[2.75rem] flex-1 resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--color-accent-line)]"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="size-4" />
          </button>
        </form>
      ) : (
        <p className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2.5 text-xs text-[var(--color-ink-mute)]">
          Chat is switched off for your account. Turn it on to post.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </div>
  );
}
