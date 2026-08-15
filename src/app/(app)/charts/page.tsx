import { requireSession } from "@/lib/auth/guard";
import { PageHeader } from "@/components/ui/Page";
import { ChartBoard } from "@/components/charts/ChartBoard";

export const dynamic = "force-dynamic";

/**
 * Charts.
 *
 * TradingView renders these from its own data — nothing on this screen comes
 * from the desk's database, and nothing here is written back. It is a viewer,
 * deliberately: the value is not having to leave the platform to look at a
 * chart, which is the same argument as The Wire.
 */
export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  await requireSession();
  const { symbol } = await searchParams;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Charts"
        subtitle="TradingView — search any symbol. VWAP and volume render wherever the venue reports volume."
      />
      <ChartBoard initialSymbol={symbol || "OANDA:SPX500USD"} />
    </div>
  );
}
