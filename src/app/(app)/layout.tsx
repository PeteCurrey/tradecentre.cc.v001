import { AppShell } from "@/components/AppShell";
import { currentUser } from "@/lib/identity/user";
import { canOpenDashboard } from "@/lib/identity/roles";

/**
 * Resolved here rather than in the shell because the shell is a client
 * component and this needs the session. It only decides whether the Admin link
 * is DRAWN — /admin does its own check and 404s regardless.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await currentUser();
  const privileged = me ? canOpenDashboard(me) : false;
  return <AppShell privileged={privileged}>{children}</AppShell>;
}
