"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionState,
  DeskPush,
  EngineEvent,
  ScanPush,
  Tick,
} from "./events";

/**
 * Subscribes to the live feed.
 *
 * EventSource handles reconnection itself, so there is no backoff logic here.
 * The one thing worth doing manually is treating a browser `error` as a
 * disconnect for display purposes — EventSource will still be retrying, but the
 * user should see that the feed is not currently live rather than watching
 * stale prices they believe are current.
 *
 * Four channels arrive on one connection:
 *   tick   — prices, batched (see below)
 *   desk   — the broker's own P&L and positions, every few seconds
 *   scan   — what the engine evaluated on its last pass
 *   engine — discrete moments: a fill, a rejection, a stop moved
 */

export type LiveFeed = {
  ticks: Map<string, Tick>;
  state: ConnectionState;
  lastUpdate: number | null;
  desk: DeskPush | null;
  scan: ScanPush | null;
  /** Most recent engine events, newest first. Bounded — see EVENT_BUFFER. */
  events: EngineEvent[];
  dismissEvent: (at: number) => void;
};

/**
 * Engine events are moments, not history. The order log is where they persist;
 * this buffer exists only so a toast that appears while you are looking at
 * another tab is still there when you come back.
 */
const EVENT_BUFFER = 20;

export function useLiveStream(): LiveFeed {
  const [ticks, setTicks] = useState<Map<string, Tick>>(new Map());
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [desk, setDesk] = useState<DeskPush | null>(null);
  const [scan, setScan] = useState<ScanPush | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);

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

  const dismissEvent = useCallback((at: number) => {
    setEvents((prev) => prev.filter((e) => e.at !== at));
  }, []);

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

    /**
     * Desk pushes replace wholesale rather than merging.
     *
     * Merging would let a position that has just been closed linger on screen
     * because no push explicitly removed it. The server always sends the
     * complete picture, so the complete picture is what gets stored.
     */
    source.addEventListener("desk", (e) => {
      try {
        setDesk(JSON.parse((e as MessageEvent).data) as DeskPush);
      } catch {
        /* ignore */
      }
    });

    source.addEventListener("scan", (e) => {
      try {
        setScan(JSON.parse((e as MessageEvent).data) as ScanPush);
      } catch {
        /* ignore */
      }
    });

    source.addEventListener("engine", (e) => {
      try {
        const event = JSON.parse((e as MessageEvent).data) as EngineEvent;
        setEvents((prev) => [event, ...prev].slice(0, EVENT_BUFFER));
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

  return { ticks, state, lastUpdate, desk, scan, events, dismissEvent };
}
