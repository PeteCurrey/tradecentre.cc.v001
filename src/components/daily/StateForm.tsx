"use client";

import { useState } from "react";
import { saveStateLog } from "@/lib/journal/daily";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  ErrorNote,
  Field,
  SaveButton,
  Scale,
  TagToggles,
  TextArea,
  TextInput,
  useSaver,
} from "./Fields";

export type StateData = {
  day: string;
  sleep: number | null;
  energy: number | null;
  focus: number | null;
  emotionPre: string | null;
  emotionDuring: string | null;
  emotionPost: string | null;
  tiltMarkers: string[];
  notes: string | null;
};

/**
 * Tilt markers, kept to six.
 *
 * A longer list gets skipped, and a skipped field is worse than no field —
 * it makes the record look complete while carrying nothing.
 */
export const TILT_MARKERS = [
  { id: "revenge_urge", label: "Revenge urge" },
  { id: "frustration", label: "Frustration" },
  { id: "boredom", label: "Boredom" },
  { id: "overconfidence", label: "Overconfidence" },
  { id: "fear_of_missing", label: "FOMO" },
  { id: "fatigue", label: "Fatigue" },
];

export function StateForm({ state }: { state: StateData }) {
  const { save, pending, saved, error } = useSaver();

  const [sleep, setSleep] = useState(state.sleep);
  const [energy, setEnergy] = useState(state.energy);
  const [focus, setFocus] = useState(state.focus);
  const [pre, setPre] = useState(state.emotionPre ?? "");
  const [during, setDuring] = useState(state.emotionDuring ?? "");
  const [post, setPost] = useState(state.emotionPost ?? "");
  const [tilt, setTilt] = useState<string[]>(state.tiltMarkers);
  const [notes, setNotes] = useState(state.notes ?? "");

  function submit() {
    save(() =>
      saveStateLog({
        day: state.day,
        sleep,
        energy,
        focus,
        emotionPre: pre,
        emotionDuring: during,
        emotionPost: post,
        tiltMarkers: tilt,
        notes,
      }),
    );
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="State"
        action={<SaveButton onClick={submit} pending={pending} saved={saved} />}
      />
      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        Ten seconds, deliberately. This is only worth keeping if it gets filled in every
        day — which is why there are nine fields and not thirty.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Sleep">
            <Scale value={sleep} onChange={setSleep} low="poor" high="great" />
          </Field>
          <Field label="Energy">
            <Scale value={energy} onChange={setEnergy} low="flat" high="sharp" />
          </Field>
          <Field label="Focus">
            <Scale value={focus} onChange={setFocus} low="scattered" high="locked in" />
          </Field>
          <Field label="Tilt markers" hint="Noticing it is most of the work.">
            <TagToggles options={TILT_MARKERS} selected={tilt} onChange={setTilt} />
          </Field>
        </div>

        <div className="space-y-4">
          <Field label="Before" hint="One word is fine.">
            <TextInput value={pre} onChange={setPre} placeholder="calm, keen, wary…" />
          </Field>
          <Field label="During">
            <TextInput value={during} onChange={setDuring} placeholder="steady, rattled…" />
          </Field>
          <Field label="After">
            <TextInput value={post} onChange={setPost} placeholder="flat, relieved, annoyed…" />
          </Field>
          <Field label="Notes">
            <TextArea value={notes} onChange={setNotes} rows={4} />
          </Field>
        </div>
      </div>

      <ErrorNote error={error} />
    </Card>
  );
}
