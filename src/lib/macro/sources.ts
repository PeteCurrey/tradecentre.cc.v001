import "server-only";
import { env } from "@/lib/env";

/**
 * Macro calendar sources.
 *
 * The original plan called for Finnhub's economic calendar with Twelve Data as
 * a fallback. Verification killed both: Finnhub's calendar is tier-gated (403)
 * and Twelve Data has no calendar endpoint at all (404). What is left is what
 * actually works:
 *
 *   FRED release calendar  — US macro DATES and names (CPI, NFP, Fed)
 *   EIA                    — weekly petroleum (Wed) and natural gas (Thu)
 *   Polymarket             — market-implied probabilities, no key required
 *
 * ⚠️ The accepted gap: no consensus forecast, actual or previous figures, and
 * thin UK/EU coverage. That is a real limitation of the free sources, and the
 * screen says so rather than leaving a suspiciously empty column.
 *
 * Every fetch fails soft. A macro panel that takes the page down is worse than
 * a macro panel that says it could not reach FRED.
 */

export type MacroEvent = {
  id: string;
  source: "fred" | "eia" | "polymarket";
  time: Date;
  country: string | null;
  title: string;
  importance: number | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  impliedProbability: number | null;
  polymarketSlug: string | null;
};

export type FetchOutcome = {
  events: MacroEvent[];
  errors: string[];
};

/**
 * FRED's releases/dates endpoint is genuinely slow — it timed out repeatedly at
 * 10s during testing while every other call returned in well under a second.
 * The timeout is per-call rather than global for that reason.
 */
const TIMEOUT_MS = 30_000;

async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * FRED release dates.
 *
 * Note what this is and is not: it is the schedule of when statistical
 * releases are PUBLISHED, not the figures themselves and not a consensus. It
 * answers "is there a number due at 13:30 that will move the dollar", which is
 * the question that matters for a plan.
 */
/**
 * The releases that actually move a price, and how much.
 *
 * FRED publishes ~300 releases, most of which are academic indices no FX desk
 * has ever reacted to. An unfiltered calendar is 200 rows of noise with the
 * three that matter buried inside it, which is functionally the same as having
 * no calendar. Anything not matched here is dropped rather than shown at low
 * importance — a long list you scroll past is worse than a short one you read.
 */
const RELEASE_IMPORTANCE: Array<{ match: RegExp; importance: number }> = [
  { match: /employment situation|nonfarm|jobs report/i, importance: 3 },
  { match: /consumer price index|^cpi\b/i, importance: 3 },
  { match: /fomc|federal open market|monetary policy/i, importance: 3 },
  { match: /personal income and outlays|pce/i, importance: 3 },
  { match: /gross domestic product/i, importance: 3 },
  { match: /producer price index/i, importance: 2 },
  { match: /retail sales|advance monthly sales/i, importance: 2 },
  { match: /jobless claims|unemployment insurance/i, importance: 2 },
  { match: /industrial production/i, importance: 2 },
  { match: /consumer sentiment|consumer confidence/i, importance: 2 },
  { match: /housing starts|existing home|new residential/i, importance: 1 },
  { match: /trade balance|international trade/i, importance: 1 },
  { match: /treasury.*auction|h\.4\.1|money stock/i, importance: 1 },
];

function releaseImportance(name: string): number | null {
  for (const r of RELEASE_IMPORTANCE) {
    if (r.match.test(name)) return r.importance;
  }
  return null;
}

export async function fetchFredReleases(days = 14): Promise<FetchOutcome> {
  const key = env().FRED_API_KEY;
  if (!key) {
    return { events: [], errors: ["FRED_API_KEY not configured"] };
  }

  const start = new Date();
  const end = new Date(Date.now() + days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url =
    `https://api.stlouisfed.org/fred/releases/dates?api_key=${key}&file_type=json` +
    `&realtime_start=${fmt(start)}&realtime_end=${fmt(end)}` +
    `&include_release_dates_with_no_data=true&limit=200&sort_order=asc`;

  try {
    const data = (await getJson(url)) as {
      release_dates?: Array<{ release_id: number; release_name?: string; date: string }>;
    };

    const events: MacroEvent[] = [];
    for (const r of data.release_dates ?? []) {
      const title = r.release_name ?? `FRED release ${r.release_id}`;
      const importance = releaseImportance(title);
      if (importance === null) continue;

      events.push({
        id: `fred:${r.release_id}:${r.date}`,
        source: "fred",
        // FRED gives a date with no time. 12:30 UTC is roughly when US data
        // conventionally lands; the screen renders these as date-only so the
        // time is never mistaken for a precise release moment.
        time: new Date(`${r.date}T12:30:00Z`),
        country: "US",
        title,
        importance,
        actual: null,
        forecast: null,
        previous: null,
        impliedProbability: null,
        polymarketSlug: null,
      });
    }

    return { events, errors: [] };
  } catch (e) {
    return { events: [], errors: [`FRED: ${(e as Error).message}`] };
  }
}

/**
 * EIA inventory releases.
 *
 * Directly relevant to WTICO, BCO and NATGAS, which Peter trades. The schedule
 * is fixed by convention rather than published as a calendar endpoint, so the
 * dates are computed: petroleum on Wednesdays at 15:30 UTC, natural gas on
 * Thursdays at 14:30 UTC.
 */
export async function fetchEiaSchedule(weeks = 3): Promise<FetchOutcome> {
  const events: MacroEvent[] = [];
  const now = new Date();

  for (let d = 0; d < weeks * 7; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const dow = day.getUTCDay();

    if (dow === 3) {
      const t = new Date(day);
      t.setUTCHours(15, 30, 0, 0);
      if (t > now) {
        events.push({
          id: `eia:petroleum:${t.toISOString().slice(0, 10)}`,
          source: "eia",
          time: t,
          country: "US",
          title: "EIA Weekly Petroleum Status Report",
          importance: 2,
          actual: null,
          forecast: null,
          previous: null,
          impliedProbability: null,
          polymarketSlug: null,
        });
      }
    }

    if (dow === 4) {
      const t = new Date(day);
      t.setUTCHours(14, 30, 0, 0);
      if (t > now) {
        events.push({
          id: `eia:natgas:${t.toISOString().slice(0, 10)}`,
          source: "eia",
          time: t,
          country: "US",
          title: "EIA Natural Gas Storage Report",
          importance: 2,
          actual: null,
          forecast: null,
          previous: null,
          impliedProbability: null,
          polymarketSlug: null,
        });
      }
    }
  }

  return { events, errors: [] };
}

/**
 * Polymarket — market-implied probabilities.
 *
 * These are prices, not forecasts. A market at 0.72 means people are willing
 * to pay 72c for a dollar contingent on the event, which embeds a risk premium
 * and whatever the marginal trader believes. Useful as a sanity check against
 * your own assumption; not a probability handed down from anywhere.
 */
/**
 * Only markets that could plausibly move an FX, index or commodity book.
 *
 * Polymarket's highest-volume markets are overwhelmingly sports and esports.
 * Showing those beside a macro calendar would be noise dressed as context, so
 * the feed is keyword-filtered and the screen shows nothing rather than
 * something irrelevant when nothing matches.
 */
const MACRO_TERMS = [
  "fed", "rate", "inflation", "cpi", "recession", "gdp", "unemployment",
  "jobs", "powell", "treasury", "tariff", "oil", "opec", "gold",
  "dollar", "ecb", "boe", "election", "shutdown", "debt ceiling",
];

function isMacro(question: string): boolean {
  const q = question.toLowerCase();
  return MACRO_TERMS.some((t) => q.includes(t));
}

export async function fetchPolymarket(limit = 12): Promise<FetchOutcome> {
  // Over-fetch, then filter: the API has no macro category to ask for.
  const url =
    `https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr` +
    `&ascending=false&limit=250`;

  try {
    const data = (await getJson(url)) as Array<{
      id: string;
      slug: string;
      question: string;
      endDate?: string;
      outcomePrices?: string;
      volume24hr?: number;
    }>;

    const events: MacroEvent[] = (Array.isArray(data) ? data : [])
      .filter((m) => typeof m.question === "string" && isMacro(m.question))
      .slice(0, limit)
      .map((m) => {
        // outcomePrices arrives as a JSON-encoded string of an array.
        let yes: number | null = null;
        try {
          const prices = JSON.parse(m.outcomePrices ?? "[]") as string[];
          const n = Number(prices[0]);
          yes = Number.isFinite(n) ? n : null;
        } catch {
          yes = null;
        }

        return {
          id: `polymarket:${m.id}`,
          source: "polymarket" as const,
          time: m.endDate ? new Date(m.endDate) : new Date(),
          country: null,
          title: m.question,
          importance: null,
          actual: null,
          forecast: null,
          previous: null,
          impliedProbability: yes,
          polymarketSlug: m.slug,
        };
      })
      .filter((e) => !Number.isNaN(e.time.getTime()));

    return { events, errors: [] };
  } catch (e) {
    return { events: [], errors: [`Polymarket: ${(e as Error).message}`] };
  }
}

/**
 * FRED macro series, for volatility-regime context.
 *
 * VIX and the 10y-2y spread are the two that matter most for how to read a
 * quiet tape: a suppressed VIX with an inverting curve is a different regime
 * from a suppressed VIX with a steepening one.
 */
export type MacroSeries = {
  id: string;
  label: string;
  latest: number | null;
  previous: number | null;
  date: string | null;
  note: string;
};

const SERIES: Array<{ id: string; label: string; note: string }> = [
  { id: "VIXCLS", label: "VIX", note: "Equity implied volatility. The regime dial." },
  { id: "T10Y2Y", label: "10y − 2y", note: "Curve slope. Negative is inverted." },
  { id: "DTWEXBGS", label: "Dollar index", note: "Broad trade-weighted USD." },
  { id: "DFF", label: "Fed funds", note: "Effective overnight rate." },
];

export async function fetchFredSeries(): Promise<{
  series: MacroSeries[];
  errors: string[];
}> {
  const key = env().FRED_API_KEY;
  if (!key) return { series: [], errors: ["FRED_API_KEY not configured"] };

  const errors: string[] = [];
  const out: MacroSeries[] = [];

  for (const s of SERIES) {
    try {
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}` +
        `&api_key=${key}&file_type=json&sort_order=desc&limit=8`;
      const data = (await getJson(url)) as {
        observations?: Array<{ date: string; value: string }>;
      };

      // FRED writes "." for a missing observation — a holiday, usually. Treat
      // it as absent rather than parsing it into NaN and rendering it.
      const points = (data.observations ?? []).filter((o) => o.value !== ".");
      const latest = points[0];
      const previous = points[1];

      out.push({
        id: s.id,
        label: s.label,
        latest: latest ? Number(latest.value) : null,
        previous: previous ? Number(previous.value) : null,
        date: latest?.date ?? null,
        note: s.note,
      });
    } catch (e) {
      errors.push(`FRED ${s.id}: ${(e as Error).message}`);
      out.push({ id: s.id, label: s.label, latest: null, previous: null, date: null, note: s.note });
    }
  }

  return { series: out, errors };
}
