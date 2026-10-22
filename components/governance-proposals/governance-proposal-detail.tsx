"use client";

import { useCallback, useState } from "react";
import {
  decodeProposalAction,
  evaluateProposalApprovability,
  getProposalApprovalDisabledReason,
  proposalLifecycleLabel,
  approveGovernanceProposalSafe,
  type GovernanceProposal,
} from "@/lib/api/governance-proposals";
import type { GovernanceApprovalRole, GovernanceNetwork } from "@/lib/api/governance-approvals";
import { useRecentAuth } from "@/lib/auth/recent-auth";
import { RecentAuthGate } from "@/components/common/recent-auth-gate";
import { signWithFreighter } from "@/lib/wallet/sign-message";

export interface GovernanceProposalDetailProps {
  proposal: GovernanceProposal;
  token: string;
  walletAddress: string;
  currentNetwork: GovernanceNetwork;
  approvalRole: GovernanceApprovalRole;
  onApproved?: (updated: GovernanceProposal) => void;
}

/**
 * Inspect/detail view for a single governance proposal (#246).
 *
 * Always shows the canonical actionHash, independent of whether the action
 * payload itself could be decoded into a human-readable diff — an
 * unsupported/unknown action version fails closed to "inspectable only."
 *
 * The approve control is only ever offered when
 * `evaluateProposalApprovability` says so (network match + recent auth are
 * both required on top of that); every other reason it may be blocked is
 * surfaced via `getProposalApprovalDisabledReason`.
 */
export function GovernanceProposalDetail({
  proposal,
  token,
  walletAddress,
  currentNetwork,
  approvalRole,
  onApproved,
}: GovernanceProposalDetailProps) {
  const [current, setCurrent] = useState(proposal);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const decoded = decodeProposalAction(current.action);

  const approvability = evaluateProposalApprovability(current, {
    currentNetwork,
    currentWalletAddress: walletAddress,
  });
  const disabledReason = getProposalApprovalDisabledReason(approvability);
  const networkMismatch = current.network !== currentNetwork;

  const recentAuth = useRecentAuth({
    walletAddress,
    signMessage: (message) => signWithFreighter(message, walletAddress),
  });

  const doApprove = useCallback(async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const controller = new AbortController();
      const result = await approveGovernanceProposalSafe(
        token,
        current.id,
        { role: approvalRole },
        controller.signal,
      );
      if (result.success) {
        setCurrent(result.data);
        onApproved?.(result.data);
      } else {
        setSubmitError(result.error.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [token, current.id, approvalRole, onApproved]);

  const handleApproveClick = useCallback(() => {
    if (!approvability.canApprove) return;
    recentAuth.requestRecentAuth(doApprove);
  }, [approvability.canApprove, recentAuth, doApprove]);

  // Approval requires BOTH the policy evaluation above AND network
  // confirmation (current wallet network === proposal network); either
  // failing disables the control, regardless of the other.
  const approveButtonDisabled = !approvability.canApprove || networkMismatch || isSubmitting;
  const effectiveDisabledReason = networkMismatch
    ? "This proposal was computed for a different network than the one you are connected to."
    : disabledReason;

  return (
    <div className="space-y-6">
      <RecentAuthGate recentAuth={recentAuth} actionDescription={`Approve proposal for ${current.targetContract}`} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{current.targetContract}</h1>
        <span
          role="status"
          aria-label={`Lifecycle state: ${proposalLifecycleLabel(current.state)}`}
          className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200"
        >
          {proposalLifecycleLabel(current.state)}
        </span>
      </div>

      <dl className="grid gap-3 rounded-lg border border-white/10 bg-slate-900/50 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-400">Network</dt>
          <dd className="text-slate-200">{current.network}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-400">Proposed by</dt>
          <dd className="text-slate-200">{current.proposedBy}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-400">Approvals</dt>
          <dd className="text-slate-200">
            {current.approvals.length} / {current.requiredApprovals}
          </dd>
        </div>
      </dl>

      {/* Decoded action diff, or fail-closed raw-inspect panel. The action
          hash is always shown, regardless of which branch renders. */}
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-semibold text-white mb-2">Action</h2>
        {decoded ? (
          <>
            <p className="text-sm text-slate-300 mb-3">{decoded.summary}</p>
            <dl className="space-y-2">
              {decoded.fields.map((field) => (
                <div key={field.label} className="text-sm">
                  <dt className="text-slate-400">{field.label}</dt>
                  <dd className="text-slate-200">
                    {field.before ?? "—"} → {field.after ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <div
            role="alert"
            className="rounded-md border border-amber-500/20 bg-amber-900/10 p-3 text-sm text-amber-200"
          >
            This proposal uses an action format this app does not recognize. It can be
            inspected, but not approved here.
          </div>
        )}
        <p className="mt-3 break-all text-xs text-slate-500">
          Action hash: <span data-testid="action-hash">{current.actionHash}</span>
        </p>
      </div>

      {!approvability.canApprove && !networkMismatch && (
        <p role="alert" className="text-sm text-amber-300">
          {disabledReason}
        </p>
      )}
      {networkMismatch && (
        <p role="alert" className="text-sm text-amber-300">
          {effectiveDisabledReason}
        </p>
      )}
      {submitError && (
        <p role="alert" className="text-sm text-red-300">
          {submitError}
        </p>
      )}

      <button
        type="button"
        onClick={handleApproveClick}
        disabled={approveButtonDisabled}
        aria-label="Approve proposal"
        aria-disabled={approveButtonDisabled}
        title={approveButtonDisabled ? effectiveDisabledReason ?? undefined : undefined}
        className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? "Approving..." : "Approve proposal"}
      </button>
    </div>
  );
}
