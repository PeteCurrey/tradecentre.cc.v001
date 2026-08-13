import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/guard";
import { trades } from "@/lib/db/schema";
import { getDeskSnapshot } from "@/lib/desk/snapshot";
import { PositionsTable, type PositionRow } from "@/components/positions/PositionsTable";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  await requireSession();

  const [snapshot, openRows] = await Promise.all([
    getDeskSnapshot(),
    db.select().from(trades).where(eq(trades.state, "open")),
  ]);

  // Link each broker position back to its derived row so the instrument name
  // opens the trade detail. Positions the ledger hasn't caught up with yet
  // simply render without a link rather than 404ing.
  const rows: PositionRow[] = snapshot.books.flatMap((b) =>
    b.openPositions.map((p) => {
      const stored = openRows.find(
        (t) => t.oandaTradeId === p.oandaTradeId && t.book === b.book,
      );
      return {
        ...p,
        book: b.book,
        currency: b.currency,
        tradeRowId: stored?.id ?? null,
        entryTime: stored?.entryTime.toISOString() ?? null,
      };
    }),
  );

  return <PositionsTable snapshot={snapshot} rows={rows} />;
}
