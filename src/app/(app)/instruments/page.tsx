import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Instruments" subtitle={"Per-instrument performance and exposure"} />
      <ComingSoon
        phase="Phase 3"
        describes={"Results per pair, index and commodity — plus correlation exposure, which matters on OANDA where being long three USD pairs is one position in three costumes."}
      />
    </>
  );
}
