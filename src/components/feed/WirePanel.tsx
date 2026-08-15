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
 * Height is capped and scrolls internally so the feed can never push the P&L
 * and open-risk panels below the fold. What you own comes first on this screen;
 * the world is the column beside it.
 */
export async function WirePanel() {
  const items = await readFeed({ limit: 40 });

  return (
    <Card className="flex max-h-[32rem] flex-col p-5">
      <CardHeader
        title="The Wire"
        action={
          <Link href="/wire" className="label-faint hover:text-[var(--color-ink-dim)]">
            View all
          </Link>
        }
      />
      <Wire
        className="mt-2"
        initialItems={items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() }))}
        limit={40}
        compact
      />
    </Card>
  );
}
