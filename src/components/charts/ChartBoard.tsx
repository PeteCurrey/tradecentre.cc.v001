"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { TvSymbol } from "@/app/api/tv-search/route";

/**
 * Charts — TradingView, searchable.
 *
 * ── Why an iframe and not TradingView's loader script ──────────────────────
 * The documented embed injects `tv.js`, which runs THIRD-PARTY JAVASCRIPT IN
 * THIS ORIGIN. This app holds a live broker connection and a session cookie,
 * so that is not a trade worth making for a chart. `s.tradingview.com/
 * widgetembed/` is the same widget, addressed directly, and everything it does
 * happens inside the iframe's own origin where it can reach neither our DOM
 * nor our cookies. The script is only a convenience wrapper around this URL.
 *
 * ── VWAP is requested, but it does not solve the indices/gold case ────────
 * The study is enabled because it costs nothing and is correct wherever the
 * venue reports volume — US equities, for one. It will NOT produce a real
 * VWAP on the OANDA index and metal CFDs in the presets, because those feeds
 * carry no traded volume, and the CME futures that do are not available to the
 * free widget. Nothing here fabricates a line: where volume is absent the
 * study simply has nothing to draw, which is the honest outcome.
 */

/**
 * Openers, not a fixed universe — search reaches anything TradingView has.
 *
 * These mirror the OANDA books actually traded here, and each one was checked
 * against the embed rather than assumed.
 *
 * ⚠️ The CME futures — `CME_MINI:ES1!`, `COMEX:GC1!` — were the obvious choice
 * and DO NOT WORK: the free widget answers "this symbol is only available on
 * TradingView" and renders nothing. They need a paid TradingView plan. That
 * also means this screen cannot show real-volume VWAP on indices or gold,
 * because the venues that have the volume are exactly the paywalled ones.
 * See docs/PLAN.md before promising VWAP here.
 */
const PRESETS: Array<{ full: string; label: string }> = [
  { full: "OANDA:SPX500USD", label: "S&P 500" },
  { full: "OANDA:NAS100USD", label: "Nasdaq 100" },
  { full: "OANDA:US30USD", label: "Dow 30" },
  { full: "OANDA:XAUUSD", label: "Gold" },
  { full: "OANDA:EURUSD", label: "EUR/USD" },
  { full: "OANDA:GBPUSD", label: "GBP/USD" },
];

const INTERVALS = [
  { id: "5", label: "5m" },
  { id: "15", label: "15m" },
  { id: "60", label: "1H" },
  { id: "240", label: "4H" },
  { id: "D", label: "1D" },
];

function embedUrl(symbol: string, interval: string): string {
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: "dark",
    style: "1",
    locale: "en",
    timezone: "Europe/London",
    withdateranges: "1",
    allow_symbol_change: "0",
    save_image: "0",
    hide_side_toolbar: "0",
  });
  // Session VWAP plus volume. Encoded as a JSON array, which is the form the
  // embed expects for multiple studies.
  params.set("studies", JSON.stringify(["STD;VWAP", "Volume@tv-basicstudies"]));
  return `https://s.tradingview.com/widgetembed/?${params}`;
}

export function ChartBoard({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [interval, setInterval] = useState("60");

  const [q, setQ] = useState("");
  const [results, setResults] = useState<TvSymbol[]>([]);
  const [searchOk, setSearchOk] = useState(true);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /* Debounced so a fast typist does not fire a request per keystroke. */
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tv-search?q=${encodeURIComponent(text)}`);
        const body = await res.json();
        setResults(body.results ?? []);
        setSearchOk(body.available !== false);
      } catch {
        setResults([]);
        setSearchOk(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  /* Click-away closes the results list. */
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const choose = useCallback((full: string) => {
    setSymbol(full);
    setOpen(false);
    setQ("");
    // Keep the URL in step so a chart can be linked, bookmarked and survive a
    // reload. replaceState rather than a router push: re-rendering the page
    // would tear down and rebuild the iframe on every symbol change.
    const url = new URL(window.location.href);
    url.searchParams.set("symbol", full);
    window.history.replaceState(null, "", url);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div ref={boxRef} className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              // Enter with no selection takes the typed text as a symbol, so
              // the page still works when search is unavailable.
              if (e.key === "Enter" && q.trim()) {
                choose(results[0]?.full ?? q.trim().toUpperCase());
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search any TradingView symbol — ES, gold, AAPL, EURUSD…"
            className="h-10 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] pl-9 pr-8 text-sm outline-none transition-colors focus:border-[var(--color-accent-line)]"
          />
          {q && (
            <button
              onClick={() => {
                setQ("");
                setResults([]);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}

          {open && (results.length > 0 || (!searchOk && q.trim().length >= 2)) && (
            <div className="absolute left-0 right-0 top-11 z-20 max-h-80 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 shadow-xl">
              {!searchOk && (
                <p className="px-3 py-2 text-xs text-[var(--color-warn)]">
                  Symbol search is unavailable. Press Enter to use what you typed as a
                  symbol, e.g. <span className="font-mono">CME_MINI:ES1!</span>
                </p>
              )}
              {results.map((r) => (
                <button
                  key={r.full}
                  onClick={() => choose(r.full)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-accent-wash)]"
                >
                  <span className="w-28 shrink-0 truncate font-mono text-xs font-semibold text-[var(--color-ink)]">
                    {r.symbol}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-mute)]">
                    {r.description}
                  </span>
                  <span className="label-faint shrink-0 text-[10px]">{r.exchange}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {INTERVALS.map((i) => (
            <button
              key={i.id}
              onClick={() => setInterval(i.id)}
              className={clsx(
                "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                // Accent = interface state, exactly as everywhere else.
                interval === i.id
                  ? "bg-[var(--color-accent)] text-black"
                  : "text-[var(--color-ink-mute)] hover:bg-[var(--color-accent-wash)]",
              )}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.full}
            onClick={() => choose(p.full)}
            className={clsx(
              "rounded border px-2 py-1 text-[11px] font-semibold tracking-wide transition-colors",
              symbol === p.full
                ? "border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] text-[var(--color-ink)]"
                : "border-[var(--color-line)] bg-[var(--color-card)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent-line)]",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/*
        Keyed on symbol AND interval so a change remounts the iframe. The embed
        reads both from its URL at load and does not react to them changing, so
        without the key the chart would silently keep showing the old market.
      */}
      {/* Explicit height, not flex-1: the scroll container this renders into
          is a plain block, so a flex child has no height to fill and the chart
          collapses to nothing. */}
      <div className="h-[calc(100dvh-17rem)] min-h-[26rem] overflow-hidden rounded-xl border border-[var(--color-line)]">
        <iframe
          key={`${symbol}:${interval}`}
          src={embedUrl(symbol, interval)}
          title={`TradingView chart — ${symbol}`}
          className="size-full"
          /*
           * `allow-same-origin` here means the frame keeps ITS OWN origin
           * (tradingview.com) rather than being forced into an opaque one — it
           * grants nothing over this app. Cross-origin isolation is the
           * browser's job and holds regardless. Omitting it breaks the widget
           * outright, because an opaque origin cannot touch storage.
           */
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
