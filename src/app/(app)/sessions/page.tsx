import { ComingSoon, PageHeader } from "@/components/ui/Page";

export default function Page() {
  return (
    <>
      <PageHeader title="Time & Session" subtitle={"When your edge actually shows up"} />
      <ComingSoon
        phase="Phase 3"
        describes={"Performance by hour, weekday, session and hold time. Likely one of your strongest signals as a London-based trader in FX and indices."}
      />
    </>
  );
}
