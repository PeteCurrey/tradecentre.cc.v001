import { clsx } from "@/lib/clsx";

/**
 * Money is the ONLY thing allowed to be green or red in this interface.
 *
 * Because the semantics never vary, a red number is unambiguous at a glance —
 * it always means "this lost money", never "this is selected" or "this is a
 * warning". Use the orange accent for interface state instead.
 */

type MoneyProps = {
  value: number;
  currency?: string;
  /** Show an explicit + on positives. Default true — the sign is information. */
  signed?: boolean;
  /** Render flat (grey) when exactly zero rather than green. Default true. */
  flatOnZero?: boolean;
  decimals?: number;
  className?: string;
};

export function Money({
  value,
  currency = "GBP",
  signed = true,
  flatOnZero = true,
  decimals = 2,
  className,
}: MoneyProps) {
  const tone =
    value > 0 ? "money-up" : value < 0 ? "money-down" : flatOnZero ? "money-flat" : "money-up";

  const formatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value);

  return <span className={clsx("figure", tone, className)}>{formatted}</span>;
}

/**
 * R-multiples. Same colour rule as cash — R *is* money, just normalised.
 * This is the primary unit across the app: comparable across books and
 * instruments in a way cash never is.
 */
export function RMultiple({
  value,
  decimals = 2,
  className,
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const tone = value > 0 ? "money-up" : value < 0 ? "money-down" : "money-flat";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={clsx("figure", tone, className)}>
      {sign}
      {value.toFixed(decimals)}R
    </span>
  );
}

/** Percentage change. Money semantics, so same colour rule. */
export function Pct({
  value,
  decimals = 2,
  className,
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const tone = value > 0 ? "money-up" : value < 0 ? "money-down" : "money-flat";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={clsx("figure", tone, className)}>
      {sign}
      {value.toFixed(decimals)}%
    </span>
  );
}
