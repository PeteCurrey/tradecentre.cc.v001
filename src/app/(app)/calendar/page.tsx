import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Calendar" subtitle={"Month heatmap of daily P&L"} />
      <ComingSoon
        phase="Phase 2"
        describes={"Each day a coloured cell, click through to that day's trades and review. Green and red here mean money, as everywhere else."}
      />
    </>
  );
}
