import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { loadTrades } from "@/lib/analytics/load";
import { DISPLAY_TZ, brokerDayKey, dayKey } from "@/lib/time";
import { BOOK_IDS, type BookId } from "@/lib/books";

/**
 * CSV export of the derived trade table.
 *
 * Exports what the app computed, with the inputs it computed from, so a figure
 * in a spreadsheet can be traced back to a broker fill. Deliberately includes
 * the empty cells: a trade with no R exports as blank rather than 0, because a
 * zero in a spreadsheet column silently becomes a data point.
 */
export const dynamic = "force-dynamic";

const COLUMNS = [
  "trade_id",
  "book",
  "horizon",
  "instrument",
  "direction",
  "entry_time_utc",
  "exit_time_utc",
  "london_day",
  "broker_day",
  "realized_pl",
  "r_multiple",
  "spread_cost",
  "financing",
  "pattern_id",
  "conviction",
  "process_grade",
  "mistakes",
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  await requireSession();

  const url = new URL(request.url);
  const book = BOOK_IDS.find((b) => b === url.searchParams.get("book")) as
    | BookId
    | undefined;
  const demo = url.searchParams.get("demo") === "1";
  const from = url.searchParams.get("from");

  const trades = await loadTrades({
    book,
    demo,
    since: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00Z`) : undefined,
  });

  const rows = trades
    .sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime())
    .map((t) =>
      [
        t.id,
        t.book,
        t.horizon,
        t.instrument,
        t.direction,
        t.entryTime.toISOString(),
        t.exitTime?.toISOString() ?? null,
        t.exitTime ? dayKey(t.exitTime, DISPLAY_TZ) : null,
        t.exitTime ? brokerDayKey(t.exitTime) : null,
        t.realizedPl,
        // Blank, not zero — see the note above.
        t.rMultiple ?? null,
        t.spreadCost,
        t.financing,
        t.patternId,
        t.conviction,
        t.processGrade,
        t.mistakes.join("|"),
      ]
        .map(csvCell)
        .join(","),
    );

  const csv = [COLUMNS.join(","), ...rows].join("\n");
  const name = `trades-${demo ? "demo" : "live"}${book ? `-${book}` : ""}-${dayKey(new Date())}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
