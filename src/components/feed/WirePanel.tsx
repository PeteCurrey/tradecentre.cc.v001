import Link from "next/link";
import { readFeed } from "@/lib/feed/ingest";
import { Card, CardHeader } from "@/components/ui/Card";
import { Wire } from "./Wire";

/**
 * The wire, compressed into a column on Today.
 *
 * Deliberately not a second implementation — it renders the same `Wire` with
 * `compact` set, reading the same store. A panel that drifted out of step with
 * the full screen would be worse than no panel, because you would stop
 * believing either.
 *
 * ── Why this view is filtered ──────────────────────────────────────────────
 * Measured on a live pull: 213 items, of which 122 had neither an instrument
 * tag nor an importance, and the newest 40 held just 4 tagged items and none at
 * top importance. Unfiltered, this column would be twenty insider filings and
 * seventeen "Should You Buy Micron" pieces, with the Fed items pushed out of
 * sight by age alone.
 *
 * So the panel shows only what is tagged to an instrument or is central-bank /
 * economic. That is a FILTER, not a ranking — order is still strictly newest
 * first — and the header says so with a link to the unfiltered wire, because a
 * quiet column must never be mistaken for a quiet market.
 *
 * Height is capped and scrolls internally so the feed can never push the rest
 * of the page into being a scroll journey. What you own comes first on this
 * screen; the world runs full width underneath it.
 *
 * ── Why this is no longer `compact` ────────────────────────────────────────
 * Compact existed to survive a 300px column: it dropped the summary and the
 * source label because there was no room for them. At full width there is, and
 * a headline alone often does not tell you whether a story matters. The two
 * views still share one `Wire`, so they cannot drift.
 */
export async function WirePanel() {
  const items = await readFeed({ limit: 40, relevantOnly: true });

  return (
    <Card className="flex max-h-[36rem] flex-col p-5">
      <CardHeader
        title="The Wire"
        action={
          <Link
            href="/wire"
            className="label-faint hover:text-[var(--color-ink-dim)]"
            title="This panel shows tagged, central-bank and economic items only"
          >
            Tagged &amp; macro · All
          </Link>
        }
      />
      <Wire
        className="mt-2"
        initialItems={items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() }))}
        limit={40}
        filter={{ relevantOnly: true }}
      />
    </Card>
  );
}
