import { requireSession } from "@/lib/auth/guard";
import { readFeed } from "@/lib/feed/ingest";
import { PageHeader } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Wire } from "@/components/feed/Wire";
import { RefreshWire } from "@/components/feed/RefreshWire";

export const dynamic = "force-dynamic";

/**
 * The Wire — what is happening, as opposed to what is scheduled.
 *
 * Deliberately distinct from Market Context, which answers "what is due". This
 * screen exists so the question "what is going on out there" can be answered
 * without leaving the dashboard, which was the whole point of building it.
 *
 * The first render is server-side so the screen is never briefly empty; the
 * client then polls and replaces.
 */
export default async function WirePage() {
  await requireSession();
  const items = await readFeed({ limit: 100 });

  return (
    <>
      <PageHeader
        title="The Wire"
        subtitle="Market news, central banks, releases and filings — newest first, always"
        action={<RefreshWire />}
      />

      <Card className="flex max-h-[calc(100vh-12rem)] flex-col p-5">
        <Wire
          initialItems={items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() }))}
          showFilters
        />
      </Card>
    </>
  );
}
