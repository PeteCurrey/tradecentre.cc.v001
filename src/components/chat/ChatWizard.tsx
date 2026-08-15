"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ShieldAlert, Upload, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import {
  checkUsernameAvailable,
  completeChatOnboarding,
} from "@/lib/chat/onboarding";
import {
  JOB_TITLE_MAX,
  USERNAME_MAX,
  initials,
  validateJobTitle,
  validateUsername,
} from "@/lib/identity/profile";

/**
 * First visit to Chat.
 *
 * ── Why a wizard rather than one long page ────────────────────────────────
 * Three documents stacked above a form is a page people scroll past to reach
 * the button. Steps make each one its own decision, and the acknowledgement
 * for a document cannot be given from a screen that is not showing it.
 *
 * Nothing here is the enforcement. `completeChatOnboarding` re-checks all
 * three acknowledgements and every field, because a server action is reachable
 * whatever the UI does.
 *
 * ── Avatars never leave the browser as originals ──────────────────────────
 * The file is drawn to a 128px canvas and re-encoded as JPEG before it is
 * sent. That caps the size, discards EXIF — which routinely carries the GPS
 * coordinates of where a photo was taken — and makes an SVG upload structurally
 * impossible rather than merely rejected.
 */

const AVATAR_PX = 128;

type Step = {
  id: string;
  title: string;
  /** Documents need an acknowledgement; the profile step does not. */
  ack?: string;
};

const STEPS: Step[] = [
  { id: "terms", title: "Terms of use", ack: "I have read and accept these terms." },
  {
    id: "disclaimer",
    title: "Risk disclaimer",
    ack: "I understand that nothing here is financial advice.",
  },
  {
    id: "conduct",
    title: "Code of conduct",
    ack: "I agree to follow the code of conduct.",
  },
  { id: "profile", title: "Your profile" },
];

async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  // Square centre crop, so a portrait photo does not arrive squashed.
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", 0.82);
}

export function ChatWizard({ version, fallbackName }: { version: string; fallbackName: string }) {
  const [step, setStep] = useState(0);
  const [acks, setAcks] = useState<Record<string, boolean>>({});

  const [username, setUsername] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  /* Debounced availability check while typing. */
  useEffect(() => {
    const raw = username.trim();
    setAvailable(null);
    if (!raw) {
      setFieldError(null);
      return;
    }
    const local = validateUsername(raw);
    if (!local.ok) {
      setFieldError(local.error);
      return;
    }
    setFieldError(null);
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(raw);
        setAvailable(res.available);
        setFieldError(res.available ? null : (res.error ?? "Already taken."));
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const canAdvance = current.ack ? Boolean(acks[current.id]) : false;
  const profileReady =
    validateUsername(username).ok && available === true && validateJobTitle(jobTitle).ok;

  const pickAvatar = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setAvatar(await toAvatarDataUrl(file));
    } catch {
      setError("That image could not be read. Try a JPG or PNG.");
    }
  }, []);

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      const res = await completeChatOnboarding({
        username: username.trim(),
        jobTitle,
        avatar,
        acceptedTerms: Boolean(acks.terms),
        acceptedDisclaimer: Boolean(acks.disclaimer),
        acceptedConduct: Boolean(acks.conduct),
      });
      if (!res.ok) {
        setError(res.error);
        if (res.field === "username") setStep(STEPS.length - 1);
        return;
      }
      // The action revalidates /chat; the server then renders the room.
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-[var(--color-warn)]" />
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">
            Set up chat
          </h2>
          <span className="label-faint ml-auto text-[10px]">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        {/* Progress. Accent marks where you are — interface state, as everywhere. */}
        <div className="mt-3 flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={clsx(
                "h-1 flex-1 rounded-full transition-colors",
                i < step
                  ? "bg-[var(--color-accent)] opacity-50"
                  : i === step
                    ? "bg-[var(--color-accent)]"
                    : "bg-[var(--color-line)]",
              )}
            />
          ))}
        </div>

        <h3 className="mt-5 text-base font-semibold text-[var(--color-ink)]">
          {current.title}
        </h3>

        <div className="mt-3 min-h-[15rem]">
          {current.id === "terms" && <Terms version={version} />}
          {current.id === "disclaimer" && <Disclaimer />}
          {current.id === "conduct" && <Conduct />}
          {current.id === "profile" && (
            <Profile
              username={username}
              setUsername={setUsername}
              jobTitle={jobTitle}
              setJobTitle={setJobTitle}
              avatar={avatar}
              setAvatar={setAvatar}
              fileInput={fileInput}
              pickAvatar={pickAvatar}
              checking={checking}
              available={available}
              fieldError={fieldError}
              fallbackName={fallbackName}
            />
          )}
        </div>

        {current.ack && (
          <label className="mt-4 flex items-start gap-2.5 text-xs text-[var(--color-ink-dim)]">
            <input
              type="checkbox"
              checked={Boolean(acks[current.id])}
              onChange={(e) =>
                setAcks((a) => ({ ...a, [current.id]: e.target.checked }))
              }
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
            />
            <span>{current.ack}</span>
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-[var(--color-warn)]">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-ink-mute)] transition-colors hover:bg-[var(--color-accent-wash)] disabled:invisible"
          >
            <ChevronLeft className="size-3.5" />
            Back
          </button>

          {isLast ? (
            <button
              onClick={finish}
              disabled={!profileReady || saving}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="size-4" />
              {saving ? "Saving…" : "Enable chat"}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance}
              className="flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

const proseClass =
  "space-y-2.5 text-xs leading-relaxed text-[var(--color-ink-mute)]";

/**
 * ⚠️ PLACEHOLDER WORDING throughout. Peter is having these drafted properly.
 * The mechanism — three documents, acknowledged separately, recorded against a
 * version — is what is built here. Bump CHAT_TERMS_VERSION when the words
 * change and every member is asked again.
 */
function Terms({ version }: { version: string }) {
  return (
    <div className={proseClass}>
      <p>
        Chat is provided to members of drawdown.trading as a place to discuss
        markets. Access can be withdrawn at any time.
      </p>
      <p>
        Messages are stored <strong>permanently</strong>. They can be reviewed
        by a moderator and may be produced if we are legally required to do so.
        Removing a message hides it from the room; it does not erase it.
      </p>
      <p>
        Do not post anyone&apos;s personal information, material you have no
        right to share, or anything unlawful.
      </p>
      <p className="text-[var(--color-ink-faint)]">Version {version}</p>
    </div>
  );
}

function Disclaimer() {
  return (
    <div className={proseClass}>
      <p>
        Everything posted in chat is the <strong>personal opinion</strong> of the
        member who wrote it. It is not financial advice, not a recommendation,
        and not a solicitation to trade. No member or moderator is acting as
        your adviser.
      </p>
      <p>
        Trading carries risk and you can lose more than you deposit. Past
        results — anyone&apos;s — do not predict future results.
      </p>
      <p>
        <strong>Every decision you take is yours alone</strong>, whatever you
        read here and whoever wrote it.
      </p>
    </div>
  );
}

function Conduct() {
  return (
    <div className={proseClass}>
      <p>Rooms work when people can disagree without it becoming personal.</p>
      <ul className="ml-4 list-disc space-y-1.5">
        <li>No harassment, abuse, or discriminatory language.</li>
        <li>
          No signal-selling, referral links, or promoting other paid services.
        </li>
        <li>
          No pump-and-dump, no coordinating to move a market, no posting
          information you should not have.
        </li>
        <li>
          Do not present opinion as fact, and do not claim results you cannot
          evidence.
        </li>
        <li>Do not share another member&apos;s messages outside the platform.</li>
      </ul>
      <p>Moderators may remove messages or withdraw access.</p>
    </div>
  );
}

function Profile({
  username,
  setUsername,
  jobTitle,
  setJobTitle,
  avatar,
  setAvatar,
  fileInput,
  pickAvatar,
  checking,
  available,
  fieldError,
  fallbackName,
}: {
  username: string;
  setUsername: (v: string) => void;
  jobTitle: string;
  setJobTitle: (v: string) => void;
  avatar: string | null;
  setAvatar: (v: string | null) => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  pickAvatar: (f: File | undefined) => void;
  checking: boolean;
  available: boolean | null;
  fieldError: string | null;
  fallbackName: string;
}) {
  const shown = username.trim() || fallbackName;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-sunken)]">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-lg font-semibold text-[var(--color-ink-mute)]">
              {initials(shown)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent-line)]"
          >
            <Upload className="size-3.5" />
            {avatar ? "Change photo" : "Add photo"}
          </button>
          {avatar && (
            <button
              onClick={() => setAvatar(null)}
              className="flex items-center gap-1 text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
            >
              <X className="size-3" />
              Remove
            </button>
          )}
          <span className="text-[10px] text-[var(--color-ink-faint)]">
            Optional. Resized to {AVATAR_PX}px in your browser.
          </span>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => pickAvatar(e.target.files?.[0])}
        />
      </div>

      <div>
        <label htmlFor="username" className="label mb-1.5 block">
          Username
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value.slice(0, USERNAME_MAX))}
          placeholder="gold_bug"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 text-sm outline-none transition-colors focus:border-[var(--color-accent-line)]"
        />
        <p
          className={clsx(
            "mt-1.5 text-[11px]",
            fieldError ? "text-[var(--color-warn)]" : "text-[var(--color-ink-faint)]",
          )}
        >
          {fieldError
            ? fieldError
            : checking
              ? "Checking…"
              : available
                ? "Available."
                : "This is the name other members see. It cannot be changed here later."}
        </p>
      </div>

      <div>
        <label htmlFor="jobTitle" className="label mb-1.5 block">
          Job title <span className="text-[var(--color-ink-faint)]">(optional)</span>
        </label>
        <input
          id="jobTitle"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value.slice(0, JOB_TITLE_MAX))}
          placeholder="Prop trader"
          className="h-10 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 text-sm outline-none transition-colors focus:border-[var(--color-accent-line)]"
        />
      </div>
    </div>
  );
}
