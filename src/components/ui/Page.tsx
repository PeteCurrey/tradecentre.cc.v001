import Link from "next/link";
import type { ReactNode } from "react";
import { PlugZap } from "lucide-react";
import { clsx } from "@/lib/clsx";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="display text-[1.75rem]">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--color-ink-mute)]">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Shown wherever a screen needs broker data that isn't connected yet.
 *
 * Deliberately not filled with sample numbers: plausible-looking fake P&L in a
 * trading dashboard is worse than an empty screen, because it is impossible to
 * tell at a glance whether what you're reading is real.
 */
export function NotConnected({
  what,
  className,
}: {
  what: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-tile)] border border-dashed border-[var(--color-line-strong)] px-6 py-10 text-center",
        className,
      )}
    >
      <PlugZap className="size-5 text-[var(--color-ink-faint)]" />
      <p className="max-w-sm text-sm text-[var(--color-ink-mute)]">
        {what} will appear here once your OANDA accounts are connected.
      </p>
      <Link
        href="/settings"
        className="rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-wash)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-black"
      >
        Connect accounts
      </Link>
    </div>
  );
}

/** Placeholder for screens not yet built, so navigation is never a dead end. */
export function ComingSoon({ phase, describes }: { phase: string; describes: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-1 label-faint">
        {phase}
      </span>
      <p className="max-w-md text-sm text-[var(--color-ink-mute)]">{describes}</p>
    </div>
  );
}
