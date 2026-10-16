"use client";

import { useMemo } from "react";
import { NetworkBadge } from "@/components/common/network-badge";
import { formatDateTime } from "@/lib/i18n";
import {
  GovernanceApprovalIntentConfirmation,
  isGovernanceApprovalIntentExpired,
  checkGovernanceApprovalAuthorization,
  validateGovernanceApprovalConfirmation,
} from "@/lib/api/governance-approvals";

interface ApprovalReceiptProps {
  /** Server-confirmed approval intent to display. */
  confirmation: GovernanceApprovalIntentConfirmation;

  /** Current wallet address for authorization check. */
  currentWalletAddress: string;

  /** Optional callback when user clicks download. */
  onDownload?: () => void;

  /** Optional callback when user clicks copy to clipboard. */
  onCopy?: () => void;

  /** Show detailed validation warnings (dev/debug only). */
  showValidationDetails?: boolean;
}

/**
 * Displays an immutable server-confirmed governance approval intent receipt.
 *
 * Features:
 * - Shows canonical action hash, target contract, network, proposal, approval role, timestamp
 * - Displays expiration status and authorization checks
 * - Provides downloadable receipt and copy-to-clipboard actions
 * - Distinguishes intent (never claims execution)
 * - Accessibility-compliant with ARIA labels and semantic HTML
 * - Responsive design for mobile and desktop
 *
 * Authorization:
 * - Only the wallet that signed the approval can view full details
 * - Expired intents show as read-only (cannot be used for further actions)
 * - Validation errors are surfaced prominently
 */
export function ApprovalReceipt({
  confirmation,
  currentWalletAddress,
  onDownload,
  onCopy,
  showValidationDetails = false,
}: ApprovalReceiptProps) {
  // Validate confirmation structure
  const validationResult = useMemo(
    () => validateGovernanceApprovalConfirmation(confirmation),
    [confirmation]
  );

  // Check authorization
  const authCheck = useMemo(
    () => checkGovernanceApprovalAuthorization(confirmation, currentWalletAddress),
    [confirmation, currentWalletAddress]
  );

  // Check expiration
  const isExpired = useMemo(
    () => isGovernanceApprovalIntentExpired(confirmation),
    [confirmation]
  );

  // Determine display status
  const status = useMemo(() => {
    if (!validationResult.isValid) return "error";
    if (isExpired) return "expired";
    if (confirmation.state === "failed") return "failed";
    if (confirmation.state === "cancelled") return "cancelled";
    if (confirmation.state === "superseded") return "superseded";
    if (confirmation.state === "confirmed") return "confirmed";
    return "pending";
  }, [validationResult.isValid, isExpired, confirmation.state]);

  // Map state to display label
  const getStateLabel = (state: string): string => {
    const labels: Record<string, string> = {
      intent_signed: "Intent Signed",
      submitted: "Submitted",
      confirmed: "Confirmed",
      failed: "Failed",
      superseded: "Superseded",
      cancelled: "Cancelled",
    };
    return labels[state] || state;
  };

  // Map state to badge color
  const getStateBadgeColor = (st: string): string => {
    switch (st) {
      case "confirmed":
        return "bg-green-500/20 text-green-200 border-green-500/30";
      case "pending":
      case "intent_signed":
      case "submitted":
        return "bg-blue-500/20 text-blue-200 border-blue-500/30";
      case "failed":
        return "bg-red-500/20 text-red-200 border-red-500/30";
      case "cancelled":
      case "superseded":
        return "bg-slate-500/20 text-slate-200 border-slate-500/30";
      default:
        return "bg-slate-500/20 text-slate-200 border-slate-500/30";
    }
  };

  // Format shortened hash for display
  const formatHash = (hash: string): string => {
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  if (!authCheck.canView) {
    return (
      <div
        role="alert"
        className="w-full rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200"
      >
        <p className="font-semibold">Access Denied</p>
        <p className="mt-1">{authCheck.denialReason || "You do not have permission to view this receipt."}</p>
      </div>
    );
  }

  return (
    <article
      className="w-full rounded-lg border border-white/10 bg-slate-900/50 p-6"
      aria-label="Governance Approval Intent Receipt"
    >
      {/* Header with Status */}
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-lg font-semibold text-white">Approval Intent Receipt</h2>
          <p className="mt-1 text-xs text-slate-400">
            ID: <code className="font-mono text-slate-300">{confirmation.id}</code>
          </p>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-medium ${getStateBadgeColor(
          status === "error" ? "failed" : confirmation.state
        )}`}>
          {status === "error" ? "Invalid" : getStateLabel(confirmation.state)}
          {isExpired && " • Expired"}
        </div>
      </div>

      {/* Validation Errors */}
      {!validationResult.isValid && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          <p className="font-semibold">Validation Errors:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            {validationResult.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Validation Warnings */}
      {validationResult.warnings.length > 0 && showValidationDetails && (
        <div className="mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          <p className="text-xs font-semibold">Warnings:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            {validationResult.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Expiration Notice */}
      {isExpired && (
        <div className="mt-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          <p className="font-semibold">This approval intent has expired.</p>
          <p className="mt-1 text-xs">
            No further actions can be taken with this receipt. Server will reject any execution attempts.
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="mt-6 space-y-4">
        {/* Canonical Data */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Action Hash */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Action Hash</dt>
            <dd className="mt-2 break-all font-mono text-sm text-slate-200">
              {formatHash(confirmation.actionHash)}
            </dd>
            {confirmation.actionHash.length > 16 && (
              <code className="block mt-1 text-xs text-slate-500" title={confirmation.actionHash}>
                Full: {confirmation.actionHash}
              </code>
            )}
          </div>

          {/* Target Contract */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Target Contract
            </dt>
            <dd className="mt-2 break-all font-mono text-sm text-slate-200">
              {formatHash(confirmation.targetContract)}
            </dd>
          </div>

          {/* Network */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Network</dt>
            <dd className="mt-2 flex items-center gap-2">
              <NetworkBadge />
              <code className="font-mono text-sm text-slate-300">{confirmation.network}</code>
            </dd>
          </div>

          {/* Proposal ID */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Proposal ID</dt>
            <dd className="mt-2 font-mono text-sm text-slate-200">{confirmation.proposalId}</dd>
          </div>
        </div>

        {/* Authorization Details */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Approval Role */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Approval Role
            </dt>
            <dd className="mt-2 inline-flex items-center rounded-full bg-cyan-500/20 px-2 py-1 text-xs font-medium text-cyan-200 border border-cyan-500/30">
              {confirmation.approvalRole}
            </dd>
          </div>

          {/* Wallet Address */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Wallet Address</dt>
            <dd className="mt-2 break-all font-mono text-sm text-slate-200">
              {formatHash(confirmation.walletAddress)}
            </dd>
          </div>
        </div>

        {/* Timestamps */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Confirmed At */}
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Confirmed At</dt>
            <dd className="mt-2 text-sm text-slate-200">
              {formatDateTime(confirmation.confirmedAt)}
            </dd>
            <code className="block mt-1 text-xs text-slate-500">
              {new Date(confirmation.confirmedAt).toISOString()}
            </code>
          </div>

          {/* Expires At */}
          <div className={`rounded-md border p-3 ${
            isExpired
              ? "border-red-500/30 bg-red-500/5"
              : "border-white/5 bg-white/[0.02]"
          }`}>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Expires At</dt>
            <dd className={`mt-2 text-sm ${isExpired ? "text-red-200" : "text-slate-200"}`}>
              {formatDateTime(confirmation.expiresAt)}
            </dd>
            <code className={`block mt-1 text-xs ${isExpired ? "text-red-400" : "text-slate-500"}`}>
              {new Date(confirmation.expiresAt).toISOString()}
            </code>
          </div>
        </div>

        {/* Metadata */}
        {confirmation.metadata && Object.keys(confirmation.metadata).length > 0 && (
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Metadata</dt>
            <dd className="mt-2 space-y-1">
              {Object.entries(confirmation.metadata).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2 text-sm">
                  <span className="text-slate-400">{key}:</span>
                  <span className="text-slate-200">{String(value)}</span>
                </div>
              ))}
            </dd>
          </div>
        )}

        {/* Digest */}
        {confirmation.digest && (
          <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">Integrity</dt>
            <dd className="mt-2 space-y-1 text-xs text-slate-300">
              <p>
                <span className="text-slate-400">Algorithm:</span> {confirmation.digest.algorithm}
              </p>
              <p className="break-all font-mono">
                <span className="text-slate-400">Digest:</span> {confirmation.digest.value}
              </p>
            </dd>
          </div>
        )}
      </div>

      {/* Important Notice */}
      <div className="mt-6 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-200">
        <p className="font-semibold">Intent vs. Execution</p>
        <p className="mt-1">
          This receipt confirms your approval <strong>intent</strong> only. It does not claim that the action
          has been executed on-chain. Execution happens separately and must be verified independently.
        </p>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-2 md:flex-row md:gap-3">
        <button
          onClick={onCopy}
          disabled={!authCheck.canExport || isExpired}
          className="flex-1 rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50 transition"
          type="button"
          aria-label="Copy receipt to clipboard"
        >
          Copy to Clipboard
        </button>
        <button
          onClick={onDownload}
          disabled={!authCheck.canExport}
          className="flex-1 rounded-md bg-cyan-300 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-200 disabled:opacity-50 transition"
          type="button"
          aria-label="Download receipt as JSON file"
        >
          Download Receipt
        </button>
      </div>

      {/* Schema Version Info */}
      <p className="mt-4 text-center text-xs text-slate-500">
        Schema v{confirmation.schemaVersion} • Receipt ID: {confirmation.id}
      </p>
    </article>
  );
}
