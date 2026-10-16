"use client";

/**
 * ApprovalDetail Component
 * 
 * Shows full details of an operation and provides approval/rejection interface.
 * Features:
 * - Detailed operation information by type
 * - Conflict detection (concurrent modifications, expired operations)
 * - Authorization checks (cannot approve own operations)
 * - Approval/rejection forms with reason capture
 * - Loading and error states
 * - Stale-data recovery UI
 */

import { useCallback, useState } from "react";
import {
  ApprovalOperation,
  isRoleChangeOperation,
  isExportOperation,
  isRecoveryOperation,
  isKeyRotationOperation,
  isGovernanceOperation,
  isTerminalStatus,
} from "@/lib/validation/operations";
import { approveOperation, rejectOperation, getApprovalRestriction } from "@/lib/api/approvals";
import {
  formatAge,
  formatTimeRemaining,
  getExpiryStatus,
  formatRelativeTime,
} from "@/lib/approvals/expiry";
import { ApiConflictError } from "@/lib/api/client";

export interface ApprovalDetailProps {
  /**
   * Operation to display
   */
  operation: ApprovalOperation;

  /**
   * User ID for authorization checks
   */
  userId: string;

  /**
   * Organization ID
   */
  organizationId: string;

  /**
   * Bearer token for API requests
   */
  token: string;

  /**
   * Current user's role
   */
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null;

  /**
   * Callback after successful approval/rejection
   */
  onActionComplete?: (operation: ApprovalOperation, action: "approve" | "reject") => void;

  /**
   * Callback to close detail view
   */
  onClose?: () => void;
}

interface FormState {
  isSubmitting: boolean;
  error: string | null;
  successMessage: string | null;
}

/**
 * Main approval detail component
 */
export function ApprovalDetail({
  operation,
  userId,
  organizationId,
  token,
  userRole,
  onActionComplete,
  onClose,
}: ApprovalDetailProps) {
  const [formState, setFormState] = useState<FormState>({
    isSubmitting: false,
    error: null,
    successMessage: null,
  });

  const [rejectionReason, setRejectionReason] = useState("");
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Authorization check
  const approvalRestriction = getApprovalRestriction(userRole, userId, operation);
  const canApprove = !approvalRestriction && operation.status === "pending";
  const isExpired = getExpiryStatus(operation.expiresAt) === "expired";
  const isTerminal = isTerminalStatus(operation.status);

  /**
   * Handle approval action
   */
  const handleApprove = useCallback(async () => {
    setFormState({ isSubmitting: true, error: null, successMessage: null });

    try {
      const decision = {
        operationId: operation.id,
        decision: "approve" as const,
        conflictVersion: operation.conflictVersion,
      };

      await approveOperation(token, organizationId, decision, userId);

      setFormState({
        isSubmitting: false,
        error: null,
        successMessage: "Operation approved successfully.",
      });

      // Notify parent after brief delay
      setTimeout(() => {
        onActionComplete?.(operation, "approve");
      }, 1500);
    } catch (error) {
      let errorMessage = "Failed to approve operation";

      if (error instanceof ApiConflictError) {
        const serverOp = error.serverEntity as ApprovalOperation | undefined;
        if (serverOp?.status !== "pending") {
          errorMessage = `Operation was already ${serverOp?.status || "modified"}. Please refresh to see the latest state.`;
        } else {
          errorMessage = "Conflict detected. Please refresh and try again.";
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setFormState({
        isSubmitting: false,
        error: errorMessage,
        successMessage: null,
      });
    }
  }, [operation, token, organizationId, userId, onActionComplete]);

  /**
   * Handle rejection action
   */
  const handleReject = useCallback(async () => {
    if (!rejectionReason.trim()) {
      setFormState({
        isSubmitting: false,
        error: "Please provide a reason for rejection",
        successMessage: null,
      });
      return;
    }

    setFormState({ isSubmitting: true, error: null, successMessage: null });

    try {
      const decision = {
        operationId: operation.id,
        decision: "reject" as const,
        reason: rejectionReason,
        conflictVersion: operation.conflictVersion,
      };

      await rejectOperation(token, organizationId, decision, userId);

      setFormState({
        isSubmitting: false,
        error: null,
        successMessage: "Operation rejected successfully.",
      });

      // Notify parent after brief delay
      setTimeout(() => {
        onActionComplete?.(operation, "reject");
      }, 1500);
    } catch (error) {
      let errorMessage = "Failed to reject operation";

      if (error instanceof ApiConflictError) {
        const serverOp = error.serverEntity as ApprovalOperation | undefined;
        if (serverOp?.status !== "pending") {
          errorMessage = `Operation was already ${serverOp?.status || "modified"}. Please refresh to see the latest state.`;
        } else {
          errorMessage = "Conflict detected. Please refresh and try again.";
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setFormState({
        isSubmitting: false,
        error: errorMessage,
        successMessage: null,
      });
    }
  }, [operation, rejectionReason, token, organizationId, userId, onActionComplete]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-lg">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Operation Details</h2>
          <p className="text-sm text-gray-600 mt-1">{operation.id}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-4 space-y-6 max-h-[60vh] overflow-y-auto">
        {/* Status alerts */}
        {isTerminal && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-gray-800 font-medium">
              Status: {operation.status.charAt(0).toUpperCase() + operation.status.slice(1)}
            </p>
            <p className="text-gray-600 text-sm mt-1">No further action can be taken on this operation.</p>
          </div>
        )}

        {isExpired && !isTerminal && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 font-medium">Operation Expired</p>
            <p className="text-red-700 text-sm mt-1">
              This operation has expired and can no longer be acted upon.
            </p>
          </div>
        )}

        {approvalRestriction && !isTerminal && !isExpired && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800 font-medium">Cannot Approve</p>
            <p className="text-yellow-700 text-sm mt-1">{approvalRestriction}</p>
          </div>
        )}

        {formState.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 font-medium">Error</p>
            <p className="text-red-700 text-sm mt-1">{formState.error}</p>
          </div>
        )}

        {formState.successMessage && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800 font-medium">Success</p>
            <p className="text-green-700 text-sm mt-1">{formState.successMessage}</p>
          </div>
        )}

        {/* Metadata section */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Type</p>
            <p className="text-sm text-gray-900 mt-1">
              {operation.operationType
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Status</p>
            <p className="text-sm text-gray-900 mt-1">
              {operation.status.charAt(0).toUpperCase() + operation.status.slice(1)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Created</p>
            <p className="text-sm text-gray-900 mt-1" title={operation.createdAt}>
              {formatAge(operation.createdAt)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Expires</p>
            <p className="text-sm text-gray-900 mt-1" title={operation.expiresAt}>
              {formatTimeRemaining(operation.expiresAt)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Requested By</p>
            <p className="text-sm text-gray-900 mt-1 font-mono">{operation.requestedBy}</p>
          </div>
          {operation.approverId && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Approved By</p>
              <p className="text-sm text-gray-900 mt-1 font-mono">{operation.approverId}</p>
            </div>
          )}
          {operation.approvedAt && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Approved At</p>
              <p className="text-sm text-gray-900 mt-1" title={operation.approvedAt}>
                {formatRelativeTime(operation.approvedAt)}
              </p>
            </div>
          )}
        </div>

        {/* Operation-specific details */}
        <OperationDetails operation={operation} />
      </div>

      {/* Footer with action buttons */}
      <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition"
        >
          Close
        </button>

        {canApprove && !showRejectForm && (
          <>
            <button
              onClick={() => setShowRejectForm(true)}
              className="px-4 py-2 text-red-700 bg-red-50 border border-red-300 rounded hover:bg-red-100 transition"
            >
              Reject
            </button>
            <button
              onClick={() => setShowApproveConfirm(true)}
              disabled={formState.isSubmitting}
              className="px-4 py-2 text-white bg-green-600 rounded hover:bg-green-700 transition disabled:opacity-50"
            >
              {formState.isSubmitting ? "Approving..." : "Approve"}
            </button>
          </>
        )}

        {showApproveConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm">
              <h3 className="font-semibold text-gray-900">Confirm Approval</h3>
              <p className="text-gray-600 text-sm mt-2">
                Are you sure you want to approve this operation?
              </p>
              <div className="flex gap-2 mt-4 justify-end">
                <button
                  onClick={() => setShowApproveConfirm(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowApproveConfirm(false);
                    handleApprove();
                  }}
                  className="px-4 py-2 text-white bg-green-600 rounded hover:bg-green-700"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {showRejectForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm">
              <h3 className="font-semibold text-gray-900">Reject Operation</h3>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why you're rejecting this operation..."
                maxLength={1000}
                className="w-full mt-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">
                {rejectionReason.length}/1000 characters
              </p>
              <div className="flex gap-2 mt-4 justify-end">
                <button
                  onClick={() => setShowRejectForm(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowRejectForm(false);
                    handleReject();
                  }}
                  disabled={formState.isSubmitting || !rejectionReason.trim()}
                  className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {formState.isSubmitting ? "Rejecting..." : "Reject"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Render operation-specific details
 */
function OperationDetails({ operation }: { operation: ApprovalOperation }): React.ReactNode {
  if (isRoleChangeOperation(operation)) {
    return (
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-semibold text-gray-900 mb-3">Role Change Details</h3>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-gray-600">Target Member ID</p>
            <p className="text-gray-900 font-mono">{operation.targetMemberId}</p>
          </div>
          <div>
            <p className="text-gray-600">Wallet Address</p>
            <p className="text-gray-900 font-mono break-all">{operation.targetWalletAddress}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">Current Role</p>
              <p className="text-gray-900 font-semibold">{operation.currentRole}</p>
            </div>
            <div>
              <p className="text-gray-600">New Role</p>
              <p className="text-gray-900 font-semibold text-blue-600">{operation.newRole}</p>
            </div>
          </div>
          {operation.reason && (
            <div>
              <p className="text-gray-600">Reason</p>
              <p className="text-gray-900 whitespace-pre-wrap">{operation.reason}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isExportOperation(operation)) {
    return (
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-semibold text-gray-900 mb-3">Export Details</h3>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">Type</p>
              <p className="text-gray-900 font-semibold">{operation.exportType}</p>
            </div>
            <div>
              <p className="text-gray-600">Include Proof Data</p>
              <p className="text-gray-900">{operation.includeProofData ? "Yes" : "No"}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-600">Scope</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {operation.exportScope?.map((scope) => (
                <span key={scope} className="px-2 py-1 bg-gray-100 rounded text-xs">
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isRecoveryOperation(operation)) {
    return (
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-semibold text-gray-900 mb-3">Recovery Details</h3>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-gray-600">Wallet Address</p>
            <p className="text-gray-900 font-mono break-all">{operation.walletAddress}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">Method</p>
              <p className="text-gray-900 font-semibold">{operation.recoveryMethod}</p>
            </div>
            <div>
              <p className="text-gray-600">Recovery ID</p>
              <p className="text-gray-900 font-mono">{operation.recoveryIdentifier}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isKeyRotationOperation(operation)) {
    return (
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-semibold text-gray-900 mb-3">Key Rotation Details</h3>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">Key ID</p>
              <p className="text-gray-900 font-mono">{operation.keyId}</p>
            </div>
            <div>
              <p className="text-gray-600">Key Type</p>
              <p className="text-gray-900 font-semibold">{operation.keyType}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-600">Rotate From</p>
            <p className="text-gray-900 font-mono break-all">{operation.rotateFrom}</p>
          </div>
          <div>
            <p className="text-gray-600">Rotate To</p>
            <p className="text-gray-900 font-mono break-all">{operation.rotateTo}</p>
          </div>
          {operation.maintenanceWindow && (
            <div>
              <p className="text-gray-600">Maintenance Window</p>
              <p className="text-gray-900 text-xs">
                {formatRelativeTime(operation.maintenanceWindow.startAt)} -{" "}
                {formatRelativeTime(operation.maintenanceWindow.endAt)}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isGovernanceOperation(operation)) {
    return (
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-semibold text-gray-900 mb-3">Governance Details</h3>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">Change Type</p>
              <p className="text-gray-900 font-semibold">{operation.changeType}</p>
            </div>
            <div>
              <p className="text-gray-600">Requires Multi-Sig</p>
              <p className="text-gray-900">{operation.requiresMultiSig ? "Yes" : "No"}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-600">Description</p>
            <p className="text-gray-900 whitespace-pre-wrap">{operation.changeDescription}</p>
          </div>
          <div>
            <p className="text-gray-600">Affected Entities</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {operation.affectedEntities?.map((entity) => (
                <span key={entity} className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                  {entity}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
