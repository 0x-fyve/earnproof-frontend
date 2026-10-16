"use client";

/**
 * ApprovalQueue Component
 * 
 * Displays a filterable list of pending and recent operations requiring review.
 * Features:
 * - Typed filters (status, operation type, date range, expiry window)
 * - Age and expiry indicators with color coding
 * - Detail view and approval/rejection workflow
 * - Conflict detection and recovery
 * - Authorization checks (admin-only approval)
 * 
 * State management:
 * - Fetches operations from API on mount and filter changes
 * - Caches in localStorage store for recovery
 * - Detects concurrent modifications (409 Conflict)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalOperation, ApprovalFilters, OPERATION_TYPES, OPERATION_STATUS } from "@/lib/validation/operations";
import { getApprovalOperations, canUserApproveOperations } from "@/lib/api/approvals";
import { upsertOperations, listOperations, invalidateCache } from "@/lib/approvals/store";
import {
  getExpiryStatus,
  formatTimeRemaining,
  formatAge,
  getExpiryWarningLevel,
  shouldHighlightForExpiry,
} from "@/lib/approvals/expiry";
import { ApiNetworkError, ApiConflictError } from "@/lib/api/client";

export interface ApprovalQueueProps {
  /**
   * User ID for store scoping and authorization checks
   */
  userId: string;

  /**
   * Organization ID to fetch approvals for
   */
  organizationId: string;

  /**
   * Bearer token for API requests
   */
  token: string;

  /**
   * Current user's role (OWNER, ADMIN, MEMBER, etc.)
   */
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null;

  /**
   * Callback when operation is selected for detail view
   */
  onSelectOperation?: (operation: ApprovalOperation) => void;

  /**
   * Callback when operation is approved/rejected (for cache invalidation)
   */
  onOperationActioned?: (operation: ApprovalOperation, action: "approve" | "reject") => void;

  /**
   * Optional: initial filters to apply
   */
  initialFilters?: ApprovalFilters;

  /**
   * Optional: show only pending operations by default
   */
  showPendingByDefault?: boolean;
}

interface FilterState {
  status?: ApprovalFilters["status"];
  operationType?: ApprovalFilters["operationType"];
  onlyMyRequests?: boolean;
}

interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

/**
 * Main approval queue component.
 */
export function ApprovalQueue({
  userId,
  organizationId,
  token,
  userRole,
  onSelectOperation,
  onOperationActioned,
  initialFilters,
  showPendingByDefault = true,
}: ApprovalQueueProps) {
  // Filters
  const [filters, setFilters] = useState<FilterState>({
    status: showPendingByDefault ? "pending" : initialFilters?.status,
    operationType: initialFilters?.operationType,
    onlyMyRequests: false,
  });

  // Loading and error states
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: true,
    error: null,
  });

  // Operations from store
  const [operations, setOperations] = useState<ApprovalOperation[]>([]);

  // Track concurrent modification warnings
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const canApprove = canUserApproveOperations(userRole);

  /**
   * Build filter object for API request
   */
  const apiFilters = useMemo<ApprovalFilters>(() => {
    const result: ApprovalFilters = {
      status: filters.status,
      operationType: filters.operationType,
      organizationId,
      ...initialFilters,
    };

    if (filters.onlyMyRequests) {
      result.requestedBy = userId;
    }

    return result;
  }, [filters, initialFilters, organizationId, userId]);

  /**
   * Fetch operations from API and cache in store
   */
  const fetchOperations = useCallback(async () => {
    setLoadingState({ isLoading: true, error: null });
    setConflictWarning(null);

    try {
      const signal = new AbortController().signal;
      const response = await getApprovalOperations(token, organizationId, apiFilters, signal);

      // Cache in store
      upsertOperations(userId, organizationId, response.operations);

      // Update display
      setOperations(response.operations);
      setLoadingState({ isLoading: false, error: null });
    } catch (error) {
      let errorMessage = "Failed to load operations";

      if (error instanceof ApiNetworkError) {
        errorMessage = "Network error. Please check your connection.";
      } else if (error instanceof ApiConflictError) {
        errorMessage =
          "Operations were modified concurrently. Please refresh to see latest changes.";
        setConflictWarning(errorMessage);
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Fall back to cached data if available
      const cached = listOperations(userId, organizationId, apiFilters);
      if (cached.length > 0) {
        setOperations(cached);
        setLoadingState({
          isLoading: false,
          error: `${errorMessage} (showing cached data)`,
        });
      } else {
        setLoadingState({ isLoading: false, error: errorMessage });
      }
    }
  }, [token, organizationId, userId, apiFilters]);

  /**
   * Fetch operations on mount and when filters change
   */
  useEffect(() => {
    fetchOperations();
  }, [fetchOperations]);

  /**
   * Handle filter changes
   */
  const handleStatusFilterChange = useCallback((status: string | null) => {
    setFilters((prev) => ({
      ...prev,
      status: status as ApprovalFilters["status"],
    }));
  }, []);

  const handleTypeFilterChange = useCallback((type: string | null) => {
    setFilters((prev) => ({
      ...prev,
      operationType: type as ApprovalFilters["operationType"],
    }));
  }, []);

  const handleMyRequestsToggle = useCallback((checked: boolean) => {
    setFilters((prev) => ({
      ...prev,
      onlyMyRequests: checked,
    }));
  }, []);

  const handleRefresh = useCallback(() => {
    invalidateCache(userId, organizationId);
    fetchOperations();
  }, [userId, organizationId, fetchOperations]);

  const handleOperationActioned = useCallback(
    (operation: ApprovalOperation, action: "approve" | "reject") => {
      // Invalidate cache and refetch
      invalidateCache(userId, organizationId);
      fetchOperations();
      onOperationActioned?.(operation, action);
    },
    [userId, organizationId, fetchOperations, onOperationActioned]
  );

  // Render loading state
  if (loadingState.isLoading && operations.length === 0) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-gray-200 rounded animate-pulse" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Render error state
  if (loadingState.error && operations.length === 0) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800 font-medium">Error loading operations</p>
        <p className="text-red-700 text-sm mt-1">{loadingState.error}</p>
        <button
          onClick={handleRefresh}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Conflict warning banner */}
      {conflictWarning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex justify-between items-center">
          <div>
            <p className="text-yellow-800 font-medium">Concurrent Modification</p>
            <p className="text-yellow-700 text-sm">{conflictWarning}</p>
          </div>
          <button
            onClick={handleRefresh}
            className="px-3 py-1 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700 transition"
          >
            Refresh
          </button>
        </div>
      )}

      {/* Error banner (non-fatal) */}
      {loadingState.error && operations.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-amber-800 text-sm">{loadingState.error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Status filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              value={filters.status || ""}
              onChange={(e) => handleStatusFilterChange(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All statuses</option>
              {OPERATION_STATUS.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Type filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <select
              value={filters.operationType || ""}
              onChange={(e) => handleTypeFilterChange(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All types</option>
              {OPERATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                </option>
              ))}
            </select>
          </div>

          {/* My requests toggle */}
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.onlyMyRequests}
                onChange={(e) => handleMyRequestsToggle(e.target.checked)}
                className="w-4 h-4 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">My Requests</span>
            </label>
          </div>

          {/* Refresh button */}
          <div className="flex items-end">
            <button
              onClick={handleRefresh}
              disabled={loadingState.isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingState.isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* Operations list */}
      <div className="space-y-2">
        {operations.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center border border-gray-200">
            <p className="text-gray-600">No operations found</p>
            <p className="text-gray-500 text-sm mt-1">Adjust filters to see more results</p>
          </div>
        ) : (
          operations.map((operation) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              canApprove={canApprove}
              onSelect={() => onSelectOperation?.(operation)}
              onActioned={(action) => handleOperationActioned(operation, action)}
            />
          ))
        )}
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-600 pt-2">
        Showing {operations.length} operation{operations.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

/**
 * Individual operation row in the queue list
 */
interface OperationRowProps {
  operation: ApprovalOperation;
  canApprove: boolean;
  onSelect: () => void;
  onActioned: (action: "approve" | "reject") => void;
}

function OperationRow({ operation, canApprove, onSelect, onActioned }: OperationRowProps) {
  const expiryStatus = getExpiryStatus(operation.expiresAt);
  const warningLevel = getExpiryWarningLevel(operation.expiresAt);
  const shouldHighlight = shouldHighlightForExpiry(operation.expiresAt);

  const borderColor = {
    expired: "border-l-4 border-l-red-500",
    "expiring-soon": "border-l-4 border-l-yellow-500",
    valid: "border-l-4 border-l-gray-300",
  }[expiryStatus];

  const bgColor = shouldHighlight ? "bg-gray-50" : "bg-white";

  const operationLabel = getOperationLabel(operation);
  const statusBadge = getStatusBadge(operation.status);
  const typeBadge = getTypeBadge(operation.operationType);

  return (
    <div className={`border rounded-lg p-4 ${bgColor} ${borderColor} hover:shadow-md transition`}>
      <div className="flex items-start justify-between gap-4">
        {/* Main content */}
        <div className="flex-1 cursor-pointer" onClick={onSelect}>
          <div className="flex items-center gap-2 mb-2">
            {typeBadge}
            {statusBadge}
          </div>
          <p className="font-medium text-gray-900">{operationLabel}</p>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
            <span title={operation.createdAt}>📅 {formatAge(operation.createdAt)}</span>
            <span title={operation.expiresAt}>⏱️ {formatTimeRemaining(operation.expiresAt)}</span>
            {operation.approverId && (
              <span className="text-gray-700">✓ Approved by {operation.approverId}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        {canApprove && operation.status === "pending" && expiryStatus !== "expired" && (
          <div className="flex gap-2">
            <button
              onClick={() => onActioned("approve")}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition"
            >
              Approve
            </button>
            <button
              onClick={() => onActioned("reject")}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition"
            >
              Reject
            </button>
          </div>
        )}

        {/* View details button */}
        <button
          onClick={onSelect}
          className="px-3 py-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
        >
          Details →
        </button>
      </div>
    </div>
  );
}

/**
 * Get human-readable label for operation
 */
function getOperationLabel(operation: ApprovalOperation): string {
  switch (operation.operationType) {
    case "role-change":
      return `Change role for ${operation.targetWalletAddress?.slice(0, 10)}... to ${operation.newRole}`;
    case "export":
      return `${operation.exportType.charAt(0).toUpperCase() + operation.exportType.slice(1)} export of ${operation.exportScope?.join(", ")}`;
    case "recovery":
      return `Recovery via ${operation.recoveryMethod} for ${operation.walletAddress?.slice(0, 10)}...`;
    case "key-rotation":
      return `Rotate ${operation.keyType} key (${operation.keyId})`;
    case "governance":
      return `Governance: ${operation.changeType}`;
    default:
      return "Unknown operation";
  }
}

/**
 * Get status badge component
 */
function getStatusBadge(status: string): React.ReactNode {
  const styles = {
    pending: "bg-blue-100 text-blue-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    expired: "bg-gray-100 text-gray-800",
    revoked: "bg-gray-100 text-gray-800",
  };

  const style = (styles as Record<string, string>)[status] || styles.pending;

  return (
    <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${style}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/**
 * Get type badge component
 */
function getTypeBadge(type: string): React.ReactNode {
  const styles = {
    "role-change": "bg-purple-100 text-purple-800",
    export: "bg-orange-100 text-orange-800",
    recovery: "bg-pink-100 text-pink-800",
    "key-rotation": "bg-indigo-100 text-indigo-800",
    governance: "bg-teal-100 text-teal-800",
  };

  const style = (styles as Record<string, string>)[type] || "bg-gray-100 text-gray-800";
  const label = type.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  return (
    <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${style}`}>
      {label}
    </span>
  );
}
