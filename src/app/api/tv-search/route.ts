import { hasSession } from "@/lib/auth/guard";

/**
 * TradingView symbol search, proxied.
 *
 * ── Why proxy rather than call it from the browser ─────────────────────────
 * The endpoint sends no CORS headers, so a direct fetch from the page fails.
 * Going through the server also keeps the app's own origin out of a
 * third-party's logs on every keystroke.
 *
 * ── This endpoint is undocumented ──────────────────────────────────────────
 * `symbol-search.tradingview.com` is what TradingView's own site calls; it is
 * not a published API and carries no compatibility promise. It is used anyway
 * because the alternative is asking Peter to type `CME_MINI:ES1!` from memory.
 * The failure is contained: on any error this returns an empty list with
 * `available: false`, and the UI falls back to accepting a typed symbol. A
 * broken search must never mean a broken charts page.
 *
 * Results are NOT persisted. Nothing here is a source of truth — the chart is
 * rendered by TradingView from its own data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8_000;

/** Search results arrive with the matched span wrapped in `<em>`. */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

export type TvSymbol = {
  symbol: string;
  exchange: string;
  description: string;
  type: string;
  /** What the chart embed wants, e.g. "CME_MINI:ES1!". */
  full: string;
};

export async function GET(req: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const text = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (text.length < 1) return Response.json({ results: [], available: true });

  const url =
    "https://symbol-search.tradingview.com/symbol_search/?" +
    new URLSearchParams({ text, hl: "0", lang: "en", domain: "production" });

  try {
    const res = await fetch(url, {
      headers: {
        // The endpoint returns 403 to an unrecognised agent.
        "User-Agent": "Mozilla/5.0",
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = (await res.json()) as Array<{
      symbol?: string;
      exchange?: string;
      description?: string;
      type?: string;
      prefix?: string;
    }>;

    const results: TvSymbol[] = (Array.isArray(raw) ? raw : [])
      .map((r) => {
        const symbol = stripTags(r.symbol ?? "");
        // `prefix` is the routing exchange when it differs from the display
        // one — using `exchange` alone resolves to the wrong feed for some US
        // listings.
        const exchange = stripTags(r.prefix || r.exchange || "");
        return {
          symbol,
          exchange,
          description: stripTags(r.description ?? ""),
          type: r.type ?? "",
          full: exchange ? `${exchange}:${symbol}` : symbol,
        };
      })
      .filter((r) => r.symbol.length > 0)
      .slice(0, 30);

    return Response.json({ results, available: true });
  } catch {
    // Deliberately not a 500: the page stays usable by typing a symbol, and
    // saying "search is down" is more useful than an error boundary.
    return Response.json({ results: [], available: false });
  }
}
