/**
 * Chat profile rules.
 *
 * Pure functions with no database and no `server-only`, so every rule is
 * directly testable. The server action and the wizard both call these, which
 * is what stops the browser's idea of a valid username drifting from the
 * server's.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const JOB_TITLE_MAX = 60;

/** ~120KB of base64, which a 128px JPEG comes nowhere near. */
export const AVATAR_MAX_CHARS = 120_000;

/**
 * Names nobody may take.
 *
 * Impersonating staff is the cheapest attack on a chat room — "moderator"
 * saying something carries weight a stranger's post does not. Substring-free
 * exact matching, since `admin_2` is not the problem; `admin` is.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "moderator",
  "mod",
  "staff",
  "support",
  "system",
  "drawdown",
  "tradingdesk",
  "desk",
  "official",
  "help",
  "root",
  "owner",
  "peter",
]);

/**
 * How long between username changes, and how long a freed name is held.
 *
 * Renaming is allowed because being stuck with a name chosen in thirty seconds
 * during onboarding is a bad outcome, and because a member who used something
 * identifying deserves a way out of it. Rate-limiting it is what stops a name
 * becoming a costume changed between conversations.
 *
 * The reservation matters more than the cooldown. Other members remember names,
 * not user ids, so the damage is not someone renaming themselves — it is a
 * second person turning up under a name the room already associates with the
 * first. Holding a freed name breaks that.
 */
export const USERNAME_COOLDOWN_DAYS = 30;
export const USERNAME_RESERVED_DAYS = 90;

const DAY_MS = 86_400_000;

export type Validation = { ok: true; value: string } | { ok: false; error: string };

/**
 * Whole days left before the username may change again, 0 when free.
 *
 * Rounded UP, so "1 day" never means "in about four minutes" — a member told
 * to come back tomorrow and refused again would reasonably think it broken.
 */
export function usernameCooldownRemaining(
  changedAt: Date | null,
  now: Date = new Date(),
): number {
  if (!changedAt) return 0;
  const elapsed = now.getTime() - changedAt.getTime();
  // A future timestamp means a clock problem, not a 30-day wait.
  if (elapsed < 0) return 0;
  const remaining = USERNAME_COOLDOWN_DAYS * DAY_MS - elapsed;
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

/** Is a name someone else released still held against them? */
export function isStillReserved(
  releasedAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() - releasedAt.getTime() < USERNAME_RESERVED_DAYS * DAY_MS;
}

/**
 * Usernames are letters, digits and underscores.
 *
 * Deliberately narrow. Unicode look-alikes are the other half of the
 * impersonation problem — Cyrillic `а` is indistinguishable from Latin `a` in
 * every font here — and no allowance of spaces or punctuation is worth
 * reopening that.
 */
export function validateUsername(raw: string): Validation {
  const value = raw.trim();

  if (value.length < USERNAME_MIN) {
    return { ok: false, error: `At least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, error: `At most ${USERNAME_MAX} characters.` };
  }
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    return { ok: false, error: "Letters, numbers and underscores only." };
  }
  if (!/[A-Za-z]/.test(value)) {
    return { ok: false, error: "Must contain at least one letter." };
  }
  if (RESERVED.has(value.toLowerCase())) {
    return { ok: false, error: "That name is reserved." };
  }
  return { ok: true, value };
}

export function validateJobTitle(raw: string): Validation {
  // Newlines are checked on the RAW input, before whitespace is collapsed.
  // Collapsing first turns "\n\n" into " " and the check can never fire —
  // which is exactly what it did until a test caught it. A pasted multi-line
  // block should be refused, not silently folded into one line.
  if (/[\r\n]/.test(raw)) return { ok: false, error: "One line only." };

  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return { ok: true, value: "" };
  if (value.length > JOB_TITLE_MAX) {
    return { ok: false, error: `At most ${JOB_TITLE_MAX} characters.` };
  }
  return { ok: true, value };
}

/**
 * Accept only a raster `data:` image.
 *
 * SVG is refused explicitly and by omission: it is a document format that can
 * carry script, and it has no business being someone's avatar. Remote URLs are
 * refused too — an avatar pointing at a third-party host turns every message
 * render into a request that leaks who is reading the room, and lets the host
 * swap the image for something else after moderation has seen it.
 */
export function validateAvatar(raw: string | null | undefined): Validation {
  if (!raw) return { ok: true, value: "" };

  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) {
    return { ok: false, error: "Image could not be read. Try a JPG or PNG." };
  }
  if (raw.length > AVATAR_MAX_CHARS) {
    return { ok: false, error: "Image is too large." };
  }
  return { ok: true, value: raw };
}

/** Fallback shown when there is no avatar. Never a stock photo of a person. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s_]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
