"use server";

import { revalidatePath } from "next/cache";
import { hasSession } from "@/lib/auth/guard";
import { ingestFeed } from "./ingest";

/**
 * Refresh the wire on demand.
 *
 * The wire refreshes itself on a staleness check, so this is for the moment you
 * want to be certain rather than for routine operation — and it is the only
 * path that REPORTS the provider errors. The automatic refresh swallows them
 * deliberately, because nobody asked; here, someone did.
 */
export type RefreshResult =
  | { ok: true; written: number; pruned: number; errors: string[] }
  | { ok: false; error: string };

export async function refreshWire(): Promise<RefreshResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  try {
    const res = await ingestFeed();
    revalidatePath("/wire");
    revalidatePath("/");
    return {
      ok: true,
      written: res.written,
      pruned: res.pruned,
      errors: res.errors,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
