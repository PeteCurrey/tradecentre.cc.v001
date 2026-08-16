"use server";

import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users, usernameHistory } from "@/lib/db/schema";
import { currentUser, CHAT_TERMS_VERSION } from "@/lib/identity/user";
import {
  isStillReserved,
  usernameCooldownRemaining,
  validateAvatar,
  validateJobTitle,
  validateUsername,
} from "@/lib/identity/profile";

/**
 * Completing the chat wizard.
 *
 * Every rule is applied HERE as well as in the wizard. The wizard's checks
 * exist so a member is told about a problem while they are still typing; these
 * are the ones that decide anything, because a server action is a public
 * endpoint whatever the UI in front of it looks like.
 */

export type OnboardingResult = { ok: true } | { ok: false; field?: string; error: string };

/** Is a username free? Called as the member types, and again on submit. */
export async function checkUsernameAvailable(
  raw: string,
): Promise<{ available: boolean; error?: string }> {
  const me = await currentUser();
  if (!me) return { available: false, error: "Not signed in" };

  const valid = validateUsername(raw);
  if (!valid.ok) return { available: false, error: valid.error };

  const lower = valid.value.toLowerCase();

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) = ${lower}`,
        // Their own name is not a clash — this runs again on submit, and on a
        // re-run it would otherwise report the member's own name as taken.
        ne(users.id, me.id),
        isNotNull(users.username),
      ),
    )
    .limit(1);

  if (taken) return { available: false, error: "Already taken." };

  /**
   * Recently released by SOMEONE ELSE.
   *
   * Reclaiming a name you used to hold is fine and deliberately allowed — the
   * reservation exists to stop a name changing hands, not to punish someone for
   * changing their mind.
   */
  const [released] = await db
    .select({ releasedAt: usernameHistory.releasedAt })
    .from(usernameHistory)
    .where(
      and(
        sql`lower(${usernameHistory.username}) = ${lower}`,
        ne(usernameHistory.userId, me.id),
      ),
    )
    .orderBy(desc(usernameHistory.releasedAt))
    .limit(1);

  if (released && isStillReserved(released.releasedAt)) {
    return { available: false, error: "Recently used by someone else." };
  }

  return { available: true };
}

export async function completeChatOnboarding(input: {
  username: string;
  jobTitle: string;
  avatar: string | null;
  acceptedTerms: boolean;
  acceptedDisclaimer: boolean;
  acceptedConduct: boolean;
}): Promise<OnboardingResult> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Not signed in" };

  // All three documents, or none. A partial acceptance is not an acceptance,
  // and the wizard cannot be trusted to have enforced its own steps.
  if (!input.acceptedTerms || !input.acceptedDisclaimer || !input.acceptedConduct) {
    return { ok: false, error: "All three sections must be acknowledged." };
  }

  const username = validateUsername(input.username);
  if (!username.ok) return { ok: false, field: "username", error: username.error };

  const jobTitle = validateJobTitle(input.jobTitle);
  if (!jobTitle.ok) return { ok: false, field: "jobTitle", error: jobTitle.error };

  const avatar = validateAvatar(input.avatar);
  if (!avatar.ok) return { ok: false, field: "avatar", error: avatar.error };

  const free = await checkUsernameAvailable(username.value);
  if (!free.available) {
    return { ok: false, field: "username", error: free.error ?? "Already taken." };
  }

  try {
    await db
      .update(users)
      .set({
        username: username.value,
        jobTitle: jobTitle.value || null,
        avatar: avatar.value || null,
        usernameChangedAt: new Date(),
        termsAcceptedAt: new Date(),
        termsVersion: CHAT_TERMS_VERSION,
        onboardedAt: new Date(),
        chatEnabled: true,
      })
      .where(eq(users.id, me.id));
  } catch {
    // The unique index is the real arbiter: two people can pass the
    // availability check at the same moment and only one can win the write.
    return { ok: false, field: "username", error: "Already taken." };
  }

  revalidatePath("/chat");
  return { ok: true };
}

/**
 * Edit an existing profile.
 *
 * Job title and avatar change freely. The username is the one with rules,
 * because other members navigate by it: it is rate-limited, and the old name
 * is recorded and held against anyone else claiming it.
 *
 * Omitting `username` leaves it alone — that is how the form saves a job title
 * without spending the member's cooldown.
 */
export async function updateChatProfile(input: {
  username?: string;
  jobTitle: string;
  avatar: string | null;
}): Promise<OnboardingResult> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!me.onboardedAt) return { ok: false, error: "Complete the setup first." };

  const jobTitle = validateJobTitle(input.jobTitle);
  if (!jobTitle.ok) return { ok: false, field: "jobTitle", error: jobTitle.error };

  const avatar = validateAvatar(input.avatar);
  if (!avatar.ok) return { ok: false, field: "avatar", error: avatar.error };

  const wanted = input.username?.trim();
  const changingName =
    Boolean(wanted) && wanted!.toLowerCase() !== (me.username ?? "").toLowerCase();

  if (!changingName) {
    await db
      .update(users)
      .set({ jobTitle: jobTitle.value || null, avatar: avatar.value || null })
      .where(eq(users.id, me.id));
    revalidatePath("/chat");
    return { ok: true };
  }

  const username = validateUsername(wanted!);
  if (!username.ok) return { ok: false, field: "username", error: username.error };

  const wait = usernameCooldownRemaining(me.usernameChangedAt);
  if (wait > 0) {
    return {
      ok: false,
      field: "username",
      error: `You can change your username again in ${wait} day${wait === 1 ? "" : "s"}.`,
    };
  }

  const free = await checkUsernameAvailable(username.value);
  if (!free.available) {
    return { ok: false, field: "username", error: free.error ?? "Already taken." };
  }

  try {
    /**
     * History first, inside a transaction with the change itself.
     *
     * If the update failed after the history row was written, a name would be
     * reserved that nobody ever gave up — and the member would be told their
     * own current name is taken.
     */
    await db.transaction(async (tx) => {
      if (me.username) {
        await tx.insert(usernameHistory).values({
          userId: me.id,
          username: me.username,
          heldFrom: me.usernameChangedAt,
        });
      }
      await tx
        .update(users)
        .set({
          username: username.value,
          usernameChangedAt: new Date(),
          jobTitle: jobTitle.value || null,
          avatar: avatar.value || null,
        })
        .where(eq(users.id, me.id));
    });
  } catch {
    // The unique index is the real arbiter — two members can pass the
    // availability check in the same instant and only one can win the write.
    return { ok: false, field: "username", error: "Already taken." };
  }

  revalidatePath("/chat");
  return { ok: true };
}

/**
 * The toggle, after onboarding.
 *
 * Turning chat off does not un-accept the terms or free the username — it is a
 * switch, not a withdrawal. Turning it back on therefore does not re-run the
 * wizard, unless the terms version has moved on.
 */
export async function setChatEnabled(enabled: boolean): Promise<OnboardingResult> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!me.onboardedAt) return { ok: false, error: "Complete the setup first." };

  await db.update(users).set({ chatEnabled: enabled }).where(eq(users.id, me.id));
  revalidatePath("/chat");
  return { ok: true };
}
