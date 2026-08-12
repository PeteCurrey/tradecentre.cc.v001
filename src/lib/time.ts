/**
 * Time handling.
 *
 * Rule: every timestamp is stored UTC and rendered Europe/London. The display
 * timezone is a setting, never a storage decision — which is what keeps the
 * day-boundary question (below) a view concern rather than a schema one.
 *
 * ⚠️ Day boundaries: OANDA rolls its trading day at 17:00 New York, which is
 * when financing is charged. London-midnight days therefore will NOT tie
 * exactly to OANDA's daily statement on positions carried overnight. Irrelevant
 * intraday; visible on swing and position books. Both rules are implemented so
 * a view can choose.
 */

export const DISPLAY_TZ = "Europe/London";
export const BROKER_TZ = "America/New_York";
export const BROKER_ROLLOVER_HOUR = 17;

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatTime(d: Date, tz: string = DISPLAY_TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

export function formatDateTime(d: Date, tz: string = DISPLAY_TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

export function formatDate(d: Date, tz: string = DISPLAY_TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).format(d);
}

/** Parts of a date as seen in a given timezone. */
export function partsIn(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour === "24" ? "0" : out.hour),
    minute: Number(out.minute),
    weekday: out.weekday,
  };
}

/** ISO date key (YYYY-MM-DD) as seen in a timezone — the journal's day key. */
export function dayKey(d: Date, tz: string = DISPLAY_TZ): string {
  const p = partsIn(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Day key using the broker's 17:00 New York rollover, so P&L reconciles with
 * OANDA statements. A fill at 18:00 NY belongs to the *next* trading day.
 */
export function brokerDayKey(d: Date): string {
  const p = partsIn(d, BROKER_TZ);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (p.hour >= BROKER_ROLLOVER_HOUR) shifted.setUTCDate(shifted.getUTCDate() + 1);
  return shifted.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export type SessionId = "sydney" | "tokyo" | "london" | "newyork";

export type SessionDef = {
  id: SessionId;
  label: string;
  /** Window in Europe/London hours, [start, end). Wraps past midnight if start > end. */
  startHour: number;
  endHour: number;
};

/**
 * Windows expressed in London time, because that is the frame Peter thinks in.
 * Approximate by design — session edges are a convention, not a fact, and
 * shifting them by an hour changes no conclusion worth drawing.
 */
export const SESSIONS: SessionDef[] = [
  { id: "sydney", label: "Sydney", startHour: 22, endHour: 7 },
  { id: "tokyo", label: "Tokyo", startHour: 0, endHour: 9 },
  { id: "london", label: "London", startHour: 8, endHour: 17 },
  { id: "newyork", label: "New York", startHour: 13, endHour: 22 },
];

export function isSessionOpen(session: SessionDef, at: Date = new Date()): boolean {
  const { hour, weekday } = partsIn(at, DISPLAY_TZ);
  // FX is closed from Friday evening to Sunday evening.
  if (weekday === "Sat") return false;
  if (weekday === "Sun" && hour < 22) return false;
  if (weekday === "Fri" && hour >= 22) return false;

  return session.startHour <= session.endHour
    ? hour >= session.startHour && hour < session.endHour
    : hour >= session.startHour || hour < session.endHour;
}

export function activeSessions(at: Date = new Date()): SessionDef[] {
  return SESSIONS.filter((s) => isSessionOpen(s, at));
}

/** True during the London/New York overlap — typically the highest-volume window. */
export function isPrimeOverlap(at: Date = new Date()): boolean {
  const open = new Set(activeSessions(at).map((s) => s.id));
  return open.has("london") && open.has("newyork");
}
