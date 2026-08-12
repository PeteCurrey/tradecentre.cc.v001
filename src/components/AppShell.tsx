"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/nav/Sidebar";
import { TopBar } from "@/components/nav/TopBar";
import { CommandPalette } from "@/components/nav/CommandPalette";
import { useLiveStream } from "@/lib/stream/useLiveStream";
import type { ConnectionState, Tick } from "@/lib/stream/hub";
import type { Scope } from "@/lib/books";

const SCOPE_KEY = "desk.scope";

type ScopeCtx = { scope: Scope; setScope: (s: Scope) => void };
const ScopeContext = createContext<ScopeCtx | null>(null);

type LiveCtx = { ticks: Map<string, Tick>; state: ConnectionState; lastUpdate: number | null };
const LiveContext = createContext<LiveCtx>({
  ticks: new Map(),
  state: "connecting",
  lastUpdate: null,
});

/** Current account scope. Every data query in the app must be scoped by this. */
export function useScope(): ScopeCtx {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used inside AppShell");
  return ctx;
}

/** Live prices. One EventSource for the whole app, shared through context. */
export function useLive(): LiveCtx {
  return useContext(LiveContext);
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

  return (
    <ScopeContext.Provider value={{ scope, setScope }}>
      <LiveContext.Provider value={live}>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar scope={scope} onScopeChange={setScope} connection={live.state} />
            <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
          </div>
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </LiveContext.Provider>
    </ScopeContext.Provider>
  );
}
