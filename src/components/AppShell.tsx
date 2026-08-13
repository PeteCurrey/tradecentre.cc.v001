"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/nav/Sidebar";
import { TopBar } from "@/components/nav/TopBar";
import { CommandPalette } from "@/components/nav/CommandPalette";
import { EngineToasts } from "@/components/execution/EngineToasts";
import { useLiveStream, type LiveFeed } from "@/lib/stream/useLiveStream";
import { clsx } from "@/lib/clsx";
import type { Scope } from "@/lib/books";

const SCOPE_KEY = "desk.scope";

type ScopeCtx = { scope: Scope; setScope: (s: Scope) => void };
const ScopeContext = createContext<ScopeCtx | null>(null);

const LiveContext = createContext<LiveFeed>({
  ticks: new Map(),
  state: "connecting",
  lastUpdate: null,
  desk: null,
  scan: null,
  events: [],
  dismissEvent: () => {},
});

/**
 * How armed the desk is, as one value.
 *
 * `live` outranks `armed` because the two situations are not variations of one
 * state — one computes orders and throws them away, the other sends real ones.
 * They get different colours everywhere, so they are resolved once here rather
 * than being re-derived (and eventually re-derived differently) per component.
 */
export type ArmLevel = "off" | "armed" | "live" | "halted";

const ArmContext = createContext<ArmLevel>("off");

/** Current account scope. Every data query in the app must be scoped by this. */
export function useScope(): ScopeCtx {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used inside AppShell");
  return ctx;
}

/** The live feed. One EventSource for the whole app, shared through context. */
export function useLive(): LiveFeed {
  return useContext(LiveContext);
}

/** Engine arm level, available on every page. */
export function useArmLevel(): ArmLevel {
  return useContext(ArmContext);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>("all-live");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const live = useLiveStream();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SCOPE_KEY) as Scope | null;
      if (saved) setScopeState(saved);
    } catch {
      /* storage unavailable — default scope is fine */
    }
  }, []);

  function setScope(s: Scope) {
    setScopeState(s);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Resolved from the desk push rather than kept in local state, so the shell
   * cannot claim the engine is off while the server is arming, or on after a
   * kill switch pressed in another tab. The server's view is the only view.
   */
  const armLevel: ArmLevel = useMemo(() => {
    const books = live.desk?.books ?? [];
    if (books.some((b) => b.armState === "armed" && !b.dryRun)) return "live";
    if (books.some((b) => b.armState === "armed")) return "armed";
    if (books.some((b) => b.armState === "halted")) return "halted";
    return "off";
  }, [live.desk]);

  return (
    <ScopeContext.Provider value={{ scope, setScope }}>
      <LiveContext.Provider value={live}>
        <ArmContext.Provider value={armLevel}>
          <div
            className={clsx(
              "flex h-dvh overflow-hidden",
              // The armed rail. Present on every page so you can never be deep
              // in the trade log and forget the engine is running.
              armLevel !== "off" && "desk-armed",
              armLevel === "live" && "desk-armed-live",
              armLevel === "halted" && "desk-halted",
            )}
          >
            <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar scope={scope} onScopeChange={setScope} connection={live.state} />
              <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
            </div>
          </div>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <EngineToasts events={live.events} onDismiss={live.dismissEvent} />
        </ArmContext.Provider>
      </LiveContext.Provider>
    </ScopeContext.Provider>
  );
}
