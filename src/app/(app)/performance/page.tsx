import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Performance" subtitle={"Equity curves and expectancy"} />
      <ComingSoon
        phase="Phase 3"
        describes={"Per-book equity curves plus the roll-up, expectancy, profit factor, win rate and R distribution. Also tests whether your conviction grades actually predict outcome — if A+ doesn't beat B, conviction-scaled sizing is costing you money."}
      />
    </>
  );
}
