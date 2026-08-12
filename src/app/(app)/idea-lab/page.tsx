import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Idea Lab" subtitle={"Patterns earning their way to live"} />
      <ComingSoon
        phase="Phase 5"
        describes={"New patterns tested on the demo books and tracked against your thresholds. The app flags when one qualifies for promotion; nothing goes live without your approval."}
      />
    </>
  );
}
