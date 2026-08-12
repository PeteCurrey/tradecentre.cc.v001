"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionState, Tick } from "./hub";

/**
 * Subscribes to the live price feed.
 *
 * EventSource handles reconnection itself, so there is no backoff logic here.
 * The one thing worth doing manually is treating a browser `error` as a
 * disconnect for display purposes — EventSource will still be retrying, but the
 * user should see that the feed is not currently live rather than watching
 * stale prices they believe are current.
 */
export function useLiveStream(): {
  ticks: Map<string, Tick>;
  state: ConnectionState;
  lastUpdate: number | null;
} {
  const [ticks, setTicks] = useState<Map<string, Tick>>(new Map());
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  /**
   * Ticks are batched on a short timer rather than an animation frame.
   *
   * FX prints faster than React can usefully re-render, so batching is needed —
   * but requestAnimationFrame is PAUSED in background tabs. Using it means a
   * backgrounded dashboard silently stops updating while still showing a "live"
   * badge, which is worse than showing nothing. A timer keeps running.
   */
  const pending = useRef<Map<string, Tick>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const FLUSH_MS = 100;

    const flush = () => {
      timer.current = null;
      if (pending.current.size === 0) return;
      const batch = pending.current;
      pending.current = new Map();
      setTicks((prev) => {
        const next = new Map(prev);
        for (const [k, v] of batch) next.set(k, v);
        return next;
      });
      setLastUpdate(Date.now());
    };

    source.addEventListener("tick", (e) => {
      try {
        const tick = JSON.parse((e as MessageEvent).data) as Tick;
        pending.current.set(tick.instrument, tick);
        timer.current ??= setTimeout(flush, FLUSH_MS);
      } catch {
        /* malformed frame — ignore rather than break the stream */
      }
    });

    source.addEventListener("status", (e) => {
      try {
        const { state } = JSON.parse((e as MessageEvent).data) as {
          state: ConnectionState;
        };
        setState(state);
      } catch {
        /* ignore */
      }
    });

    source.onopen = () => setState("connecting");
    source.onerror = () => {
      // EventSource retries on its own; reflect reality in the meantime.
      setState("offline");
    };

    return () => {
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { ticks, state, lastUpdate };
}
