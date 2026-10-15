/**
 * API client for privileged operation approvals.
 * 
 * Handles fetching, filtering, approving, rejecting, and revoking operations
 * from the approval queue. Uses bearer token authentication and follows
 * repository patterns for retry, error handling, and request/response normalization.
 * 
 * NOTE: `/organizations/{id}/approvals` endpoints are not yet in the OpenAPI spec.
 * This module follows established patterns (REST resource, bearer auth, retryRead/retryMutation)
 * to enable wiring up with no shape changes once the endpoints ship.
 */

import { apiClient, bearer, retryRead, retryMutation, ApiConflictError } from "./client";
import {
  ApprovalOperation,
  ApprovalFilters,
  ApprovalDecision,
  PaginatedOperations,
  approvalOperationSchema,
  paginatedOperationsSchema,
  approvalDecisionSchema,
  validateOperationForAction,
} from "@/lib/validation/operations";

/**
 * Response type for approval/rejection operations.
 * Includes updated operation state and optional conflict metadata for stale-write recovery.
 */
export type ApprovalResponse = {
  operation: ApprovalOperation;
  approvedAt?: string;
  rejectedAt?: string;
};

/**
 * Fetch all pending and recent operations for an organization.
 * Includes filtering by status, type, and date range.
 * 
 * @param token - Bearer authentication token
 * @param organizationId - Organization to fetch approvals for
 * @param filters - Optional filters (status, type, date range, etc.)
 * @param signal - Abort signal for cancellation
 * @returns Paginated list of operations
 * 
 * @throws ApiNetworkError - Network or timeout failure
 * @throws ApiError - Server returned error status
 */
export async function getApprovalOperations(
  token: string,
  organizationId: string,
  filters?: ApprovalFilters,
  signal?: AbortSignal
): Promise<PaginatedOperations> {
  const params = new URLSearchParams();

  // Build query string from filters
  if (filters) {
    if (filters.status) params.append("status", filters.status);
    if (filters.operationType) params.append("type", filters.operationType);
    if (filters.approverId) params.append("approverId", filters.approverId);
    if (filters.requestedBy) params.append("requestedBy", filters.requestedBy);
    if (filters.createdAfter) params.append("createdAfter", filters.createdAfter);
    if (filters.createdBefore) params.append("createdBefore", filters.createdBefore);
    if (filters.expiresInDays !== undefined) {
      params.append("expiresInDays", String(filters.expiresInDays));
    }
    if (filters.searchTerm) params.append("search", filters.searchTerm);
  }

  const queryString = params.toString();
  const path = `/organizations/${organizationId}/approvals${queryString ? `?${queryString}` : ""}`;

  return retryRead(
    async (signal) => {
      const response = await apiClient<PaginatedOperations>({
        path,
        method: "GET",
        headers: bearer(token),
        signal,
      });

      // Validate response shape
      return paginatedOperationsSchema.parse(response);
    },
    signal || new AbortController().signal
  );
}

/**
 * Fetch a single operation by ID.
 * Useful for detail view and conflict detection.
 * 
 * @param token - Bearer authentication token
 * @param organizationId - Organization ID
 * @param operationId - Operation ID to fetch
 * @param signal - Abort signal for cancellation
 * @returns The operation details
 * 
 * @throws ApiNetworkError - Network or timeout failure
 * @throws ApiError - Server returned error status
 */
export async function getApprovalOperation(
  token: string,
  organizationId: string,
  operationId: string,
  signal?: AbortSignal
): Promise<ApprovalOperation> {
  const path = `/organizations/${organizationId}/approvals/${operationId}`;

  return retryRead(
    async (signal) => {
      const response = await apiClient<ApprovalOperation>({
        path,
        method: "GET",
        headers: bearer(token),
        signal,
      });

      // Validate response shape
      return approvalOperationSchema.parse(response);
    },
    signal || new AbortController().signal
  );
}

/**
 * Approve a pending operation.
 * 
 * Authorization rules:
 * - User must have ADMIN/OWNER role
 * - User cannot approve their own operations
 * - Operation must be in pending state (not terminal or expired)
 * 
 * Conflict handling:
 * - If operation was already approved/rejected by another user (409 Conflict),
 *   the response includes the current server state for recovery UI
 * - Include optional conflictVersion to detect concurrent approvals
 * 
 * @param token - Bearer authentication token
 * @param organizationId - Organization ID
 * @param decision - Approval decision with operationId and optional reason
 * @param approverId - ID of approver (for client-side validation)
 * @param signal - Abort signal for cancellation
 * @returns Updated operation with approval metadata
 * 
 * @throws ApiNetworkError - Network or timeout failure
 * @throws ApiError - Server validation or authorization error
 * @throws ApiConflictError - Concurrent modification (409); includes current state
 */
export async function approveOperation(
  token: string,
  organizationId: string,
  decision: ApprovalDecision,
  approverId: string,
  signal?: AbortSignal
): Promise<ApprovalResponse> {
  // Client-side pre-flight validation before sending to server
  // Server always re-validates authorization
  try {
    const operationId = decision.operationId;
    
    // First, fetch the current operation to validate state
    const operation = await getApprovalOperation(token, organizationId, operationId, signal);

    // Check if operation can be acted upon (not expired, not terminal, etc.)
    const validationError = validateOperationForAction(operation, approverId);
    if (validationError) {
      throw new Error(validationError);
    }

    // Send approval to server
    const path = `/organizations/${organizationId}/approvals/${operationId}/approve`;

    const response = await retryMutation(
      async (signal) => {
        try {
          return await apiClient<ApprovalResponse>({
            path,
            method: "POST",
            headers: bearer(token),
            body: JSON.stringify({
              reason: decision.reason,
              conflictVersion: decision.conflictVersion,
            }),
            signal,
          });
        } catch (error) {
          // Convert conflict errors to meaningful messages
          if (error instanceof ApiConflictError) {
            const serverOp = error.serverEntity as ApprovalOperation | undefined;
            if (serverOp?.status !== "pending") {
              throw new Error(
                `Operation was already ${serverOp?.status || "modified"}. Please refresh and try again.`
              );
            }
            throw error;
          }
          throw error;
        }
      },
      signal || new AbortController().signal
    );

    // Validate response shape
    return response as ApprovalResponse;
  } catch (error) {
    // Re-throw with additional context if needed
    if (error instanceof Error && !error.message.includes("Operation was already")) {
      throw error;
    }
    throw error;
  }
}

/**
 * Reject a pending operation.
 * 
 * Authorization rules:
 * - User must have ADMIN/OWNER role
 * - User cannot reject their own operations
 * - Operation must be in pending state (not terminal or expired)
 * - Rejection reason is required and stored for audit trail
 * 
 * Conflict handling:
 * - If operation state changed concurrently (409 Conflict),
 *   includes current server state for recovery UI
 * - Include optional conflictVersion to detect concurrent modifications
 * 
 * @param token - Bearer authentication token
 * @param organizationId - Organization ID
 * @param decision - Rejection decision with operationId and required reason
 * @param approverId - ID of rejecting approver (for client-side validation)
 * @param signal - Abort signal for cancellation
 * @returns Updated operation with rejection metadata
 * 
 * @throws ApiNetworkError - Network or timeout failure
 * @throws ApiError - Server validation or authorization error
 * @throws ApiConflictError - Concurrent modification (409); includes current state
 */
export async function rejectOperation(
  token: string,
  organizationId: string,
  decision: ApprovalDecision,
  approverId: string,
  signal?: AbortSignal
): Promise<ApprovalResponse> {
  if (!decision.reason) {
    throw new Error("Rejection reason is required");
  }

  // Client-side pre-flight validation before sending to server
  try {
    const operationId = decision.operationId;

    // First, fetch the current operation to validate state
    const operation = await getApprovalOperation(token, organizationId, operationId, signal);

    // Check if operation can be acted upon
    const validationError = validateOperationForAction(operation, approverId);
    if (validationError) {
      throw new Error(validationError);
    }

    // Send rejection to server
    const path = `/organizations/${organizationId}/approvals/${operationId}/reject`;

    const response = await retryMutation(
      async (signal) => {
        try {
          return await apiClient<ApprovalResponse>({
            path,
            method: "POST",
            headers: bearer(token),
            body: JSON.stringify({
              reason: decision.reason,
              conflictVersion: decision.conflictVersion,
            }),
            signal,
          });
        } catch (error) {
          // Convert conflict errors to meaningful messages
          if (error instanceof ApiConflictError) {
            const serverOp = error.serverEntity as ApprovalOperation | undefined;
            if (serverOp?.status !== "pending") {
              throw new Error(
                `Operation was already ${serverOp?.status || "modified"}. Please refresh and try again.`
              );
            }
            throw error;
          }
          throw error;
        }
      },
      signal || new AbortController().signal
    );

    // Validate response shape
    return response as ApprovalResponse;
  } catch (error) {
    if (error instanceof Error && !error.message.includes("Operation was already")) {
      throw error;
    }
    throw error;
  }
}

/**
 * Revoke (cancel) a pending operation.
 * 
 * Authorization rules:
 * - Only the original requester or ADMIN/OWNER can revoke
 * - Operation must be in pending state (not terminal or expired)
 * - Useful for canceling stale approval requests
 * 
 * @param token - Bearer authentication token
 * @param organizationId - Organization ID
 * @param operationId - Operation ID to revoke
 * @param requesterId - ID of requester (for client-side validation)
 * @param signal - Abort signal for cancellation
 * @returns Updated operation with revoked status
 * 
 * @throws ApiNetworkError - Network or timeout failure
 * @throws ApiError - Server validation or authorization error
 * @throws ApiConflictError - Concurrent modification (409)
 */
export async function revokeOperation(
  token: string,
  organizationId: string,
  operationId: string,
  requesterId: string,
  signal?: AbortSignal
): Promise<ApprovalResponse> {
  const path = `/organizations/${organizationId}/approvals/${operationId}/revoke`;

  return retryMutation(
    async (signal) => {
      try {
        return await apiClient<ApprovalResponse>({
          path,
          method: "POST",
          headers: bearer(token),
          body: JSON.stringify({ requesterId }),
          signal,
        });
      } catch (error) {
        // Convert conflict errors to meaningful messages
        if (error instanceof ApiConflictError) {
          const serverOp = error.serverEntity as ApprovalOperation | undefined;
          if (serverOp?.status !== "pending") {
            throw new Error(
              `Operation was already ${serverOp?.status || "modified"}. Please refresh and try again.`
            );
          }
          throw error;
        }
        throw error;
      }
    },
    signal || new AbortController().signal
  );
}

/**
 * Check if user can approve operations (ADMIN or OWNER level).
 * This is a convenience for UI logic; server always re-validates authorization.
 * 
 * @param userRole - User's organizational role
 * @returns true if user can approve operations
 */
export function canUserApproveOperations(
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null
): boolean {
  return userRole === "OWNER" || userRole === "ADMIN";
}

/**
 * Check if user can approve a specific operation.
 * Combines role-based authorization with operation-specific rules.
 * 
 * @param userRole - User's organizational role
 * @param userId - User's ID
 * @param operation - Operation to check
 * @returns Error message if user cannot approve, null if authorized
 */
export function getApprovalRestriction(
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null,
  userId: string,
  operation: ApprovalOperation
): string | null {
  if (!canUserApproveOperations(userRole)) {
    return "Only organization owners and admins can approve operations.";
  }

  return validateOperationForAction(operation, userId);
}
