/**
 * Who may do what.
 *
 * Pure functions, no database, no `server-only` — so every rule is directly
 * testable and the same logic decides both what the dashboard renders and what
 * the server actions permit. A capability that existed only in the UI would be
 * a suggestion.
 *
 * ── Rank, not a permission matrix ─────────────────────────────────────────
 * A matrix of role × action is the flexible design and the wrong one here.
 * Almost every question in a moderation tool is "may A act on B", and with a
 * matrix that question has no answer — you end up writing the ordering anyway,
 * in ad-hoc comparisons scattered across call sites. One ordering, checked in
 * one place, is what stops a moderator quietly demoting an admin.
 */

export const ROLES = ["member", "moderator", "staff", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The owner is not a role, it is the account that owns the deployment.
 *
 * Kept out of the enum deliberately: a role can be granted, and this one never
 * can be. It is derived from the reserved external id, so there is no query
 * that could accidentally hand it to somebody.
 */
export type Rank = number;

const ROLE_RANK: Record<Role, Rank> = {
  member: 0,
  moderator: 1,
  staff: 2,
  admin: 3,
};

export const OWNER_RANK = 4;

export type Actor = {
  id: number;
  role: Role;
  isOwner: boolean;
};

export function rankOf(u: { role: Role; isOwner: boolean }): Rank {
  return u.isOwner ? OWNER_RANK : ROLE_RANK[u.role];
}

export const ROLE_LABEL: Record<Role, string> = {
  member: "Member",
  moderator: "Moderator",
  staff: "Staff",
  admin: "Admin",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  member: "Can read and post in chat.",
  moderator: "Can remove messages, and suspend or ban members.",
  staff: "Moderator powers, plus the full member list.",
  admin: "Everything except removing the owner. Can assign roles.",
};

/* -------------------------------------------------------------------------- */
/* Capabilities                                                                */
/* -------------------------------------------------------------------------- */

/** May this person open the admin dashboard at all? */
export function canOpenDashboard(actor: Actor): boolean {
  return rankOf(actor) >= ROLE_RANK.moderator;
}

/** May they grant and revoke roles? Owner and admin only. */
export function canManageRoles(actor: Actor): boolean {
  return rankOf(actor) >= ROLE_RANK.admin;
}

/** May they suspend, ban and remove messages? */
export function canModerate(actor: Actor): boolean {
  return rankOf(actor) >= ROLE_RANK.moderator;
}

export type Target = {
  id: number;
  role: Role;
  isOwner: boolean;
};

/**
 * The rule that carries the weight: you may only act on someone BELOW you.
 *
 * Strictly below, not below-or-equal. Two admins who can sanction each other
 * turn a disagreement into a race, and the owner must be unreachable by
 * anybody — including an admin they appointed and later fell out with.
 *
 * Acting on yourself is refused for the same reason a surgeon does not operate
 * on themselves: the accidental self-ban is a real failure mode, and there is
 * no one above the owner to undo it.
 */
export function canActOn(actor: Actor, target: Target): boolean {
  if (actor.id === target.id) return false;
  if (target.isOwner) return false;
  return rankOf(actor) > rankOf(target);
}

/**
 * Which roles may this actor hand out?
 *
 * Strictly below their own, so an admin cannot mint a peer. Only the owner can
 * create admins — otherwise the first admin appointed can appoint others, and
 * the owner's control over the top of the tree lasts exactly one appointment.
 */
export function assignableRoles(actor: Actor): Role[] {
  if (!canManageRoles(actor)) return [];
  const limit = rankOf(actor);
  return ROLES.filter((r) => ROLE_RANK[r] < limit);
}

export function canAssignRole(actor: Actor, target: Target, role: Role): boolean {
  if (!canManageRoles(actor)) return false;
  if (!canActOn(actor, target)) return false;
  return assignableRoles(actor).includes(role);
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export const USER_STATUSES = ["active", "suspended", "banned"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export type Standing = {
  status: UserStatus;
  suspendedUntil: Date | null;
};

/**
 * Is a suspension still running?
 *
 * A suspension is stored with an end date rather than being cleared by a job:
 * there is no scheduler here, and one that failed silently would leave people
 * suspended indefinitely with nothing showing why. Deriving it from the date
 * means the answer is right even if nothing ever runs.
 */
export function isSuspended(s: Standing, now: Date = new Date()): boolean {
  if (s.status !== "suspended") return false;
  // No end date means indefinite, which is the safe reading of a missing value.
  if (!s.suspendedUntil) return true;
  return s.suspendedUntil.getTime() > now.getTime();
}

export function isBanned(s: Standing): boolean {
  return s.status === "banned";
}

/** Banned: no chat at all. Suspended: may read, may not post. */
export function canReadChat(s: Standing, now: Date = new Date()): boolean {
  return !isBanned(s);
}

export function canPostToChat(s: Standing, now: Date = new Date()): boolean {
  return !isBanned(s) && !isSuspended(s, now);
}

/** Human-readable standing, for the dashboard and for the member's own notice. */
export function describeStanding(s: Standing, now: Date = new Date()): string {
  if (isBanned(s)) return "Banned";
  if (isSuspended(s, now)) {
    if (!s.suspendedUntil) return "Suspended indefinitely";
    return `Suspended until ${s.suspendedUntil.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    })}`;
  }
  // An expired suspension is not a state anyone needs to see.
  return "Active";
}
