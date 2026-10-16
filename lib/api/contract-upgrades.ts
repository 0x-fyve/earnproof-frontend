/**
 * Contract upgrade compatibility review API integration.
 * 
 * Provides endpoints for operators to review contract upgrade compatibility
 * including ABI, storage, dependency, and client compatibility checks.
 */

import { apiClient, bearer, retryRead, retryMutation } from "./client";
import { captureRevision } from "./revision-tracking";
import { normalizeError, type NormalizedError } from "./error-normalization";

/**
 * Versioned contract upgrade metadata
 */
export interface ContractUpgradeMetadata {
  id: string;
  contractAddress: string;
  contractIdentity: string; // Immutable identifier for the contract
  currentVersion: string;
  proposedVersion: string;
  proposedAt: string;
  proposedBy: string;
  activationWindow: {
    startsAt: string;
    endsAt: string;
  };
  description: string;
}

/**
 * Compatibility check result for a specific category
 */
export interface CompatibilityCheckResult {
  category: "abi" | "storage" | "dependency" | "client";
  status: "compatible" | "incompatible" | "unknown" | "pending";
  severity: "error" | "warning" | "info";
  message: string;
  details?: Record<string, unknown>;
  checkedAt?: string;
}

/**
 * Blocking finding that prevents upgrade approval
 */
export interface BlockingFinding {
  id: string;
  title: string;
  description: string;
  category: "critical" | "security" | "compatibility" | "migration";
  affectedComponent: string;
  resolution?: string;
  detectedAt: string;
}

/**
 * Migration requirement or step
 */
export interface MigrationRequirement {
  id: string;
  phase: number;
  type: "pre-upgrade" | "upgrade" | "post-upgrade";
  title: string;
  description: string;
  estimatedDurationMinutes?: number;
  dependencies?: string[]; // IDs of other requirements that must complete first
  completed?: boolean;
}

/**
 * Signed artifact hash for verification
 */
export interface SignedArtifactHash {
  type: "contract-bytecode" | "abi" | "metadata";
  hash: string;
  algorithm: "sha256" | "keccak256";
  signature: string;
  signedBy: string;
  signedAt: string;
}

/**
 * Complete contract upgrade review document
 */
export interface ContractUpgradeReview {
  id: string;
  metadata: ContractUpgradeMetadata;
  compatibilityChecks: CompatibilityCheckResult[];
  blockingFindings: BlockingFinding[];
  migrationRequirements: MigrationRequirement[];
  artifactHashes: SignedArtifactHash[];
  overallStatus: "approved" | "pending-review" | "rejected" | "blocked";
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  notes?: string;
}

/**
 * Request to approve a contract upgrade
 */
export interface ApproveContractUpgradeRequest {
  notes?: string;
}

/**
 * Request to reject a contract upgrade
 */
export interface RejectContractUpgradeRequest {
  reason: string;
  details?: string;
}

/**
 * Versioned review with revision tracking for conflict detection
 */
export type ContractUpgradeReviewWithRevision = ContractUpgradeReview & {
  __revision?: string;
  __loadedAt?: string;
};

/**
 * Update request with revision for conflict detection
 */
export type ApproveContractUpgradeRequestWithRevision = ApproveContractUpgradeRequest & {
  __revision?: string;
};

/**
 * Result type for API operations
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: NormalizedError };

/**
 * Fetch a specific contract upgrade review
 */
export async function getContractUpgradeReview(
  token: string,
  upgradePlanId: string,
  signal: AbortSignal
): Promise<ContractUpgradeReviewWithRevision> {
  return retryRead(async (signal) => {
    const review = await apiClient<ContractUpgradeReview>({
      path: `/contract-upgrades/${upgradePlanId}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
    return captureRevision(review);
  }, signal);
}

/**
 * List all pending contract upgrade reviews
 */
export async function getPendingContractUpgrades(
  token: string,
  signal: AbortSignal
): Promise<ContractUpgradeReviewWithRevision[]> {
  return retryRead(async (signal) => {
    const reviews = await apiClient<ContractUpgradeReview[]>({
      path: "/contract-upgrades?status=pending-review",
      method: "GET",
      headers: bearer(token),
      signal,
    });
    return reviews.map(review => captureRevision(review));
  }, signal);
}

/**
 * List contract upgrade reviews for a specific contract
 */
export async function getContractUpgradeHistory(
  token: string,
  contractAddress: string,
  signal: AbortSignal
): Promise<ContractUpgradeReviewWithRevision[]> {
  return retryRead(async (signal) => {
    const reviews = await apiClient<ContractUpgradeReview[]>({
      path: `/contracts/${contractAddress}/upgrades`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
    return reviews.map(review => captureRevision(review));
  }, signal);
}

/**
 * Approve a contract upgrade
 */
export async function approveContractUpgrade(
  token: string,
  upgradePlanId: string,
  request: ApproveContractUpgradeRequest | ApproveContractUpgradeRequestWithRevision,
  signal: AbortSignal
): Promise<ContractUpgradeReviewWithRevision> {
  return retryMutation(async (signal) => {
    const review = await apiClient<ContractUpgradeReview>({
      path: `/contract-upgrades/${upgradePlanId}/approve`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
    return captureRevision(review);
  }, signal);
}

/**
 * Reject a contract upgrade
 */
export async function rejectContractUpgrade(
  token: string,
  upgradePlanId: string,
  request: RejectContractUpgradeRequest,
  signal: AbortSignal
): Promise<ContractUpgradeReviewWithRevision> {
  return retryMutation(async (signal) => {
    const review = await apiClient<ContractUpgradeReview>({
      path: `/contract-upgrades/${upgradePlanId}/reject`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
    return captureRevision(review);
  }, signal);
}

/**
 * Safe wrapper for contract upgrade approval
 */
export async function approveContractUpgradeSafe(
  token: string,
  upgradePlanId: string,
  request: ApproveContractUpgradeRequest,
  signal: AbortSignal
): Promise<ApiResult<ContractUpgradeReview>> {
  try {
    const data = await approveContractUpgrade(token, upgradePlanId, request, signal);
    return { success: true, data };
  } catch (error) {
    const normalizedError = await normalizeError(error);
    return { success: false, error: normalizedError };
  }
}

/**
 * Safe wrapper for contract upgrade rejection
 */
export async function rejectContractUpgradeSafe(
  token: string,
  upgradePlanId: string,
  request: RejectContractUpgradeRequest,
  signal: AbortSignal
): Promise<ApiResult<ContractUpgradeReview>> {
  try {
    const data = await rejectContractUpgrade(token, upgradePlanId, request, signal);
    return { success: true, data };
  } catch (error) {
    const normalizedError = await normalizeError(error);
    return { success: false, error: normalizedError };
  }
}

/**
 * Check if a review can be approved (no blocking findings, unknown compatibility versions disallowed)
 */
export function canApproveReview(review: ContractUpgradeReview): boolean {
  // Block if there are any blocking findings
  if (review.blockingFindings.length > 0) {
    return false;
  }

  // Block if any compatibility checks have unknown status
  const hasUnknownCompatibility = review.compatibilityChecks.some(
    check => check.status === "unknown"
  );
  if (hasUnknownCompatibility) {
    return false;
  }

  // Block if contract identity is unknown or mismatched
  if (!review.metadata.contractIdentity) {
    return false;
  }

  return true;
}

/**
 * Get a human-readable reason why approval is disabled
 */
export function getApprovalDisabledReason(review: ContractUpgradeReview): string | null {
  if (review.blockingFindings.length > 0) {
    return `${review.blockingFindings.length} blocking finding${review.blockingFindings.length !== 1 ? 's' : ''} must be resolved`;
  }

  const unknownChecks = review.compatibilityChecks.filter(
    check => check.status === "unknown"
  );
  if (unknownChecks.length > 0) {
    return `${unknownChecks.length} compatibility check${unknownChecks.length !== 1 ? 's' : ''} unknown`;
  }

  if (!review.metadata.contractIdentity) {
    return "Contract identity unknown or mismatched";
  }

  return null;
}
