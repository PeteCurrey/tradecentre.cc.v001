/**
 * Resolving a headline to instruments.
 *
 * This is the piece that makes the feed a trading tool rather than a news
 * reader: it decides which instrument chips — and therefore which Chart, Watch
 * and Trade buttons — appear on an item.
 *
 * ── The governing bias: UNDER-tag ──────────────────────────────────────────
 * A missed tag costs a click. A wrong tag puts a Trade button for gold on a
 * story that has nothing to do with gold, and a Trade button that is sometimes
 * nonsense is a Trade button you stop trusting on the occasion it matters.
 *
 * So a keyword only earns a tag when it is *specifically about* that
 * instrument. Two cases are deliberately NOT tagged:
 *
 *   • "The Fed held rates" — true of every USD pair at once. Tagging it with
 *     seven pairs is not seven pieces of information, it is noise wearing a
 *     chip. It gets category `central_bank` and importance 3 instead, which is
 *     what actually changes how you read it.
 *
 *   • A single currency named in passing. "Sterling slipped" tags GBP_USD
 *     because that is the pair that expresses it; "the dollar" tags nothing,
 *     for the reason above.
 *
 * ── Word boundaries are mandatory ──────────────────────────────────────────
 * Learned the hard way on the macro calendar: a plain substring test put
 * "Pittsburgh Pirates vs Miami Marlins" on it, because "Pi-RATE-s" contains
 * "rate". Every pattern here is anchored, and the test file asserts it.
 */

/** OANDA instrument names, so a chip maps straight onto the read client. */
type Instrument = string;

type Rule = { match: RegExp; instruments: Instrument[] };

/**
 * Commodities and indices map cleanly, because a story about gold is a story
 * about gold. These carry the most tagging weight for that reason.
 */
const KEYWORD_RULES: Rule[] = [
  // ── Metals ──
  { match: /\b(?:gold|bullion|xau)\b/i, instruments: ["XAU_USD"] },
  { match: /\b(?:silver|xag)\b/i, instruments: ["XAG_USD"] },

  // ── Energy ──
  // OPEC and its output decisions move both crude benchmarks together, as does
  // anything threatening the Strait of Hormuz.
  //
  // Bare "oil" is matched deliberately. It was originally "oil prices" and the
  // live feed showed what that costs: "more oil is leaving the Middle East"
  // and a story on Hormuz shipping both went untagged, which are precisely the
  // items a commodities book needs to see. In a financial wire "oil" means
  // crude essentially always, and the word boundary already keeps "soil" and
  // "oilfield" out.
  {
    match: /\b(?:opec\+?|crude|oil|petroleum|hormuz)\b/i,
    instruments: ["WTICO_USD", "BCO_USD"],
  },
  { match: /\b(?:wti|west texas)\b/i, instruments: ["WTICO_USD"] },
  { match: /\bbrent\b/i, instruments: ["BCO_USD"] },
  { match: /\bnat(?:ural)?[ -]?gas\b/i, instruments: ["NATGAS_USD"] },

  // ── Indices ──
  { match: /\b(?:s&p ?500|s and p 500|spx)\b/i, instruments: ["SPX500_USD"] },
  { match: /\bnasdaq\b/i, instruments: ["NAS100_USD"] },
  { match: /\b(?:dow jones|the dow)\b/i, instruments: ["US30_USD"] },
  { match: /\bftse\b/i, instruments: ["UK100_GBP"] },
  { match: /\b(?:dax|german stocks)\b/i, instruments: ["DE30_EUR"] },
  { match: /\bnikkei\b/i, instruments: ["JP225_USD"] },

  // ── Currencies, only where one pair expresses the story ──
  // The central bank and its currency are the same signal for tagging: an ECB
  // story and a euro story both point at EUR_USD.
  { match: /\b(?:ecb|european central bank|eurozone|the euro)\b/i, instruments: ["EUR_USD"] },
  { match: /\b(?:boe|bank of england|sterling|the pound)\b/i, instruments: ["GBP_USD"] },
  { match: /\b(?:boj|bank of japan|the yen)\b/i, instruments: ["USD_JPY"] },
  { match: /\b(?:snb|swiss national bank|swiss franc)\b/i, instruments: ["USD_CHF"] },
  { match: /\b(?:rba|reserve bank of australia|aussie dollar)\b/i, instruments: ["AUD_USD"] },
  { match: /\b(?:boc|bank of canada|loonie)\b/i, instruments: ["USD_CAD"] },
];

/**
 * Explicitly named pairs, in the several ways a wire writes them:
 * "EUR/USD", "EURUSD", "EUR-USD". Highest confidence there is — someone typed
 * the instrument — so these run first and are never filtered out.
 */
const PAIR_RE = /\b([A-Z]{3})[\/\-]?([A-Z]{3})\b/g;

const TRADED_CURRENCIES = new Set([
  "EUR", "USD", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD",
]);

/**
 * US-listed proxies. A story tagged GLD is a story about gold, and Peter trades
 * gold at OANDA rather than the ETF — so the chip should offer the instrument
 * he can actually trade, while the raw ticker stays on the item for Alpaca.
 */
const TICKER_PROXIES: Record<string, Instrument[]> = {
  GLD: ["XAU_USD"],
  IAU: ["XAU_USD"],
  SLV: ["XAG_USD"],
  USO: ["WTICO_USD"],
  BNO: ["BCO_USD"],
  UNG: ["NATGAS_USD"],
  SPY: ["SPX500_USD"],
  IVV: ["SPX500_USD"],
  VOO: ["SPX500_USD"],
  QQQ: ["NAS100_USD"],
  DIA: ["US30_USD"],
};

/**
 * Central-bank and policy language. Drives category and importance rather than
 * instrument tags, for the reason given at the top of this file.
 */
const CENTRAL_BANK_RE =
  /\b(?:fomc|federal reserve|the fed|powell|rate (?:decision|cut|hike)|monetary policy|quantitative (?:easing|tightening))\b/i;

/** Releases that reliably move a price, mirroring the macro calendar's list. */
const HIGH_IMPACT_RE =
  /\b(?:cpi|inflation|nonfarm|payrolls|jobs report|gdp|pce|unemployment rate|retail sales|ppi)\b/i;

export type Resolution = {
  instruments: Instrument[];
  /** 1–3. Emphasis only — never ordering. */
  importance: number | null;
  isCentralBank: boolean;
};

function pairsFrom(text: string): Instrument[] {
  const out: Instrument[] = [];
  // matchAll rather than exec, so the shared regex's lastIndex can't leak
  // between calls — that bug shows up as every other headline losing its tags.
  for (const m of text.matchAll(PAIR_RE)) {
    const [, a, b] = m;
    if (a === b) continue;
    if (TRADED_CURRENCIES.has(a) && TRADED_CURRENCIES.has(b)) {
      out.push(`${a}_${b}`);
    }
  }
  return out;
}

/**
 * Resolve a feed item.
 *
 * `text` should be headline plus summary — a summary often names the
 * instrument the headline only gestures at.
 */
export function resolve(text: string, tickers: string[] = []): Resolution {
  const found = new Set<Instrument>();

  for (const p of pairsFrom(text)) found.add(p);

  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(text)) {
      for (const i of rule.instruments) found.add(i);
    }
  }

  for (const t of tickers) {
    for (const i of TICKER_PROXIES[t.toUpperCase()] ?? []) found.add(i);
  }

  const isCentralBank = CENTRAL_BANK_RE.test(text);

  let importance: number | null = null;
  if (isCentralBank || HIGH_IMPACT_RE.test(text)) importance = 3;
  else if (found.size > 0) importance = 2;

  return {
    // Sorted so the same story always renders its chips in the same order,
    // whichever provider carried it first.
    instruments: [...found].sort(),
    importance,
    isCentralBank,
  };
}
