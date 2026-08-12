import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Open Positions" subtitle={"What's currently on, with streaming P&L"} />
      <ComingSoon
        phase="Phase 1"
        describes={"Live management of open trades, with streaming P&L, current R, and distance to stop and target. Matters most for the swing and position books that carry overnight."}
      />
    </>
  );
}
