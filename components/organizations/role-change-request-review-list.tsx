"use client";

import { useState } from "react";
import type { RoleChangeRequest } from "@/lib/role-change-requests/store";
import type { RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";
import { formatOrganizationRole, isOrganizationMemberRole } from "@/lib/api/organization-members";
import {
  approvalsStillNeeded,
  canCancelRequest,
  checkApprovalEligibility,
  type ApprovalEligibility,
} from "@/lib/validation/role-change-request";
import { formatDateTime } from "@/lib/i18n";

const STATE_STYLES: Record<RoleChangeRequest["state"], { badge: string; label: string }> = {
  pending: { badge: "bg-amber-500/20 text-amber-200 border border-amber-400/40", label: "Pending" },
  approved: { badge: "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40", label: "Approved" },
  rejected: { badge: "bg-rose-500/20 text-rose-200 border border-rose-400/40", label: "Rejected" },
  cancelled: { badge: "bg-slate-500/20 text-slate-300 border border-slate-400/40", label: "Cancelled" },
  expired: { badge: "bg-slate-500/20 text-slate-300 border border-slate-400/40", label: "Expired" },
};

const ELIGIBILITY_MESSAGES: Record<Exclude<ApprovalEligibility, { eligible: true }>["reason"], string> = {
  "is-requester": "You cannot approve or reject your own request.",
  "already-decided": "This request has already been decided.",
  "not-pending": "This request is no longer pending.",
  "reauth-required": "Re-authenticate to approve or reject this request.",
};

/**
 * #238's review workspace: lists requests across every state (pending,
 * approved, rejected, cancelled, expired) with requester, target member,
 * old/proposed roles, justification, and recorded approvals always
 * visible (not just to eligible approvers), and gates the approve/reject
 * actions themselves behind checkApprovalEligibility - which is what
 * denies self-approval and stale/already-decided requests, and requires
 * a fresh reauth.
 */
export function RoleChangeRequestReviewList({
  requests,
  policy,
  currentActorId,
  reauthedAt,
  onApprove,
  onReject,
  onCancel,
  onRequestReauth,
}: {
  requests: RoleChangeRequest[];
  policy: RoleApprovalPolicy;
  currentActorId: string;
  reauthedAt: string | null;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string, reason?: string) => void;
  onCancel: (requestId: string) => void;
  onRequestReauth: () => void;
}) {
  const [actingOn, setActingOn] = useState<string | null>(null);

  if (requests.length === 0) {
    return <p className="text-sm text-slate-400">No role change requests have been submitted.</p>;
  }

  function runAction(requestId: string, action: () => void) {
    setActingOn(requestId);
    try {
      action();
    } finally {
      setActingOn(null);
    }
  }

  return (
    <ul className="grid gap-4">
      {requests.map((request) => {
        const style = STATE_STYLES[request.state];
        const eligibility = checkApprovalEligibility(request, currentActorId, reauthedAt);
        const needed = approvalsStillNeeded(request, policy);
        const busy = actingOn === request.id;
        const showCancel = canCancelRequest(request, currentActorId);

        return (
          <li key={request.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span data-testid="request-state-badge" className={`rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>
                {style.label}
              </span>
              <span className="text-xs text-slate-400">{formatDateTime(request.createdAt)}</span>
            </div>

            <dl className="mt-3 grid gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-slate-400">Requester:</dt>
                <dd className="text-white">{request.requesterId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-400">Target member:</dt>
                <dd className="text-white">{request.targetMemberId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-400">Role change:</dt>
                <dd className="text-white">
                  {formatRole(request.oldRole)} <span aria-hidden="true">→</span>{" "}
                  <span className="sr-only">to</span> {formatRole(request.proposedRole)}
                </dd>
              </div>
            </dl>

            <p className="mt-2 text-sm leading-6 text-slate-300">{request.justification}</p>

            {request.state === "pending" && (
              <p className="mt-2 text-xs text-slate-400">
                {request.approvals.length} of {policy.approvalsRequired} independent approval(s) recorded
                {needed > 0 ? ` - ${needed} more needed` : ""}.
              </p>
            )}

            {request.state === "rejected" && request.rejection?.reason && (
              <p className="mt-2 text-xs text-rose-200">Rejection reason: {request.rejection.reason}</p>
            )}

            {request.state === "pending" && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {eligibility.eligible ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(request.id, () => onApprove(request.id))}
                      className="h-8 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(request.id, () => onReject(request.id))}
                      className="h-8 rounded-md border border-rose-400/40 px-3 text-xs font-medium text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                ) : eligibility.reason === "reauth-required" ? (
                  <>
                    <span className="text-xs text-amber-200">{ELIGIBILITY_MESSAGES[eligibility.reason]}</span>
                    <button
                      type="button"
                      onClick={onRequestReauth}
                      className="h-8 rounded-md border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5"
                    >
                      Re-authenticate
                    </button>
                  </>
                ) : eligibility.reason === "is-requester" ? (
                  <span className="text-xs text-slate-400">{ELIGIBILITY_MESSAGES[eligibility.reason]}</span>
                ) : null}

                {showCancel && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(request.id, () => onCancel(request.id))}
                    className="h-8 rounded-md border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 disabled:opacity-50"
                  >
                    Cancel request
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `oldRole`/`proposedRole` are stored as plain strings (see
 * lib/role-change-requests/store.ts's RoleChangeRequest) because a
 * request predates and outlives any single typed role enum; this
 * renders through formatOrganizationRole only for a role an actual
 * member can hold, falling back to the raw value for anything else
 * (e.g. a policy-only role like VIEWER - see
 * lib/api/organization-role-approval-policy.ts's wider ORGANIZATION_ROLES)
 * rather than mislabeling it.
 */
function formatRole(role: string): string {
  return isOrganizationMemberRole(role) ? formatOrganizationRole(role) : role;
}
