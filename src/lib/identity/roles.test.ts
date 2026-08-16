import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignableRoles,
  canActOn,
  canAssignRole,
  canManageRoles,
  canModerate,
  canOpenDashboard,
  canPostToChat,
  canReadChat,
  describeStanding,
  isBanned,
  isSuspended,
  type Role,
} from "./roles";

/**
 * The permission core.
 *
 * Every rule that could hand someone power they should not have is asserted
 * here, including the ones that look obviously true — "an admin cannot ban the
 * owner" is exactly the kind of thing a refactor breaks silently.
 */

const owner = { id: 1, role: "admin" as Role, isOwner: true };
const admin = { id: 2, role: "admin" as Role, isOwner: false };
const admin2 = { id: 3, role: "admin" as Role, isOwner: false };
const staff = { id: 4, role: "staff" as Role, isOwner: false };
const mod = { id: 5, role: "moderator" as Role, isOwner: false };
const member = { id: 6, role: "member" as Role, isOwner: false };

const NOW = new Date("2026-08-16T12:00:00Z");
const DAY = 86_400_000;

describe("dashboard access", () => {
  it("is open to moderators and above", () => {
    for (const a of [owner, admin, staff, mod]) {
      assert.equal(canOpenDashboard(a), true, `${a.role} should get in`);
    }
  });

  it("is closed to ordinary members", () => {
    assert.equal(canOpenDashboard(member), false);
  });
});

describe("role management", () => {
  it("is limited to owner and admin", () => {
    assert.equal(canManageRoles(owner), true);
    assert.equal(canManageRoles(admin), true);
    assert.equal(canManageRoles(staff), false);
    assert.equal(canManageRoles(mod), false);
    assert.equal(canManageRoles(member), false);
  });

  it("lets only the owner create admins", () => {
    // Otherwise the first admin appointed can appoint more, and the owner's
    // control over the top of the tree lasts exactly one appointment.
    assert.ok(assignableRoles(owner).includes("admin"));
    assert.ok(!assignableRoles(admin).includes("admin"));
  });

  it("lets an admin assign everything below admin", () => {
    assert.deepEqual(assignableRoles(admin).sort(), ["member", "moderator", "staff"]);
  });

  it("gives a moderator nothing to assign", () => {
    assert.deepEqual(assignableRoles(mod), []);
  });

  it("refuses to promote someone to a rank the actor cannot reach", () => {
    assert.equal(canAssignRole(admin, member, "admin"), false);
    assert.equal(canAssignRole(owner, member, "admin"), true);
  });
});

describe("acting on another person", () => {
  it("allows acting strictly downward", () => {
    assert.equal(canActOn(owner, admin), true);
    assert.equal(canActOn(admin, staff), true);
    assert.equal(canActOn(staff, mod), true);
    assert.equal(canActOn(mod, member), true);
  });

  it("refuses acting upward", () => {
    assert.equal(canActOn(member, mod), false);
    assert.equal(canActOn(mod, staff), false);
    assert.equal(canActOn(staff, admin), false);
    assert.equal(canActOn(admin, owner), false);
  });

  it("refuses acting on an equal, so two admins cannot race each other", () => {
    assert.equal(canActOn(admin, admin2), false);
    assert.equal(canActOn(admin2, admin), false);
  });

  it("makes the owner unreachable by anyone", () => {
    for (const a of [admin, staff, mod, member]) {
      assert.equal(canActOn(a, owner), false, `${a.role} must not touch the owner`);
    }
  });

  it("refuses acting on yourself", () => {
    // The accidental self-ban is real, and there is nobody above the owner to
    // undo it.
    assert.equal(canActOn(admin, admin), false);
    assert.equal(canActOn(owner, owner), false);
  });

  it("cannot be bypassed by an owner flag on the target's role field", () => {
    // A member row carrying role "admin" is still below a real admin only by
    // rank; the owner flag is what confers immunity, and it is derived from a
    // reserved external id, never assigned.
    const impostor = { id: 9, role: "admin" as Role, isOwner: false };
    assert.equal(canActOn(impostor, owner), false);
  });
});

describe("standing", () => {
  const active = { status: "active" as const, suspendedUntil: null };
  const banned = { status: "banned" as const, suspendedUntil: null };
  const suspended = {
    status: "suspended" as const,
    suspendedUntil: new Date(NOW.getTime() + 3 * DAY),
  };
  const expired = {
    status: "suspended" as const,
    suspendedUntil: new Date(NOW.getTime() - DAY),
  };
  const indefinite = { status: "suspended" as const, suspendedUntil: null };

  it("lets an active member read and post", () => {
    assert.equal(canReadChat(active, NOW), true);
    assert.equal(canPostToChat(active, NOW), true);
  });

  it("stops a banned member entirely", () => {
    assert.equal(isBanned(banned), true);
    assert.equal(canReadChat(banned, NOW), false);
    assert.equal(canPostToChat(banned, NOW), false);
  });

  it("lets a suspended member read but not post", () => {
    assert.equal(canReadChat(suspended, NOW), true);
    assert.equal(canPostToChat(suspended, NOW), false);
  });

  it("expires a suspension by date, with no job needed to clear it", () => {
    assert.equal(isSuspended(expired, NOW), false);
    assert.equal(canPostToChat(expired, NOW), true);
  });

  it("treats a suspension with no end date as indefinite", () => {
    // A missing value must read as "still suspended", never as "free to post".
    assert.equal(isSuspended(indefinite, NOW), true);
    assert.equal(canPostToChat(indefinite, NOW), false);
  });

  it("describes standing in words a person can act on", () => {
    assert.equal(describeStanding(active, NOW), "Active");
    assert.equal(describeStanding(banned, NOW), "Banned");
    assert.equal(describeStanding(indefinite, NOW), "Suspended indefinitely");
    assert.match(describeStanding(suspended, NOW), /^Suspended until 19 Aug 2026$/);
    // An expired suspension is not a state worth showing.
    assert.equal(describeStanding(expired, NOW), "Active");
  });
});
