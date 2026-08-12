import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Reports" subtitle={"Summaries and exports"} />
      <ComingSoon
        phase="Phase 5"
        describes={"Monthly and quarterly summaries, CSV export, and accountant-friendly output."}
      />
    </>
  );
}
