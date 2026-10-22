import {
  approvalsStillNeeded,
  canApproveOwnRequest,
  canCancelRequest,
  canSubmitNewRequestFor,
  checkApprovalEligibility,
  isReauthRecent,
  isRoleChangeRequestExpired,
  isValidJustification,
  MAX_JUSTIFICATION_LENGTH,
  MIN_JUSTIFICATION_LENGTH,
  RECENT_AUTH_WINDOW_MS,
  roleChangeRequiresApproval,
} from "../role-change-request";
import type { RoleChangeRequest } from "@/lib/role-change-requests/store";
import type { RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function request(overrides: Partial<RoleChangeRequest> = {}): RoleChangeRequest {
  return {
    id: "request-1",
    organizationId: "org-1",
    requesterId: "requester-1",
    targetMemberId: "member-1",
    oldRole: "MEMBER",
    proposedRole: "ADMIN",
    justification: "Needs admin access.",
    state: "pending",
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    approvals: [],
    ...overrides,
  };
}

function policy(overrides: Partial<RoleApprovalPolicy> = {}): RoleApprovalPolicy {
  return {
    schemaVersion: 1,
    policyVersion: 1,
    updatedAt: NOW.toISOString(),
    rules: [
      { role: "OWNER", requiresApproval: true },
      { role: "ADMIN", requiresApproval: true },
      { role: "MEMBER", requiresApproval: false },
      { role: "VIEWER", requiresApproval: false },
    ],
    approvalsRequired: 2,
    requestValidityHours: 72,
    allowSelfApproval: false,
    ...overrides,
  };
}

describe("canApproveOwnRequest", () => {
  it("is always false, regardless of policy", () => {
    expect(canApproveOwnRequest()).toBe(false);
  });
});

describe("isReauthRecent", () => {
  it("is false when there is no recorded reauth", () => {
    expect(isReauthRecent(null, NOW)).toBe(false);
  });

  it("is true within the recency window", () => {
    const reauthedAt = new Date(NOW.getTime() - RECENT_AUTH_WINDOW_MS / 2).toISOString();
    expect(isReauthRecent(reauthedAt, NOW)).toBe(true);
  });

  it("is false once the recency window has elapsed", () => {
    const reauthedAt = new Date(NOW.getTime() - RECENT_AUTH_WINDOW_MS - 1).toISOString();
    expect(isReauthRecent(reauthedAt, NOW)).toBe(false);
  });

  it("is true exactly at the boundary", () => {
    const reauthedAt = new Date(NOW.getTime() - RECENT_AUTH_WINDOW_MS).toISOString();
    expect(isReauthRecent(reauthedAt, NOW)).toBe(true);
  });
});

describe("checkApprovalEligibility", () => {
  const freshReauth = NOW.toISOString();

  it("is eligible for a non-requester with fresh reauth on a pending request", () => {
    expect(checkApprovalEligibility(request(), "approver-1", freshReauth, NOW)).toEqual({ eligible: true });
  });

  it("denies self-approval even with fresh reauth", () => {
    expect(checkApprovalEligibility(request(), "requester-1", freshReauth, NOW)).toEqual({
      eligible: false,
      reason: "is-requester",
    });
  });

  it("requires reauth before the requester check would even matter - reauth still gates a non-requester", () => {
    expect(checkApprovalEligibility(request(), "approver-1", null, NOW)).toEqual({
      eligible: false,
      reason: "reauth-required",
    });
  });

  it("denies acting on an already-decided request", () => {
    expect(checkApprovalEligibility(request({ state: "approved" }), "approver-1", freshReauth, NOW)).toEqual({
      eligible: false,
      reason: "already-decided",
    });
    expect(checkApprovalEligibility(request({ state: "rejected" }), "approver-1", freshReauth, NOW)).toEqual({
      eligible: false,
      reason: "already-decided",
    });
    expect(checkApprovalEligibility(request({ state: "cancelled" }), "approver-1", freshReauth, NOW)).toEqual({
      eligible: false,
      reason: "already-decided",
    });
  });

  it("denies acting on an expired request with its own reason", () => {
    expect(checkApprovalEligibility(request({ state: "expired" }), "approver-1", freshReauth, NOW)).toEqual({
      eligible: false,
      reason: "not-pending",
    });
  });
});

describe("isRoleChangeRequestExpired", () => {
  it("is false before expiresAt", () => {
    expect(isRoleChangeRequestExpired(request(), NOW)).toBe(false);
  });

  it("is true at or after expiresAt", () => {
    const expired = request({ expiresAt: NOW.toISOString() });
    expect(isRoleChangeRequestExpired(expired, NOW)).toBe(true);
  });
});

describe("canSubmitNewRequestFor", () => {
  it("allows submission when there are no existing requests", () => {
    expect(canSubmitNewRequestFor("member-1", [], NOW)).toBe(true);
  });

  it("blocks submission when a pending, non-expired request exists for the member", () => {
    expect(canSubmitNewRequestFor("member-1", [request()], NOW)).toBe(false);
  });

  it("allows submission when the existing request for the member has expired", () => {
    const expired = request({ expiresAt: NOW.toISOString() });
    expect(canSubmitNewRequestFor("member-1", [expired], NOW)).toBe(true);
  });

  it("allows submission when the existing request is for a different member", () => {
    expect(canSubmitNewRequestFor("member-2", [request()], NOW)).toBe(true);
  });

  it("allows submission when the existing request for the member is already decided", () => {
    expect(canSubmitNewRequestFor("member-1", [request({ state: "rejected" })], NOW)).toBe(true);
  });
});

describe("canCancelRequest", () => {
  it("allows the requester to cancel their own pending request", () => {
    expect(canCancelRequest(request(), "requester-1")).toBe(true);
  });

  it("forbids a different actor from cancelling someone else's request", () => {
    expect(canCancelRequest(request(), "someone-else")).toBe(false);
  });

  it("forbids cancelling a non-pending request", () => {
    expect(canCancelRequest(request({ state: "approved" }), "requester-1")).toBe(false);
  });
});

describe("approvalsStillNeeded", () => {
  it("reports the full count needed when there are no approvals yet", () => {
    expect(approvalsStillNeeded(request(), policy({ approvalsRequired: 2 }))).toBe(2);
  });

  it("reports the remaining count after a partial approval", () => {
    const partial = request({ approvals: [{ approverId: "approver-1", decidedAt: NOW.toISOString() }] });
    expect(approvalsStillNeeded(partial, policy({ approvalsRequired: 2 }))).toBe(1);
  });

  it("never reports a negative remaining count", () => {
    const overApproved = request({
      approvals: [
        { approverId: "approver-1", decidedAt: NOW.toISOString() },
        { approverId: "approver-2", decidedAt: NOW.toISOString() },
      ],
    });
    expect(approvalsStillNeeded(overApproved, policy({ approvalsRequired: 1 }))).toBe(0);
  });
});

describe("roleChangeRequiresApproval", () => {
  it("is true for a role the policy marks as requiring approval", () => {
    expect(roleChangeRequiresApproval("ADMIN", policy())).toBe(true);
  });

  it("is false for a role the policy marks as not requiring approval", () => {
    expect(roleChangeRequiresApproval("MEMBER", policy())).toBe(false);
  });

  it("is false for a role with no rule in the policy at all", () => {
    expect(roleChangeRequiresApproval("SOME_UNKNOWN_ROLE", policy())).toBe(false);
  });
});

describe("isValidJustification", () => {
  it("rejects a justification shorter than the minimum", () => {
    expect(isValidJustification("too short")).toBe(false);
    expect(isValidJustification("x".repeat(MIN_JUSTIFICATION_LENGTH - 1))).toBe(false);
  });

  it("accepts a justification at the minimum length", () => {
    expect(isValidJustification("x".repeat(MIN_JUSTIFICATION_LENGTH))).toBe(true);
  });

  it("accepts a justification at the maximum length", () => {
    expect(isValidJustification("x".repeat(MAX_JUSTIFICATION_LENGTH))).toBe(true);
  });

  it("rejects a justification over the maximum length", () => {
    expect(isValidJustification("x".repeat(MAX_JUSTIFICATION_LENGTH + 1))).toBe(false);
  });

  it("trims whitespace before checking length", () => {
    expect(isValidJustification(`   ${"x".repeat(MIN_JUSTIFICATION_LENGTH)}   `)).toBe(true);
    expect(isValidJustification("   short   ")).toBe(false);
  });
});
