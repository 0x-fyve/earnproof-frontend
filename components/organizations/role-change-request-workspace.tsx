"use client";

import { useState } from "react";
import { RoleChangeRequestForm } from "./role-change-request-form";
import { RoleChangeRequestReviewList } from "./role-change-request-review-list";
import type { OrganizationMember, OrganizationRole } from "@/lib/api/organization-members";
import type { RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";
import {
  approveRoleChangeRequest,
  cancelRoleChangeRequest,
  DuplicateApprovalError,
  DuplicateRoleChangeRequestError,
  InvalidRoleChangeTransitionError,
  listRoleChangeRequests,
  rejectRoleChangeRequest,
  submitRoleChangeRequest,
} from "@/lib/role-change-requests/store";
import { readLastReauthAt, recordReauth } from "@/lib/role-change-requests/reauth-store";
import { canSubmitNewRequestFor } from "@/lib/validation/role-change-request";

/**
 * Container for #238: wires the request form, the review workspace, and
 * reauthentication for one target member within one organization. The
 * reauth step uses the same Freighter-signature-as-a-timestamp pattern
 * as OrganizationArchivalWorkflow's `reauth()` - see
 * lib/role-change-requests/reauth-store.ts for why this is a disclosed
 * client-local stand-in rather than a real step-up endpoint.
 */
export function RoleChangeRequestWorkspace({
  organizationId,
  member,
  policy,
  currentActorId,
}: {
  organizationId: string;
  member: OrganizationMember;
  policy: RoleApprovalPolicy;
  currentActorId: string;
}) {
  const [requests, setRequests] = useState(() => listRoleChangeRequests(organizationId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauthedAt, setReauthedAt] = useState<string | null>(() => readLastReauthAt(currentActorId));
  const [reauthing, setReauthing] = useState(false);

  function refresh() {
    setRequests(listRoleChangeRequests(organizationId));
  }

  const blockedReason = canSubmitNewRequestFor(member.id, requests)
    ? undefined
    : "A pending role change request already exists for this member.";

  function handleSubmit(input: { proposedRole: OrganizationRole; justification: string }) {
    setError(null);
    setSubmitting(true);
    try {
      submitRoleChangeRequest(organizationId, {
        requesterId: currentActorId,
        targetMemberId: member.id,
        oldRole: member.role,
        proposedRole: input.proposedRole,
        justification: input.justification,
        validityHours: policy.requestValidityHours,
      });
      refresh();
    } catch (err) {
      setError(
        err instanceof DuplicateRoleChangeRequestError
          ? err.message
          : "Could not submit the request. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleApprove(requestId: string) {
    setError(null);
    try {
      approveRoleChangeRequest(organizationId, requestId, currentActorId, policy.approvalsRequired);
      refresh();
    } catch (err) {
      setError(
        err instanceof DuplicateApprovalError || err instanceof InvalidRoleChangeTransitionError
          ? err.message
          : "Could not record this approval. Try again.",
      );
    }
  }

  function handleReject(requestId: string, reason?: string) {
    setError(null);
    try {
      rejectRoleChangeRequest(organizationId, requestId, currentActorId, reason);
      refresh();
    } catch {
      setError("Could not reject this request. Try again.");
    }
  }

  function handleCancel(requestId: string) {
    setError(null);
    try {
      cancelRoleChangeRequest(organizationId, requestId, currentActorId);
      refresh();
    } catch {
      setError("Could not cancel this request. Try again.");
    }
  }

  async function handleRequestReauth() {
    setReauthing(true);
    setError(null);
    try {
      const freighter = await import("@stellar/freighter-api");
      const access = await freighter.requestAccess().catch(() => null);
      const walletAddress = access?.address ?? (await freighter.getAddress().catch(() => null))?.address ?? null;

      if (!walletAddress) {
        setError("Freighter was not found or did not return a Stellar address.");
        return;
      }

      setReauthedAt(recordReauth(currentActorId));
    } catch {
      setError("Re-authentication failed. Try again.");
    } finally {
      setReauthing(false);
    }
  }

  return (
    <div className="grid gap-6">
      {error && (
        <p className="text-xs text-rose-200" role="alert">
          {error}
        </p>
      )}

      <RoleChangeRequestForm
        member={member}
        onSubmit={handleSubmit}
        submitting={submitting}
        blockedReason={blockedReason}
      />

      <RoleChangeRequestReviewList
        requests={requests.filter((request) => request.targetMemberId === member.id)}
        policy={policy}
        currentActorId={currentActorId}
        reauthedAt={reauthedAt}
        onApprove={handleApprove}
        onReject={handleReject}
        onCancel={handleCancel}
        onRequestReauth={() => void handleRequestReauth()}
      />
      {reauthing && <p className="text-xs text-slate-400">Waiting for wallet confirmation…</p>}
    </div>
  );
}
