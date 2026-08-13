"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { hasSession } from "@/lib/auth/guard";
import { macroEvents } from "@/lib/db/schema";
import {
  fetchEiaSchedule,
  fetchFredReleases,
  fetchPolymarket,
} from "./sources";

/**
 * Refresh the macro cache.
 *
 * On demand only — there is no scheduler for this, deliberately. A calendar
 * that silently refreshes in the background is a calendar you stop checking
 * the freshness of, and these sources are free enough to pull when wanted.
 *
 * Ids are deterministic per source and date, so refreshing is idempotent: a
 * second refresh updates rows rather than duplicating the week.
 */
export type RefreshResult =
  | { ok: true; inserted: number; errors: string[] }
  | { ok: false; error: string };

export async function refreshMacro(): Promise<RefreshResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in" };

  const [fred, eia, poly] = await Promise.all([
    fetchFredReleases(),
    fetchEiaSchedule(),
    fetchPolymarket(),
  ]);

  const events = [...fred.events, ...eia.events, ...poly.events];
  const errors = [...fred.errors, ...eia.errors, ...poly.errors];

  for (const e of events) {
    await db
      .insert(macroEvents)
      .values({
        id: e.id,
        source: e.source,
        time: e.time,
        country: e.country,
        title: e.title,
        importance: e.importance,
        actual: e.actual,
        forecast: e.forecast,
        previous: e.previous,
        impliedProbability: e.impliedProbability,
        polymarketSlug: e.polymarketSlug,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: macroEvents.id,
        set: {
          time: e.time,
          title: e.title,
          actual: e.actual,
          forecast: e.forecast,
          previous: e.previous,
          impliedProbability: e.impliedProbability,
          fetchedAt: new Date(),
        },
      });
  }

  revalidatePath("/market-context");
  revalidatePath("/pre-market");
  return { ok: true, inserted: events.length, errors };
}
