import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Goals" subtitle={"Targets and progress"} />
      <ComingSoon
        phase="Phase 5"
        describes={"Targets, milestones, and monthly and quarterly review."}
      />
    </>
  );
}
