import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Pre-Market" subtitle={"Game plan, written before the session"} />
      <ComingSoon
        phase="Phase 2"
        describes={"Bias per instrument, key levels, news due, and which setups you're hunting today. Written before the open — this is what makes \"did I trade my plan?\" answerable later."}
      />
    </>
  );
}
