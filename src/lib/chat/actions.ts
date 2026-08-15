"use server";

import { revalidatePath } from "next/cache";
import { acceptChatTerms, currentUser } from "@/lib/identity/user";

/**
 * Accept the chat terms.
 *
 * A server action rather than an API route because it is a form submission
 * with no client state to manage, and because the acceptance must be recorded
 * against the session's own user — never a user id posted from the browser.
 */
export async function acceptTermsAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };

  await acceptChatTerms(user.id);
  revalidatePath("/chat");
  return { ok: true };
}
