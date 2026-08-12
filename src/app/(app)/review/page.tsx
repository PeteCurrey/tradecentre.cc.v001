import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="End of Day" subtitle={"Daily wrap and grade"} />
      <ComingSoon
        phase="Phase 2"
        describes={"What happened, process grade, rule adherence, and tomorrow's prep. AI drafts the first version from your trades and notes so you're editing rather than facing a blank page."}
      />
    </>
  );
}
