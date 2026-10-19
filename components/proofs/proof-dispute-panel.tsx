"use client";

import { useState } from "react";
import { ProofDisputeSubmissionForm } from "./proof-dispute-submission-form";
import { ProofDisputeReviewPanel } from "./proof-dispute-review-panel";
import {
  acceptDispute,
  listDisputes,
  rejectDispute,
  resolveDispute,
  submitDispute,
  withdrawDispute,
  DuplicateDisputeError,
  type DisputeCategory,
} from "@/lib/proof-disputes/store";
import { canSubmitDispute, type DisputeActorRole } from "@/lib/validation/proof-dispute";

/**
 * Container for #234: wires the bounded-category submission form to the
 * client-local dispute store (see lib/proof-disputes/store.ts for why
 * there is no backend call here, and why it is namespaced by `proofId`
 * rather than by the current actor) and the review panel, scoped to
 * one proof. `currentActorId` is distinct from role: it identifies
 * *who* is acting (so withdraw can be restricted to the original
 * disputant), while `currentActorRole` gates *what kind* of actor they
 * are (lib/validation/proof-dispute.ts's canSubmitDispute/canReviewDispute).
 */
export function ProofDisputePanel({
  proofId,
  currentActorId,
  currentActorRole,
}: {
  proofId: string;
  currentActorId: string;
  currentActorRole: DisputeActorRole;
}) {
  const [disputes, setDisputes] = useState(() => listDisputes(proofId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setDisputes(listDisputes(proofId));
  }

  function handleSubmit(input: { category: DisputeCategory; evidenceCommitment: string; note?: string }) {
    setError(null);
    setSubmitting(true);
    try {
      submitDispute(currentActorId, { proofId, ...input });
      refresh();
    } catch (err) {
      setError(err instanceof DuplicateDisputeError ? err.message : "Could not submit the dispute. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleWithdraw(disputeId: string) {
    setError(null);
    try {
      withdrawDispute(proofId, disputeId, currentActorId);
      refresh();
    } catch {
      setError("Could not withdraw this dispute. Try again.");
    }
  }

  function handleAccept(disputeId: string) {
    setError(null);
    try {
      acceptDispute(proofId, disputeId, currentActorId);
      refresh();
    } catch {
      setError("Could not accept this dispute. Try again.");
    }
  }

  function handleReject(disputeId: string) {
    setError(null);
    try {
      rejectDispute(proofId, disputeId, currentActorId);
      refresh();
    } catch {
      setError("Could not reject this dispute. Try again.");
    }
  }

  function handleResolve(disputeId: string) {
    setError(null);
    try {
      resolveDispute(proofId, disputeId, currentActorId);
      refresh();
    } catch {
      setError("Could not resolve this dispute. Try again.");
    }
  }

  return (
    <div className="grid gap-6">
      {error && (
        <p className="text-xs text-rose-200" role="alert">
          {error}
        </p>
      )}

      {canSubmitDispute(currentActorRole) && (
        <ProofDisputeSubmissionForm onSubmit={handleSubmit} submitting={submitting} />
      )}

      <ProofDisputeReviewPanel
        disputes={disputes}
        currentActorId={currentActorId}
        currentActorRole={currentActorRole}
        onWithdraw={handleWithdraw}
        onAccept={handleAccept}
        onReject={handleReject}
        onResolve={handleResolve}
      />
    </div>
  );
}
