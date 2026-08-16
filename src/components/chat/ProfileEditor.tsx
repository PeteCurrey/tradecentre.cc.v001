"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Upload, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { checkUsernameAvailable, updateChatProfile } from "@/lib/chat/onboarding";
import {
  JOB_TITLE_MAX,
  USERNAME_COOLDOWN_DAYS,
  USERNAME_MAX,
  USERNAME_RESERVED_DAYS,
  initials,
  validateUsername,
} from "@/lib/identity/profile";

/**
 * Editing a profile after onboarding.
 *
 * The username input is disabled outright while the cooldown is running,
 * rather than accepted and then refused on save. Being told the rule after
 * typing a new name and pressing Save is the worse of the two.
 *
 * Avatar handling matches the wizard: resized and re-encoded in the browser,
 * so no original file and no EXIF ever reaches the server.
 */

const AVATAR_PX = 128;

async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
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

export function ProfileEditor({
  initialUsername,
  initialJobTitle,
  initialAvatar,
  cooldownDays,
}: {
  initialUsername: string;
  initialJobTitle: string;
  initialAvatar: string | null;
  /** 0 when the username may be changed now. */
  cooldownDays: number;
}) {
  const locked = cooldownDays > 0;

  const [username, setUsername] = useState(initialUsername);
  const [jobTitle, setJobTitle] = useState(initialJobTitle);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);

  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  const nameChanged = username.trim().toLowerCase() !== initialUsername.toLowerCase();
  const dirty =
    nameChanged || jobTitle !== initialJobTitle || avatar !== initialAvatar;

  useEffect(() => {
    if (locked || !nameChanged) {
      setNameError(null);
      setAvailable(null);
      return;
    }
    const local = validateUsername(username.trim());
    if (!local.ok) {
      setNameError(local.error);
      setAvailable(null);
      return;
    }
    setNameError(null);
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(username.trim());
        setAvailable(res.available);
        setNameError(res.available ? null : (res.error ?? "Already taken."));
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username, nameChanged, locked]);

  const canSave =
    dirty && !saving && (!nameChanged || (available === true && !nameError));

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateChatProfile({
        // Omitted when unchanged, so saving a job title does not spend the
        // member's one username change.
        username: nameChanged ? username.trim() : undefined,
        jobTitle,
        avatar,
      });
      if (!res.ok) {
        if (res.field === "username") setNameError(res.error);
        else setError(res.error);
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const shown = username.trim() || initialUsername;

  return (
    <div className="space-y-5">
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
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            try {
              setAvatar(await toAvatarDataUrl(file));
            } catch {
              setError("That image could not be read. Try a JPG or PNG.");
            }
          }}
        />
      </div>

      <div>
        <label htmlFor="username" className="label mb-1.5 block">
          Username
        </label>
        <input
          id="username"
          value={username}
          disabled={locked}
          onChange={(e) => setUsername(e.target.value.slice(0, USERNAME_MAX))}
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 text-sm outline-none transition-colors focus:border-[var(--color-accent-line)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p
          className={clsx(
            "mt-1.5 text-[11px]",
            nameError ? "text-[var(--color-warn)]" : "text-[var(--color-ink-faint)]",
          )}
        >
          {locked
            ? `Changeable again in ${cooldownDays} day${cooldownDays === 1 ? "" : "s"}.`
            : nameError
              ? nameError
              : checking
                ? "Checking…"
                : nameChanged && available
                  ? "Available."
                  : `Can be changed once every ${USERNAME_COOLDOWN_DAYS} days. Your old name stays reserved for ${USERNAME_RESERVED_DAYS}.`}
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

      {nameChanged && !locked && (
        <p className="rounded-lg border border-[var(--color-line)] bg-[var(--color-sunken)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-ink-mute)]">
          Renaming updates every message you have already posted, since the room
          shows who you are now. Your old name is kept on your record and cannot
          be taken by anyone else for {USERNAME_RESERVED_DAYS} days.
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--color-warn)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="size-4" />
          {saving ? "Saving…" : "Save profile"}
        </button>
        {saved && !dirty && (
          <span className="text-xs text-[var(--color-ink-mute)]">Saved.</span>
        )}
      </div>
    </div>
  );
}
