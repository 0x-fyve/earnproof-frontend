/**
 * Audit Retention and Legal Hold Policy Management
 * 
 * Provides types and API functions for managing audit retention policies and legal holds.
 * Retention policies define how long audit records are kept before eligibility for cleanup.
 * Legal holds prevent audit records within a specified range from being deleted, regardless
 * of retention policy expiry.
 * 
 * All operations are authorization-gated server-side. UI cannot create or release holds
 * without server authorization. Held records are never shown as eligible for cleanup.
 */

import { apiClient, bearer, retryRead, retryMutation } from "./client";
import { captureRevision } from "./revision-tracking";
import { normalizeError, type NormalizedError } from "./error-normalization";
import type { WithRevision } from "./revision-tracking";

/**
 * Supported retention periods for audit records
 */
export type RetentionPeriod = "7_DAYS" | "30_DAYS" | "90_DAYS" | "1_YEAR" | "3_YEARS" | "5_YEARS" | "INDEFINITE";

/**
 * Maps retention period enum to human-readable labels
 */
export function formatRetentionPeriod(period: RetentionPeriod): string {
  switch (period) {
    case "7_DAYS":
      return "7 days";
    case "30_DAYS":
      return "30 days";
    case "90_DAYS":
      return "90 days";
    case "1_YEAR":
      return "1 year";
    case "3_YEARS":
      return "3 years";
    case "5_YEARS":
      return "5 years";
    case "INDEFINITE":
      return "Indefinite";
  }
}

/**
 * Converts retention period to days for calculations
 */
export function retentionPeriodToDays(period: RetentionPeriod): number | null {
  switch (period) {
    case "7_DAYS":
      return 7;
    case "30_DAYS":
      return 30;
    case "90_DAYS":
      return 90;
    case "1_YEAR":
      return 365;
    case "3_YEARS":
      return 365 * 3;
    case "5_YEARS":
      return 365 * 5;
    case "INDEFINITE":
      return null;
  }
}

/**
 * Retention policy configuration for an organization
 */
export type RetentionPolicy = {
  id: string;
  organizationId: string;
  period: RetentionPeriod;
  effectiveFrom: string; // ISO date
  createdAt: string; // ISO date
  createdBy: string; // Actor identifier
  description?: string;
};

/**
 * Retention policy with revision tracking for optimistic concurrency control
 */
export type RetentionPolicyWithRevision = WithRevision<RetentionPolicy>;

/**
 * Request to create or update a retention policy
 */
export type UpdateRetentionPolicyRequest = {
  period: RetentionPeriod;
  description?: string;
};

/**
 * Request to update retention policy with revision tracking
 */
export type UpdateRetentionPolicyRequestWithRevision = UpdateRetentionPolicyRequest & {
  __revision?: string;
};

/**
 * Status of a legal hold - whether it's currently active or has been released
 */
export type LegalHoldStatus = "ACTIVE" | "RELEASED" | "EXPIRED";

/**
 * Specifies the scope of audit records affected by a legal hold
 */
export type LegalHoldScope = {
  startDate: string; // ISO date (inclusive)
  endDate: string; // ISO date (inclusive)
  affectedRecordCount?: number; // Approximate count of audit entries in range
};

/**
 * Release approval tracking for a legal hold
 */
export type ReleaseApproval = {
  approvedAt: string; // ISO date
  approvedBy: string; // Actor identifier
  reason?: string;
};

/**
 * Legal hold - prevents deletion of audit records within a date range
 */
export type LegalHold = {
  id: string;
  organizationId: string;
  status: LegalHoldStatus;
  scope: LegalHoldScope;
  reason: string;
  createdAt: string; // ISO date
  createdBy: string; // Actor identifier
  expiresAt: string | null; // ISO date, null means no expiration unless explicitly released
  releaseApproval?: ReleaseApproval;
};

/**
 * Legal hold with revision tracking
 */
export type LegalHoldWithRevision = WithRevision<LegalHold>;

/**
 * Request to create a legal hold
 */
export type CreateLegalHoldRequest = {
  startDate: string; // ISO date (inclusive)
  endDate: string; // ISO date (inclusive)
  reason: string;
  expiresAt?: string; // ISO date, optional
};

/**
 * Request to release a legal hold (requires approval)
 */
export type ReleaseLegalHoldRequest = {
  reason?: string; // Why the hold is being released
};

/**
 * Paginated list of retention policies
 */
export type RetentionPoliciesPage = {
  policies: RetentionPolicyWithRevision[];
  nextCursor: string | null;
};

/**
 * Paginated list of legal holds
 */
export type LegalHoldsPage = {
  holds: LegalHoldWithRevision[];
  nextCursor: string | null;
};

/**
 * Result type for operations that can fail with normalized errors
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: NormalizedError };

/**
 * Validation constants
 */
export const MAX_HOLD_DATE_RANGE_DAYS = 365 * 10; // 10 years max span
export const MIN_HOLD_DATE_RANGE_DAYS = 1;

/**
 * Validates a legal hold date range
 */
export function validateLegalHoldDateRange(
  startDate: string,
  endDate: string
): string | null {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return "Invalid date format";
  }

  if (start > end) {
    return "Start date must be before or equal to end date";
  }

  const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  if (spanDays < MIN_HOLD_DATE_RANGE_DAYS) {
    return "Date range must span at least 1 day";
  }

  if (spanDays > MAX_HOLD_DATE_RANGE_DAYS) {
    return `Date range cannot exceed ${MAX_HOLD_DATE_RANGE_DAYS} days`;
  }

  return null;
}

/**
 * Validates legal hold reason
 */
export function validateLegalHoldReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) {
    return "Reason is required";
  }
  if (trimmed.length < 10) {
    return "Reason must be at least 10 characters";
  }
  if (trimmed.length > 1000) {
    return "Reason must not exceed 1000 characters";
  }
  return null;
}

/**
 * Get the current retention policy for an organization
 */
export async function getRetentionPolicy(
  token: string,
  signal: AbortSignal
): Promise<RetentionPolicyWithRevision> {
  return retryRead(async (signal) => {
    const policy = await apiClient<RetentionPolicy>({
      path: "/audit/retention-policy",
      method: "GET",
      headers: bearer(token),
      signal,
    });
    return captureRevision(policy);
  }, signal);
}

/**
 * Get retention policy history (paginated)
 */
export async function getRetentionPoliciesHistory(
  token: string,
  signal: AbortSignal,
  cursor?: string
): Promise<RetentionPoliciesPage> {
  return retryRead(async (signal) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const query = params.toString();
    return apiClient<RetentionPoliciesPage>({
      path: `/audit/retention-policy/history${query ? "?" + query : ""}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Update the retention policy for an organization
 */
export async function updateRetentionPolicy(
  token: string,
  request: UpdateRetentionPolicyRequest,
  signal: AbortSignal
): Promise<RetentionPolicyWithRevision> {
  return retryMutation(async (signal) => {
    const policy = await apiClient<RetentionPolicy>({
      path: "/audit/retention-policy",
      method: "PUT",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
    return captureRevision(policy);
  }, signal);
}

/**
 * Safe wrapper around updateRetentionPolicy with error normalization
 */
export async function updateRetentionPolicySafe(
  token: string,
  request: UpdateRetentionPolicyRequest,
  signal: AbortSignal
): Promise<ApiResult<RetentionPolicyWithRevision>> {
  try {
    const data = await updateRetentionPolicy(token, request, signal);
    return { success: true, data };
  } catch (error) {
    const normalizedError = await normalizeError(error);
    return { success: false, error: normalizedError };
  }
}

/**
 * Get all active legal holds for an organization (paginated)
 */
export async function getLegalHolds(
  token: string,
  signal: AbortSignal,
  status?: LegalHoldStatus,
  cursor?: string
): Promise<LegalHoldsPage> {
  return retryRead(async (signal) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (cursor) params.set("cursor", cursor);
    const query = params.toString();
    return apiClient<LegalHoldsPage>({
      path: `/audit/legal-holds${query ? "?" + query : ""}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Get a specific legal hold by ID
 */
export async function getLegalHold(
  token: string,
  holdId: string,
  signal: AbortSignal
): Promise<LegalHoldWithRevision> {
  return retryRead(async (signal) => {
    const hold = await apiClient<LegalHold>({
      path: `/audit/legal-holds/${holdId}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
    return captureRevision(hold);
  }, signal);
}

/**
 * Create a new legal hold
 * Server-side authorization ensures only ADMIN role can create holds
 */
export async function createLegalHold(
  token: string,
  request: CreateLegalHoldRequest,
  signal: AbortSignal
): Promise<LegalHoldWithRevision> {
  return retryMutation(async (signal) => {
    const hold = await apiClient<LegalHold>({
      path: "/audit/legal-holds",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
    return captureRevision(hold);
  }, signal);
}

/**
 * Safe wrapper around createLegalHold with error normalization
 */
export async function createLegalHoldSafe(
  token: string,
  request: CreateLegalHoldRequest,
  signal: AbortSignal
): Promise<ApiResult<LegalHoldWithRevision>> {
  try {
    const data = await createLegalHold(token, request, signal);
    return { success: true, data };
  } catch (error) {
    const normalizedError = await normalizeError(error);
    return { success: false, error: normalizedError };
  }
}

/**
 * Release a legal hold (mark as RELEASED)
 * Server-side authorization ensures only ADMIN role can release holds
 */
export async function releaseLegalHold(
  token: string,
  holdId: string,
  request: ReleaseLegalHoldRequest,
  signal: AbortSignal
): Promise<LegalHoldWithRevision> {
  return retryMutation(async (signal) => {
    const hold = await apiClient<LegalHold>({
      path: `/audit/legal-holds/${holdId}/release`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
    return captureRevision(hold);
  }, signal);
}

/**
 * Safe wrapper around releaseLegalHold with error normalization
 */
export async function releaseLegalHoldSafe(
  token: string,
  holdId: string,
  request: ReleaseLegalHoldRequest,
  signal: AbortSignal
): Promise<ApiResult<LegalHoldWithRevision>> {
  try {
    const data = await releaseLegalHold(token, holdId, request, signal);
    return { success: true, data };
  } catch (error) {
    const normalizedError = await normalizeError(error);
    return { success: false, error: normalizedError };
  }
}

/**
 * Format legal hold status for UI display
 */
export function formatLegalHoldStatus(status: LegalHoldStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "RELEASED":
      return "Released";
    case "EXPIRED":
      return "Expired";
  }
}

/**
 * Get status tone for styling (success/warning/accent)
 */
export function getLegalHoldStatusTone(status: LegalHoldStatus): "success" | "warning" | "accent" {
  switch (status) {
    case "ACTIVE":
      return "warning";
    case "RELEASED":
      return "success";
    case "EXPIRED":
      return "accent";
  }
}

/**
 * Check if an audit record date is covered by any active legal hold
 */
export function isDateCoveredByHold(
  date: string,
  holds: LegalHold[]
): boolean {
  const targetDate = new Date(date).getTime();
  return holds.some((hold) => {
    if (hold.status !== "ACTIVE") return false;
    const start = new Date(hold.scope.startDate).getTime();
    const end = new Date(hold.scope.endDate).getTime();
    return targetDate >= start && targetDate <= end;
  });
}

/**
 * Calculate when an audit record becomes eligible for deletion based on retention policy
 */
export function calculateCleanupEligibilityDate(
  createdAt: string,
  retentionPeriod: RetentionPeriod
): string | null {
  const days = retentionPeriodToDays(retentionPeriod);
  if (days === null) return null; // Indefinite retention

  const created = new Date(createdAt);
  const eligible = new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
  return eligible.toISOString();
}

/**
 * Check if a record is eligible for cleanup based on retention policy and holds
 */
export function isEligibleForCleanup(
  recordCreatedAt: string,
  retentionPolicy: RetentionPolicy,
  legalHolds: LegalHold[]
): boolean {
  // Never eligible if covered by active legal hold
  if (isDateCoveredByHold(recordCreatedAt, legalHolds)) {
    return false;
  }

  // Check retention policy expiry
  const eligibilityDate = calculateCleanupEligibilityDate(
    recordCreatedAt,
    retentionPolicy.period
  );

  if (eligibilityDate === null) {
    return false; // Indefinite retention
  }

  const now = new Date();
  return new Date(eligibilityDate) <= now;
}
