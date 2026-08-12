import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Psychology & State" subtitle={"State against results"} />
      <ComingSoon
        phase="Phase 2"
        describes={"Sleep, energy and focus as quick sliders; emotional state captured before, during and after rather than reconstructed at day's end; plus explicit tilt markers."}
      />
    </>
  );
}
