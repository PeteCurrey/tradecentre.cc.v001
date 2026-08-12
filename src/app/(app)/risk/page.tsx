import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Risk & Drawdown" subtitle={"Discipline over time"} />
      <ComingSoon
        phase="Phase 3"
        describes={"Risk per trade, R discipline, drawdown depth and duration, streaks, and daily limit tracking. This is the screen that catches size creep after a good run."}
      />
    </>
  );
}
