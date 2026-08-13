"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether the viewer has asked for reduced motion.
 *
 * `useSyncExternalStore` rather than useState+useEffect: matchMedia is exactly
 * the external store this hook is designed for, it gives a correct value on the
 * first render instead of flashing the wrong one, and it responds if the
 * preference is changed while the page is open.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    // Server render: assume motion is fine, since the client corrects on hydrate
    // and assuming otherwise would ship a static first paint to everyone.
    () => false,
  );
}

/**
 * A clock that ticks, for anything whose display depends on "now".
 *
 * `Date.now()` called during render is impure — two renders in the same commit
 * can disagree. Quantising the snapshot to the tick interval makes it stable
 * between ticks, which is what lets this be read during render safely.
 *
 * Returns 0 during server rendering; callers must treat that as "unknown"
 * rather than as the epoch.
 */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (onChange) => {
      const t = setInterval(onChange, intervalMs);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}

/**
 * A boolean persisted in localStorage.
 *
 * Backed by an external store rather than useState+useEffect so the first
 * client render already has the stored value — the effect version renders the
 * default, then corrects, which shows as a visible flicker on every navigation.
 */
export function usePersistedFlag(
  key: string,
): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeStorage,
    () => readFlag(key),
    () => false,
  );

  const set = (next: boolean) => {
    try {
      localStorage.setItem(key, next ? "on" : "off");
    } catch {
      /* storage unavailable — the value simply won't persist */
    }
    // localStorage fires `storage` only in OTHER tabs, so this tab is notified
    // explicitly. Without it the toggle would appear not to respond.
    for (const fn of storageListeners) fn();
  };

  return [value, set];
}

const storageListeners = new Set<() => void>();

function subscribeStorage(onChange: () => void): () => void {
  storageListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    storageListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "on";
  } catch {
    return false;
  }
}

/**
 * Eases a number toward its target on every frame.
 *
 * Why not a CSS transition: the values here change far faster than a transition
 * can complete. A 600ms ease restarted every 100ms never arrives anywhere — it
 * crawls, permanently lagging, and the lag grows with volatility, which is
 * exactly when the number matters most. An exponential follow has no fixed
 * duration: it always heads for the CURRENT target, so a fast market makes it
 * move faster rather than falling further behind.
 *
 * requestAnimationFrame is correct here even though it pauses in background
 * tabs — this drives presentation only. The underlying value stays exact (it
 * comes from the tick stream, which uses a timer for precisely that reason), so
 * a backgrounded tab resumes by snapping to the truth rather than showing a
 * stale figure it believes is current.
 */
export function useAnimatedValue(target: number, opts: { stiffness?: number } = {}): number {
  const stiffness = opts.stiffness ?? 0.18;
  const reduced = useReducedMotion();

  const [display, setDisplay] = useState(target);
  const current = useRef(target);
  const targetRef = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // Updating the ref inside the effect, not during render: a ref written
    // during render is not a stable value for concurrent React to reason about.
    targetRef.current = target;

    if (reduced) return;
    // A loop is already chasing the target; it will pick the new one up on its
    // next frame. Starting a second would double the step size.
    if (frame.current !== null) return;

    const step = () => {
      const goal = targetRef.current;
      const delta = goal - current.current;

      // Close enough that further frames would render identically. Snapping
      // exactly onto the target matters: an asymptote that never lands leaves
      // the last decimal place flickering forever.
      if (Math.abs(delta) < Math.abs(goal) * 1e-5 || Math.abs(delta) < 1e-9) {
        current.current = goal;
        setDisplay(goal);
        frame.current = null;
        return;
      }

      current.current += delta * stiffness;
      setDisplay(current.current);
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
  }, [target, reduced, stiffness]);

  // Cancel only on unmount. Cancelling whenever `target` changes would abort
  // the loop mid-flight on every tick and leave the value permanently short.
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return reduced ? target : display;
}

export type Direction = "up" | "down" | null;

/**
 * Which way a value last moved, cleared after `holdMs`.
 *
 * Drives the money flash. Returns null between changes so the caller can drop
 * the animation class and let it re-trigger on the next move — an animation
 * class that is never removed only ever plays once.
 */
export function useChangeDirection(value: number, holdMs = 600): Direction {
  const [dir, setDir] = useState<Direction>(null);
  const previous = useRef(value);

  useEffect(() => {
    const prev = previous.current;
    previous.current = value;
    if (value === prev) return;

    // Scheduled rather than set synchronously: this is a presentational pulse
    // reacting to a value that already rendered, not state the render depends on.
    const show = setTimeout(() => setDir(value > prev ? "up" : "down"), 0);
    const clear = setTimeout(() => setDir(null), holdMs);
    return () => {
      clearTimeout(show);
      clearTimeout(clear);
    };
  }, [value, holdMs]);

  return dir;
}
