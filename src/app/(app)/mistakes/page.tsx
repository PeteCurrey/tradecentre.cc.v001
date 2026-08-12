import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Mistakes & Leaks" subtitle={"What your errors actually cost"} />
      <ComingSoon
        phase="Phase 3"
        describes={"Entry, exit, sizing and discipline errors — each tagged, costed in R, and trended. Usually where the largest recoverable money is hiding."}
      />
    </>
  );
}
