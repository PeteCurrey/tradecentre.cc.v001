import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Ask" subtitle={"Question your own history"} />
      <ComingSoon
        phase="Phase 4"
        describes={"Ask in plain English — \"how do I do on gold in the London session after a losing trade?\" — and get an answer from your own trade data. Removes the ceiling where you can only ask what someone built a screen for."}
      />
    </>
  );
}
