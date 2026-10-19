import type { RoleChangeRequest } from "@/lib/role-change-requests/store";
import type { RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";

/**
 * How long a completed reauthentication stays "fresh" before an approval
 * or rejection decision requires another one. Mirrors
 * lib/validation/organization-archival.ts's RECENT_AUTH_WINDOW_MS - same
 * client-side stand-in for a server-side step-up/reauth window, kept as
 * its own constant here (rather than imported across domains) since the
 * two features' recency windows are independent product decisions that
 * happen to currently share a default.
 */
export const RECENT_AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function isReauthRecent(reauthedAt: string | null, now: Date = new Date()): boolean {
  if (!reauthedAt) {
    return false;
  }
  return now.getTime() - new Date(reauthedAt).getTime() <= RECENT_AUTH_WINDOW_MS;
}

/**
 * #238 acceptance criterion: "Users cannot approve their own request
 * when independent approval is required." A request's requester is
 * never an eligible approver for it, full stop - this does not depend
 * on policy.allowSelfApproval, which only controls whether a *policy
 * administrator* may configure the org to skip approval review
 * entirely (see lib/api/organization-role-approval-policy.ts's
 * allowSelfApproval), not whether the one person who filed a request
 * may also be the one who signs off on it.
 */
export function canApproveOwnRequest(): boolean {
  return false;
}

export type ApprovalEligibility =
  | { eligible: true }
  | { eligible: false; reason: "is-requester" | "already-decided" | "not-pending" | "reauth-required" };

/**
 * All the gates an approval/rejection action must pass before the store
 * mutation in lib/role-change-requests/store.ts is ever called:
 * the request must still be pending (not stale/already-decided/expired),
 * the actor must not be the requester, and reauthentication must be
 * fresh (#238's "Require recent authentication for approval and
 * rejection actions").
 */
export function checkApprovalEligibility(
  request: RoleChangeRequest,
  approverId: string,
  reauthedAt: string | null,
  now: Date = new Date(),
): ApprovalEligibility {
  if (request.state !== "pending") {
    return {
      eligible: false,
      reason: request.state === "expired" ? "not-pending" : "already-decided",
    };
  }

  if (request.requesterId === approverId) {
    return { eligible: false, reason: "is-requester" };
  }

  if (!isReauthRecent(reauthedAt, now)) {
    return { eligible: false, reason: "reauth-required" };
  }

  return { eligible: true };
}

export function isRoleChangeRequestExpired(request: RoleChangeRequest, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(request.expiresAt).getTime();
}

/**
 * #238 acceptance criterion: "Stale or already-decided requests cannot
 * be submitted again" - read as a submission-side guard: a brand new
 * request for a member who already has a pending (not yet decided, not
 * yet expired) request must be refused client-side before even calling
 * submitRoleChangeRequest (which independently refuses it too - see its
 * DuplicateRoleChangeRequestError), so the UI can show the reason
 * without relying on a thrown error alone.
 */
export function canSubmitNewRequestFor(
  targetMemberId: string,
  existingRequests: RoleChangeRequest[],
  now: Date = new Date(),
): boolean {
  return !existingRequests.some(
    (request) =>
      request.targetMemberId === targetMemberId &&
      request.state === "pending" &&
      !isRoleChangeRequestExpired(request, now),
  );
}

export function canCancelRequest(request: RoleChangeRequest, actorId: string): boolean {
  return request.state === "pending" && request.requesterId === actorId;
}

/**
 * Number of independent approvals a given request still needs, derived
 * from the organization's role-approval policy rather than hard-coded -
 * so raising/lowering approvalsRequired in the policy panel
 * (components/organizations/role-approval-policy-panel.tsx) takes effect
 * on in-flight requests without this module needing to change.
 */
export function approvalsStillNeeded(request: RoleChangeRequest, policy: RoleApprovalPolicy): number {
  return Math.max(0, policy.approvalsRequired - request.approvals.length);
}

/**
 * Whether the organization's policy requires approval at all for a
 * change into `proposedRole`. When it doesn't, #238's workspace still
 * records the request (for the visible audit trail this issue asks
 * for), but the review UI may offer to apply it immediately rather than
 * waiting on approvals that policy never required.
 */
export function roleChangeRequiresApproval(proposedRole: string, policy: RoleApprovalPolicy): boolean {
  const rule = policy.rules.find((candidate) => candidate.role === proposedRole);
  return rule?.requiresApproval ?? false;
}

export const MAX_JUSTIFICATION_LENGTH = 2000;
export const MIN_JUSTIFICATION_LENGTH = 10;

export function isValidJustification(justification: string): boolean {
  const trimmed = justification.trim();
  return trimmed.length >= MIN_JUSTIFICATION_LENGTH && trimmed.length <= MAX_JUSTIFICATION_LENGTH;
}
