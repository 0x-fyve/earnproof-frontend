"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  getContractUpgradeReview,
  approveContractUpgradeSafe,
  rejectContractUpgradeSafe,
  canApproveReview,
  getApprovalDisabledReason,
  type ContractUpgradeReviewWithRevision,
} from "@/lib/api/contract-upgrades";
import {
  isValidationError,
  isConflictError,
  isRetryableError,
  type NormalizedError,
} from "@/lib/api/error-normalization";
import { ContractUpgradeMetadataPanel } from "./contract-upgrade-metadata";
import { CompatibilityChecksPanel } from "./compatibility-checks";
import { BlockingFindingsPanel } from "./blocking-findings";
import { MigrationRequirementsPanel } from "./migration-requirements";
import { ArtifactHashesPanel } from "./artifact-hashes";

const approveFormSchema = z.object({
  notes: z.string().max(5000, "Notes must be less than 5000 characters").optional().or(z.literal("")),
});

const rejectFormSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required").max(500),
  details: z.string().max(2000, "Details must be less than 2000 characters").optional().or(z.literal("")),
});

type ApproveFormInput = z.infer<typeof approveFormSchema>;
type RejectFormInput = z.infer<typeof rejectFormSchema>;

export interface ContractUpgradeReviewPanelProps {
  upgradePlanId: string;
  token: string;
  walletAddress: string;
}

/**
 * Main contract upgrade review panel component
 * Displays compatibility information and approval/rejection controls
 */
export function ContractUpgradeReviewPanel({
  upgradePlanId,
  token,
  walletAddress,
}: ContractUpgradeReviewPanelProps) {
  const router = useRouter();

  // Review data state
  const [review, setReview] = useState<ContractUpgradeReviewWithRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<NormalizedError | null>(null);

  // Action state
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionError, setActionError] = useState<NormalizedError | null>(null);
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Approve form
  const approveForm = useForm<ApproveFormInput>({
    resolver: zodResolver(approveFormSchema),
    defaultValues: { notes: "" },
  });

  // Reject form
  const rejectForm = useForm<RejectFormInput>({
    resolver: zodResolver(rejectFormSchema),
    defaultValues: { reason: "", details: "" },
  });

  /**
   * Load the upgrade review
   */
  const loadReview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const controller = new AbortController();
      const data = await getContractUpgradeReview(token, upgradePlanId, controller.signal);
      setReview(data);
    } catch (error) {
      // Error already normalized by the API layer
      setLoadError({
        message: "Failed to load upgrade review",
        type: "unknown",
        fieldErrors: {},
        isRetryable: true,
        originalError: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      setLoading(false);
    }
  }, [token, upgradePlanId]);

  /**
   * Handle upgrade approval
   */
  const handleApprove = useCallback(
    async (formData: ApproveFormInput) => {
      if (!review) return;

      // Validate review can be approved
      if (!canApproveReview(review)) {
        setActionError({
          message: getApprovalDisabledReason(review) || "Cannot approve this upgrade",
          type: "unknown",
          fieldErrors: {},
          isRetryable: false,
        });
        return;
      }

      setActionInProgress(true);
      setActionError(null);

      try {
        const controller = new AbortController();
        const result = await approveContractUpgradeSafe(
          token,
          upgradePlanId,
          { notes: formData.notes || undefined },
          controller.signal
        );

        if (result.success) {
          // Update review state
          setReview(result.data as ContractUpgradeReviewWithRevision);
          setShowApproveForm(false);
          approveForm.reset();

          // Show success and redirect after delay
          setTimeout(() => {
            router.push("/settings/governance?status=approved");
          }, 2000);
        } else {
          setActionError(result.error);
          if (isConflictError(result.error)) {
            // Could reload the review here
          }
        }
      } finally {
        setActionInProgress(false);
      }
    },
    [review, token, upgradePlanId, approveForm, router]
  );

  /**
   * Handle upgrade rejection
   */
  const handleReject = useCallback(
    async (formData: RejectFormInput) => {
      setActionInProgress(true);
      setActionError(null);

      try {
        const controller = new AbortController();
        const result = await rejectContractUpgradeSafe(
          token,
          upgradePlanId,
          {
            reason: formData.reason,
            details: formData.details || undefined,
          },
          controller.signal
        );

        if (result.success) {
          // Update review state
          setReview(result.data as ContractUpgradeReviewWithRevision);
          setShowRejectForm(false);
          rejectForm.reset();

          // Show success and redirect after delay
          setTimeout(() => {
            router.push("/settings/governance?status=rejected");
          }, 2000);
        } else {
          setActionError(result.error);
        }
      } finally {
        setActionInProgress(false);
      }
    },
    [token, upgradePlanId, rejectForm, router]
  );

  // Load review on mount
  useEffect(() => {
    loadReview();
  }, [loadReview]);

  // Render loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-slate-800 rounded w-1/3" />
          <div className="h-4 bg-slate-800 rounded w-2/3" />
        </div>
      </div>
    );
  }

  // Render error state
  if (loadError) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-900/10 p-6">
        <div className="flex items-start gap-4">
          <svg className="h-6 w-6 text-red-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <h3 className="font-semibold text-red-300 mb-1">Failed to load upgrade review</h3>
            <p className="text-sm text-red-200 mb-3">{loadError.message}</p>
            {loadError.isRetryable && (
              <button
                onClick={loadReview}
                className="inline-flex items-center gap-2 rounded-md bg-red-900/30 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-900/50 transition-colors"
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-center">
        <p className="text-slate-300">No upgrade review found</p>
      </div>
    );
  }

  const canApprove = canApproveReview(review);
  const approvalDisabledReason = getApprovalDisabledReason(review);
  const isAlreadyApproved = review.overallStatus === "approved";
  const isRejected = review.overallStatus === "rejected";

  return (
    <div className="space-y-6">
      {/* Action messages */}
      {actionError && (
        <div className="rounded-lg border border-red-500/20 bg-red-900/10 p-4">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm text-red-300">{actionError.message}</p>
              {isRetryableError(actionError) && (
                <button
                  onClick={() => setActionError(null)}
                  className="mt-2 text-xs text-red-200 hover:text-red-100 underline"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status badge */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Contract Upgrade Review</h1>
        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              review.overallStatus === "approved"
                ? "bg-green-900/30 text-green-300"
                : review.overallStatus === "rejected"
                ? "bg-red-900/30 text-red-300"
                : review.overallStatus === "blocked"
                ? "bg-rose-900/30 text-rose-300"
                : "bg-amber-900/30 text-amber-300"
            }`}
          >
            {review.overallStatus.charAt(0).toUpperCase() + review.overallStatus.slice(1).replace("-", " ")}
          </span>
        </div>
      </div>

      {/* Main content panels */}
      <ContractUpgradeMetadataPanel metadata={review.metadata} />

      <CompatibilityChecksPanel checks={review.compatibilityChecks} />

      <BlockingFindingsPanel findings={review.blockingFindings} />

      {review.migrationRequirements.length > 0 && (
        <MigrationRequirementsPanel requirements={review.migrationRequirements} />
      )}

      {review.artifactHashes.length > 0 && (
        <ArtifactHashesPanel hashes={review.artifactHashes} />
      )}

      {/* Approval controls */}
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Approval Decision</h2>

        {isAlreadyApproved ? (
          <div className="rounded-lg border border-green-500/20 bg-green-900/10 p-4">
            <p className="text-sm text-green-300 font-medium">
              ✓ This upgrade was approved {review.approvedAt && `on ${new Date(review.approvedAt).toLocaleString()}`}
            </p>
            {review.approvedBy && (
              <p className="text-xs text-green-200 mt-2">By: {review.approvedBy}</p>
            )}
            {review.notes && (
              <p className="text-sm text-green-200 mt-2 pt-2 border-t border-green-500/20">{review.notes}</p>
            )}
          </div>
        ) : isRejected ? (
          <div className="rounded-lg border border-red-500/20 bg-red-900/10 p-4">
            <p className="text-sm text-red-300 font-medium">✗ This upgrade was rejected</p>
            {review.rejectionReason && (
              <p className="text-sm text-red-200 mt-2">{review.rejectionReason}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Approval form */}
            {showApproveForm ? (
              <form onSubmit={approveForm.handleSubmit(handleApprove)} className="space-y-4">
                <div>
                  <label htmlFor="notes" className="block text-sm font-medium text-slate-300 mb-2">
                    Approval Notes (optional)
                  </label>
                  <textarea
                    {...approveForm.register("notes")}
                    className="h-24 w-full rounded-md border border-white/10 bg-slate-800 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                    placeholder="Add any notes about this approval..."
                  />
                  {approveForm.formState.errors.notes && (
                    <p className="mt-1 text-sm text-red-300">{approveForm.formState.errors.notes.message}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={actionInProgress || !canApprove}
                    className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {actionInProgress ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Approving...
                      </>
                    ) : (
                      "Approve Upgrade"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowApproveForm(false);
                      approveForm.reset();
                    }}
                    className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>

                {!canApprove && (
                  <p className="text-sm text-amber-300">{approvalDisabledReason}</p>
                )}
              </form>
            ) : (
              <button
                onClick={() => setShowApproveForm(true)}
                disabled={!canApprove}
                title={!canApprove ? approvalDisabledReason || undefined : undefined}
                className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
              >
                Approve This Upgrade
              </button>
            )}

            {/* Rejection form */}
            {showRejectForm ? (
              <form onSubmit={rejectForm.handleSubmit(handleReject)} className="space-y-4 mt-4 pt-4 border-t border-white/10">
                <div>
                  <label htmlFor="reason" className="block text-sm font-medium text-slate-300 mb-2">
                    Rejection Reason *
                  </label>
                  <input
                    {...rejectForm.register("reason")}
                    type="text"
                    className="w-full rounded-md border border-white/10 bg-slate-800 px-4 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                    placeholder="Why is this upgrade being rejected?"
                  />
                  {rejectForm.formState.errors.reason && (
                    <p className="mt-1 text-sm text-red-300">{rejectForm.formState.errors.reason.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="details" className="block text-sm font-medium text-slate-300 mb-2">
                    Additional Details (optional)
                  </label>
                  <textarea
                    {...rejectForm.register("details")}
                    className="h-20 w-full rounded-md border border-white/10 bg-slate-800 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                    placeholder="Add any additional context..."
                  />
                  {rejectForm.formState.errors.details && (
                    <p className="mt-1 text-sm text-red-300">{rejectForm.formState.errors.details.message}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={actionInProgress}
                    className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {actionInProgress ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Rejecting...
                      </>
                    ) : (
                      "Reject Upgrade"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRejectForm(false);
                      rejectForm.reset();
                    }}
                    className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowRejectForm(true)}
                className="w-full rounded-md border border-white/10 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors text-left"
              >
                Reject This Upgrade
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
