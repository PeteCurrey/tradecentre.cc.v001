import "server-only";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { currentUser, type CurrentUser } from "./user";

/**
 * Tenancy helpers.
 *
 * Every trading table except `accounts` keys on `accountId`, so "belongs to
 * this member" is expressed once here as a subquery and reused, rather than
 * being spelled out at each of the dozen call sites where getting it wrong
 * means showing one member another's ledger.
 *
 * The shape is deliberate: these return values you must PASS to a query. There
 * is no helper that runs an unscoped query for you, because the failure mode
 * worth designing against is not "someone wrote the wrong filter" — it is
 * "someone forgot there was a filter to write".
 */

/**
 * The signed-in member, or a 404.
 *
 * 404 rather than a redirect: these are data-path calls behind `requireSession`,
 * so reaching one without a user means the session resolved to a row that no
 * longer exists. Rendering "not found" is honest; bouncing to login would loop.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) notFound();
  return user;
}

/**
 * Account ids belonging to this member, as a subquery.
 *
 * Returned as a subquery rather than an awaited array on purpose: the database
 * does the join, so a member with many accounts does not turn into an
 * ever-growing `IN (...)` list, and there is no window where the ids are stale
 * relative to the rows being filtered.
 *
 * Use with `inArray(trades.accountId, ownedAccountIds(user.id))`.
 */
export function ownedAccountIds(userId: number) {
  return db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId));
}
