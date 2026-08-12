import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Watchlist" subtitle={"Tracked instruments and levels"} />
      <ComingSoon
        phase="Phase 5"
        describes={"Instruments you're following with your marked levels, and alerts when price approaches. Cheap to add — the streaming price data is already arriving."}
      />
    </>
  );
}
