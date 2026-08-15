"use server";

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { currentUser, CHAT_TERMS_VERSION } from "@/lib/identity/user";
import { validateAvatar, validateJobTitle, validateUsername } from "@/lib/identity/profile";

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

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) = ${valid.value.toLowerCase()}`,
        // Their own name is not a clash — this runs again on submit, and on a
        // re-run it would otherwise report the member's own name as taken.
        ne(users.id, me.id),
        isNotNull(users.username),
      ),
    )
    .limit(1);

  return taken ? { available: false, error: "Already taken." } : { available: true };
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
