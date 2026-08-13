import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { watchlistLevels } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/Page";
import { WatchlistPanel, type LevelRow } from "@/components/watchlist/WatchlistPanel";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  await requireSession();

  const rows = await db
    .select()
    .from(watchlistLevels)
    .orderBy(desc(watchlistLevels.createdAt));

  const levels: LevelRow[] = rows.map((r) => ({
    id: r.id,
    instrument: r.instrument,
    price: Number(r.price),
    label: r.label,
    kind: r.kind,
    active: r.active,
  }));

  return (
    <>
      <PageHeader
        title="Watchlist"
        subtitle={`${levels.filter((l) => l.active).length} active levels across ${
          new Set(levels.map((l) => l.instrument)).size
        } instruments`}
      />
      <WatchlistPanel rows={levels} />
    </>
  );
}
