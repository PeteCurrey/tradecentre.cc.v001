import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Best Opportunities" subtitle={"Everything available, taken or not"} />
      <ComingSoon
        phase="Phase 2"
        describes={"Every opportunity spotted plus every AI candidate, scored and source-labelled. Its real output is the three-way comparison over time: what you spotted, what the AI spotted, and what you actually traded."}
      />
    </>
  );
}
