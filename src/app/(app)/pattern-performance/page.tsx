import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Pattern Performance" subtitle={"Which setups actually make money"} />
      <ComingSoon
        phase="Phase 3"
        describes={"Expectancy per pattern, sliced by book, instrument and session. Most traders find two patterns carry everything and the rest are a hobby."}
      />
    </>
  );
}
