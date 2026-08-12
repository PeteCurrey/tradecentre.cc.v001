/** Minimal class joiner — avoids a dependency for something this small. */
export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
