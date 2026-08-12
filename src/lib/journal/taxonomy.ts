/**
 * The mistake taxonomy.
 *
 * Four categories, each costed in R so the leaks can be ranked by what they
 * actually cost rather than by how bad they feel. Ids are stable strings —
 * renaming a label is safe, renaming an id orphans historical annotations.
 */

export type MistakeCategory = {
  id: "entry" | "exit" | "sizing" | "discipline";
  label: string;
  hint: string;
  items: Array<{ id: string; label: string }>;
};

export const MISTAKE_CATEGORIES: MistakeCategory[] = [
  {
    id: "entry",
    label: "Entry",
    hint: "Usually the most frequent, and the easiest to fix once you can see its size in R.",
    items: [
      { id: "entry.chased", label: "Chased the entry" },
      { id: "entry.early", label: "Entered early" },
      { id: "entry.no_confirmation", label: "No confirmation" },
      { id: "entry.fomo", label: "FOMO" },
      { id: "entry.wrong_level", label: "Wrong level" },
      { id: "entry.no_setup", label: "No setup at all" },
    ],
  },
  {
    id: "exit",
    label: "Exit",
    hint: "Typically the most expensive category, and the hardest to see without the data.",
    items: [
      { id: "exit.cut_winner_early", label: "Cut a winner early" },
      { id: "exit.held_loser", label: "Held a loser" },
      { id: "exit.moved_stop", label: "Moved the stop" },
      { id: "exit.no_target", label: "No target set" },
      { id: "exit.exited_on_noise", label: "Exited on noise" },
      { id: "exit.missed_target", label: "Let a target slip" },
    ],
  },
  {
    id: "sizing",
    label: "Sizing & risk",
    hint: "Individually rare, occasionally catastrophic. Worth tracking even at a few a year.",
    items: [
      { id: "sizing.oversized", label: "Oversized" },
      { id: "sizing.doubled_down", label: "Doubled down" },
      { id: "sizing.revenge_sized", label: "Revenge sized" },
      { id: "sizing.risk_up_after_loss", label: "Risked up after a loss" },
      { id: "sizing.undersized_aplus", label: "Undersized an A+" },
    ],
  },
  {
    id: "discipline",
    label: "Discipline",
    hint: "Where psychology becomes measurable in pounds. Links to your state log.",
    items: [
      { id: "discipline.outside_plan", label: "Traded outside the plan" },
      { id: "discipline.outside_session", label: "Traded outside session" },
      { id: "discipline.overtraded", label: "Overtraded" },
      { id: "discipline.revenge", label: "Revenge trade" },
      { id: "discipline.tilt", label: "Traded on tilt" },
      { id: "discipline.past_limit", label: "Traded past the daily limit" },
    ],
  },
];

export const ALL_MISTAKES = MISTAKE_CATEGORIES.flatMap((c) => c.items);

export function mistakeLabel(id: string): string {
  return ALL_MISTAKES.find((m) => m.id === id)?.label ?? id;
}

export function mistakeCategory(id: string): MistakeCategory["id"] | null {
  const prefix = id.split(".")[0] as MistakeCategory["id"];
  return MISTAKE_CATEGORIES.some((c) => c.id === prefix) ? prefix : null;
}

/**
 * Process grades, deliberately independent of outcome.
 *
 * A well-executed loser is an A. A sloppy winner is a C. Without this
 * separation you unconsciously learn that whatever made money was correct,
 * which is how sound processes get abandoned after two bad trades.
 */
export const PROCESS_GRADES = [
  { id: "A", label: "A", hint: "Executed exactly as planned" },
  { id: "B", label: "B", hint: "Minor deviation, no real cost" },
  { id: "C", label: "C", hint: "Sloppy but within the rules" },
  { id: "D", label: "D", hint: "Broke a rule" },
  { id: "F", label: "F", hint: "Should never have been taken" },
] as const;

export type ProcessGrade = (typeof PROCESS_GRADES)[number]["id"];
