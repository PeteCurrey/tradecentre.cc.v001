import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Playbook" subtitle={"The rules you're graded against"} />
      <ComingSoon
        phase="Phase 5"
        describes={"Your trading plan as a living document: rules, risk limits, session rules, pre-trade checklist. This is what execution grading scores against, so it has to exist before grading means anything."}
      />
    </>
  );
}
