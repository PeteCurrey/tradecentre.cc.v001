import type { ReactNode } from "react";
import { clsx } from "@/lib/clsx";

export function Card({
  children,
  className,
  hero = false,
}: {
  children: ReactNode;
  className?: string;
  /** Hero panels get the reference's faint top sheen. Use sparingly. */
  hero?: boolean;
}) {
  return (
    <section className={clsx("card", hero && "card-hero", className)}>{children}</section>
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("flex items-center justify-between gap-3", className)}>
      <h2 className="label">{title}</h2>
      {action}
    </header>
  );
}

/**
 * The reference's small icon-labelled stat grid ("Mode / Time / Frequency…").
 * Dense by design — this is where most of the screen's information lives.
 */
export function StatTile({
  label,
  value,
  sub,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("card-sunken px-3 py-2.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="label-faint">{label}</span>
        {icon ? <span className="text-[var(--color-ink-mute)]">{icon}</span> : null}
      </div>
      <div className="mt-1.5 figure text-[var(--text-figure)] leading-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--color-ink-mute)]">{sub}</div> : null}
    </div>
  );
}
