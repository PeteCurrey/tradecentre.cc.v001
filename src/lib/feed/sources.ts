import "server-only";
import { env } from "@/lib/env";
import { resolve } from "./resolve";

/**
 * Feed sources.
 *
 * Four providers, following the discipline already set by the macro calendar:
 * every fetch fails SOFT and INDEPENDENTLY. One dead provider degrades one
 * source and says so; it never takes the screen down. A feed that 500s because
 * Polygon is having a morning is worse than a feed missing Polygon.
 *
 * Two are free at source and need no key:
 *   Federal Reserve — press releases, FOMC statements, speeches (RSS)
 *   SEC EDGAR       — real-time filings index (Atom). Requires a descriptive
 *                     User-Agent or it returns 403.
 *
 * Two use keys already present in env.ts and, until now, unused for news:
 *   Polygon         — /v2/reference/news, ticker-tagged
 *   Finnhub         — /news?category=general
 *
 * ⚠️ Nothing here invents an item. If a provider returns nothing, the source
 * contributes nothing and the error is surfaced — there is no placeholder
 * headline anywhere in this file.
 */

export type FeedSource = "polygon" | "finnhub" | "fed" | "sec";
export type FeedCategory = "news" | "central_bank" | "economic" | "filing";

export type FeedItem = {
  id: string;
  source: FeedSource | "macro";
  category: FeedCategory;
  publishedAt: Date;
  headline: string;
  summary: string | null;
  url: string | null;
  tickers: string[];
  instruments: string[];
  importance: number | null;
};

export type FetchOutcome = {
  items: FeedItem[];
  errors: string[];
};

const TIMEOUT_MS = 15_000;

/**
 * SEC requires a User-Agent identifying the requester, and blocks generic ones.
 * Sending it on every request costs nothing and keeps the policy in one place.
 */
const UA = "TraderDesk/1.0 (personal trading dashboard; contact via app owner)";

async function getText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": UA, ...headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* -------------------------------------------------------------------------- */
/* Minimal RSS / Atom reading                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A deliberately small feed reader rather than a new dependency.
 *
 * This handles exactly what the two feeds we consume emit — <item> for RSS,
 * <entry> for Atom — and nothing more. It is not a general XML parser and
 * should not grow into one; if a third feed needs something richer, that is the
 * moment to take the dependency rather than to extend this.
 */
type RawEntry = { title: string; link: string; summary: string; date: string };

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Ampersand last, or "&amp;lt;" decodes to "<" in two passes.
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Strip markup left inside a description.
 *
 * Decode BEFORE stripping, and the order is not cosmetic: RSS descriptions
 * usually carry their HTML *escaped*, so `&lt;p&gt;` only becomes a strippable
 * `<p>` once decoded. Stripping first leaves the tags sitting in the summary as
 * literal text.
 */
function stripTags(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

export function parseFeed(xml: string): RawEntry[] {
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const out: RawEntry[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    if (!title) continue;

    // Atom puts the URL in an attribute; RSS puts it in the element body.
    const linkEl = tag(b, "link");
    const linkAttr = b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const link = linkAttr ?? linkEl ?? "";

    out.push({
      title: decodeEntities(title),
      link: decodeEntities(link),
      summary: stripTags(tag(b, "description") ?? tag(b, "summary") ?? ""),
      date: decodeEntities(
        tag(b, "pubDate") ?? tag(b, "updated") ?? tag(b, "published") ?? "",
      ),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Polygon — market news                                                       */
/* -------------------------------------------------------------------------- */

export async function fetchPolygonNews(limit = 50): Promise<FetchOutcome> {
  const key = env().POLYGON_API_KEY;
  if (!key) return { items: [], errors: ["POLYGON_API_KEY not configured"] };

  const url =
    `https://api.polygon.io/v2/reference/news?limit=${limit}` +
    `&order=desc&sort=published_utc&apiKey=${key}`;

  try {
    const data = (await getJson(url)) as {
      results?: Array<{
        id: string;
        title: string;
        description?: string;
        article_url?: string;
        published_utc: string;
        tickers?: string[];
      }>;
    };

    const items: FeedItem[] = [];
    for (const r of data.results ?? []) {
      const publishedAt = new Date(r.published_utc);
      if (Number.isNaN(publishedAt.getTime())) continue;

      const tickers = r.tickers ?? [];
      const res = resolve(`${r.title} ${r.description ?? ""}`, tickers);

      items.push({
        id: `polygon:${r.id}`,
        source: "polygon",
        category: res.isCentralBank ? "central_bank" : "news",
        publishedAt,
        headline: r.title,
        summary: r.description ?? null,
        url: r.article_url ?? null,
        tickers,
        instruments: res.instruments,
        importance: res.importance,
      });
    }
    return { items, errors: [] };
  } catch (e) {
    return { items: [], errors: [`Polygon: ${(e as Error).message}`] };
  }
}

/* -------------------------------------------------------------------------- */
/* Finnhub — market news                                                       */
/* -------------------------------------------------------------------------- */

export async function fetchFinnhubNews(): Promise<FetchOutcome> {
  const key = env().FINNHUB_API_KEY;
  if (!key) return { items: [], errors: ["FINNHUB_API_KEY not configured"] };

  const url = `https://finnhub.io/api/v1/news?category=general&token=${key}`;

  try {
    const data = (await getJson(url)) as Array<{
      id: number;
      headline: string;
      summary?: string;
      url?: string;
      datetime: number;
      related?: string;
    }>;

    const items: FeedItem[] = [];
    for (const r of Array.isArray(data) ? data : []) {
      if (!r.headline) continue;
      // Finnhub sends seconds, not milliseconds.
      const publishedAt = new Date(r.datetime * 1000);
      if (Number.isNaN(publishedAt.getTime())) continue;

      // `related` is a comma-separated symbol string, often empty.
      const tickers = (r.related ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const res = resolve(`${r.headline} ${r.summary ?? ""}`, tickers);

      items.push({
        id: `finnhub:${r.id}`,
        source: "finnhub",
        category: res.isCentralBank ? "central_bank" : "news",
        publishedAt,
        headline: r.headline,
        summary: r.summary ?? null,
        url: r.url ?? null,
        tickers,
        instruments: res.instruments,
        importance: res.importance,
      });
    }
    return { items, errors: [] };
  } catch (e) {
    return { items: [], errors: [`Finnhub: ${(e as Error).message}`] };
  }
}

/* -------------------------------------------------------------------------- */
/* Federal Reserve — press releases, FOMC, speeches                            */
/* -------------------------------------------------------------------------- */

/**
 * Free, no key, and the primary source rather than someone's report of it —
 * which matters, because the wire's summary of an FOMC statement is a
 * paraphrase and the statement itself is the thing that moved the price.
 */
const FED_FEED = "https://www.federalreserve.gov/feeds/press_all.xml";

/**
 * Most of what the Fed publishes is not monetary policy.
 *
 * Verified against the live feed: of the twenty most recent items, the top four
 * were an enforcement action against a former bank employee and three approvals
 * of bank holding-company applications. Marking everything the Fed posts as
 * top importance would put those above CPI, which is exactly the kind of
 * mislabelling that trains you to ignore the emphasis altogether.
 *
 * So supervisory and administrative business is demoted rather than dropped —
 * it is still genuinely Fed news, it just is not going to move a price.
 */
const FED_ROUTINE_RE =
  /\b(?:enforcement action|application by|announces approval|personnel|appoint(?:s|ed|ment)|conference|reserve bank (?:president|board of directors)|annual report|fee schedule)\b/i;

const FED_POLICY_RE =
  /\b(?:fomc|monetary policy|federal funds|interest rate|balance sheet|beige book|economic projections|testimony|speech)\b/i;

export function fedImportance(text: string): number {
  if (FED_POLICY_RE.test(text)) return 3;
  if (FED_ROUTINE_RE.test(text)) return 1;
  return 2;
}

export async function fetchFedReleases(): Promise<FetchOutcome> {
  try {
    const xml = await getText(FED_FEED);
    const items: FeedItem[] = [];

    for (const e of parseFeed(xml)) {
      const publishedAt = new Date(e.date);
      if (Number.isNaN(publishedAt.getTime())) continue;

      const text = `${e.title} ${e.summary}`;
      const res = resolve(text);

      items.push({
        // The URL is the stable identity here; the feed carries no guid we can
        // rely on across refreshes.
        id: `fed:${e.link || e.title}`,
        source: "fed",
        category: "central_bank",
        publishedAt,
        headline: e.title,
        summary: e.summary || null,
        url: e.link || null,
        tickers: [],
        instruments: res.instruments,
        importance: fedImportance(text),
      });
    }
    return { items, errors: [] };
  } catch (e) {
    return { items: [], errors: [`Federal Reserve: ${(e as Error).message}`] };
  }
}

/* -------------------------------------------------------------------------- */
/* SEC EDGAR — real-time filings                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which forms are worth a line in a feed.
 *
 * EDGAR's current-filings index is a firehose — most of it is routine and
 * would bury the three filings a day that mean something. These four are the
 * ones that carry news:
 *
 *   8-K  — a material event the company is obliged to disclose promptly
 *   S-1  — an IPO registration
 *   4    — insider buying and selling
 *   13D  — an activist crossing 5%
 */
/**
 * Importance is calibrated on VOLUME, not on how serious the form sounds.
 *
 * An 8-K is a material event and it is tempting to rank it top — but the live
 * index returns dozens a day, so ranking them 3 would put routine corporate
 * housekeeping above a CPI print in the emphasis. Same error as marking every
 * Fed press release top importance. A 13D is rare and genuinely changes a
 * company's story, so it keeps the top rank.
 */
const EDGAR_FORMS: Array<{ type: string; label: string; importance: number }> = [
  { type: "8-K", label: "Material event", importance: 2 },
  { type: "S-1", label: "IPO registration", importance: 2 },
  { type: "4", label: "Insider transaction", importance: 1 },
  { type: "SC 13D", label: "Activist stake", importance: 3 },
];

/**
 * Pull the company name out of an EDGAR title.
 *
 * Titles read "8-K - ACME CORP (0000123456) (Filer)".
 *
 * Splitting on the first hyphen does NOT work, and the live feed proved it: the
 * form type contains one, so "8-K - ACME CORP" yields "K - ACME CORP". It has
 * to be the " - " separator with surrounding spaces, with the CIK in
 * parentheses marking the end of the name. Form types with a space in them
 * ("SC 13D") work under the same rule.
 */
export function edgarCompany(title: string): string {
  return title.match(/^.*?\s+-\s+(.+?)\s+\(\d{6,10}\)/)?.[1]?.trim() ?? title;
}

export async function fetchSecFilings(perForm = 20): Promise<FetchOutcome> {
  const items: FeedItem[] = [];
  const errors: string[] = [];

  // Sequential rather than parallel: SEC asks for no more than 10 requests a
  // second and throttles aggressively. Four cheap calls in series is well
  // inside that, and being rate-limited would cost us the whole source.
  for (const form of EDGAR_FORMS) {
    const url =
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent` +
      `&type=${encodeURIComponent(form.type)}&company=&dateb=&owner=include` +
      `&count=${perForm}&output=atom`;

    try {
      const xml = await getText(url, { accept: "application/atom+xml" });

      for (const e of parseFeed(xml)) {
        const publishedAt = new Date(e.date);
        if (Number.isNaN(publishedAt.getTime())) continue;

        // EDGAR titles read "8-K - ACME CORP (0000123456) (Filer)", and the
        // company name is the useful part.
        //
        // Splitting on the first hyphen does NOT work: the form type contains
        // one, so "8-K - ACME CORP" yields "K - ACME CORP". It has to be the
        // " - " separator with surrounding spaces, and the CIK in parentheses
        // is what marks the end of the name.
        const company = edgarCompany(e.title);

        const res = resolve(`${e.title} ${e.summary}`);

        items.push({
          id: `sec:${e.link || e.title}`,
          source: "sec",
          category: "filing",
          publishedAt,
          headline: `${form.label}: ${company}`,
          summary: e.title,
          url: e.link || null,
          tickers: [],
          instruments: res.instruments,
          importance: form.importance,
        });
      }
    } catch (err) {
      errors.push(`SEC ${form.type}: ${(err as Error).message}`);
    }
  }

  return { items, errors };
}
