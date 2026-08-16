import { requireSession } from "@/lib/auth/guard";
import { requireUser } from "@/lib/identity/tenant";
import { getDeskSnapshot } from "@/lib/desk/snapshot";
import { LiveDesk } from "@/components/desk/LiveDesk";
import { WirePanel } from "@/components/feed/WirePanel";

// Broker state, so never cached.
export const dynamic = "force-dynamic";

/**
 * Today / Live Desk — the landing screen.
 *
 * The whole snapshot is fetched server-side for every book at once, then
 * filtered client-side by the account scope. Switching book is therefore
 * instant and costs no extra broker calls.
 */
export default async function TodayPage() {
  await requireSession();
  const user = await requireUser();
  const snapshot = await getDeskSnapshot(user.id);
  return <LiveDesk snapshot={snapshot} wire={<WirePanel />} />;
}
