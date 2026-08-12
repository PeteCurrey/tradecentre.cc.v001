import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Market Context" subtitle={"Calendar, regime and event odds"} />
      <ComingSoon
        phase="Phase 5"
        describes={"Economic calendar, macro regime from FRED series, and market-implied event probabilities from Polymarket shown beside the events themselves."}
      />
    </>
  );
}
