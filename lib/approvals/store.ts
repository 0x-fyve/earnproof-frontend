/**
 * Client-side store for approval operation queue state.
 * 
 * Provides in-memory caching, filtering, and pagination of operations.
 * State persists across page reloads via localStorage, enabling recovery
 * from interrupted workflows and stale-data detection.
 * 
 * Pattern: localStorage-backed store scoped by userId, with explicit
 * state transitions and conflict detection similar to payment-backfill.
 */

import {
  ApprovalOperation,
  ApprovalFilters,
  OperationStatus,
  isTerminalStatus,
} from "@/lib/validation/operations";

/**
 * Store entry includes metadata for conflict detection and recovery.
 */
export interface ApprovalStoreEntry {
  operation: ApprovalOperation;
  cachedAt: string;
  loadedRevision?: string;
}

/**
 * In-memory cache of operations indexed by ID for fast lookup.
 * Includes pagination state.
 */
interface ApprovalStoreState {
  operations: Map<string, ApprovalStoreEntry>;
  lastUpdated: string;
  pageNumber: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Storage key prefix for approval state.
 * Format: `earnproof:approvals:{userId}:{organizationId}`
 */
function getStoreKey(userId: string, organizationId: string): string {
  return `earnproof:approvals:${userId}:${organizationId}`;
}

/**
 * Load the in-memory cache from localStorage.
 * Returns empty cache if no data stored.
 */
function loadFromStorage(userId: string, organizationId: string): ApprovalStoreState {
  const key = getStoreKey(userId, organizationId);
  
  if (typeof window === "undefined") {
    return createEmptyState();
  }

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return createEmptyState();

    const parsed = JSON.parse(stored);
    
    // Reconstruct Map from stored entries
    const operations = new Map<string, ApprovalStoreEntry>();
    if (Array.isArray(parsed.operations)) {
      for (const [id, entry] of parsed.operations) {
        operations.set(id, entry);
      }
    }

    return {
      operations,
      lastUpdated: parsed.lastUpdated || new Date().toISOString(),
      pageNumber: parsed.pageNumber || 0,
      pageSize: parsed.pageSize || 25,
      total: parsed.total || 0,
      hasMore: parsed.hasMore || false,
    };
  } catch (error) {
    // Corrupted storage, start fresh
    console.warn(`Failed to load approvals store for ${key}:`, error);
    window.localStorage.removeItem(key);
    return createEmptyState();
  }
}

/**
 * Save the in-memory cache to localStorage.
 */
function saveToStorage(
  userId: string,
  organizationId: string,
  state: ApprovalStoreState
): void {
  if (typeof window === "undefined") return;

  const key = getStoreKey(userId, organizationId);
  
  try {
    // Convert Map to array for JSON serialization
    const toStore = {
      operations: Array.from(state.operations.entries()),
      lastUpdated: state.lastUpdated,
      pageNumber: state.pageNumber,
      pageSize: state.pageSize,
      total: state.total,
      hasMore: state.hasMore,
    };
    window.localStorage.setItem(key, JSON.stringify(toStore));
  } catch (error) {
    console.warn(`Failed to save approvals store for ${key}:`, error);
  }
}

/**
 * Create an empty store state.
 */
function createEmptyState(): ApprovalStoreState {
  return {
    operations: new Map(),
    lastUpdated: new Date().toISOString(),
    pageNumber: 0,
    pageSize: 25,
    total: 0,
    hasMore: false,
  };
}

/**
 * Add or update operations in the store.
 * Updates lastUpdated timestamp and persists to localStorage.
 */
export function upsertOperations(
  userId: string,
  organizationId: string,
  operations: ApprovalOperation[]
): void {
  const state = loadFromStorage(userId, organizationId);

  for (const operation of operations) {
    state.operations.set(operation.id, {
      operation,
      cachedAt: new Date().toISOString(),
    });
  }

  state.lastUpdated = new Date().toISOString();
  saveToStorage(userId, organizationId, state);
}

/**
 * Remove an operation from the store (e.g., after approval/rejection).
 */
export function removeOperation(
  userId: string,
  organizationId: string,
  operationId: string
): void {
  const state = loadFromStorage(userId, organizationId);
  state.operations.delete(operationId);
  state.lastUpdated = new Date().toISOString();
  saveToStorage(userId, organizationId, state);
}

/**
 * Get a single operation from the store, or null if not found.
 */
export function getOperation(
  userId: string,
  organizationId: string,
  operationId: string
): ApprovalOperation | null {
  const state = loadFromStorage(userId, organizationId);
  const entry = state.operations.get(operationId);
  return entry?.operation || null;
}

/**
 * List all operations in the store with optional filtering.
 * Filtering is performed in-memory; use API for server-side filtering.
 */
export function listOperations(
  userId: string,
  organizationId: string,
  filters?: ApprovalFilters
): ApprovalOperation[] {
  const state = loadFromStorage(userId, organizationId);
  let operations = Array.from(state.operations.values()).map((e) => e.operation);

  // Apply filters in-memory
  if (filters) {
    if (filters.status) {
      operations = operations.filter((op) => op.status === filters.status);
    }

    if (filters.operationType) {
      operations = operations.filter((op) => op.operationType === filters.operationType);
    }

    if (filters.approverId) {
      operations = operations.filter((op) => op.approverId === filters.approverId);
    }

    if (filters.requestedBy) {
      operations = operations.filter((op) => op.requestedBy === filters.requestedBy);
    }

    if (filters.createdAfter) {
      const after = new Date(filters.createdAfter).getTime();
      operations = operations.filter(
        (op) => new Date(op.createdAt).getTime() >= after
      );
    }

    if (filters.createdBefore) {
      const before = new Date(filters.createdBefore).getTime();
      operations = operations.filter((op) => new Date(op.createdAt).getTime() <= before);
    }

    if (filters.expiresInDays !== undefined) {
      const cutoffTime = Date.now() + filters.expiresInDays * 24 * 60 * 60 * 1000;
      operations = operations.filter(
        (op) => new Date(op.expiresAt).getTime() <= cutoffTime
      );
    }
  }

  // Sort by creation date descending (newest first)
  operations.sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return operations;
}

/**
 * Get operations pending for a specific approver (status = pending, not requester).
 */
export function getPendingForApprover(
  userId: string,
  organizationId: string,
  approverId: string
): ApprovalOperation[] {
  const operations = listOperations(userId, organizationId, { status: "pending" });
  return operations.filter((op) => op.requestedBy !== approverId);
}

/**
 * Get operations recently acted upon (approved or rejected in last N hours).
 */
export function getRecentlyActedUpon(
  userId: string,
  organizationId: string,
  hoursBack = 24
): ApprovalOperation[] {
  const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;
  const operations = listOperations(userId, organizationId);

  return operations.filter((op) => {
    if (!op.approvedAt && !op.rejectionReason) return false;
    const approvalTime = new Date(op.approvedAt || op.rejectionReason || "").getTime();
    return approvalTime >= cutoffTime;
  });
}

/**
 * Clear all operations for an organization (e.g., after logout).
 */
export function clearOperations(userId: string, organizationId: string): void {
  if (typeof window === "undefined") return;
  const key = getStoreKey(userId, organizationId);
  window.localStorage.removeItem(key);
}

/**
 * Update pagination metadata in the store.
 * Used after fetching new page of results from API.
 */
export function updatePaginationMetadata(
  userId: string,
  organizationId: string,
  metadata: {
    pageNumber: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }
): void {
  const state = loadFromStorage(userId, organizationId);
  state.pageNumber = metadata.pageNumber;
  state.pageSize = metadata.pageSize;
  state.total = metadata.total;
  state.hasMore = metadata.hasMore;
  state.lastUpdated = new Date().toISOString();
  saveToStorage(userId, organizationId, state);
}

/**
 * Get cache metadata (last updated time, total count).
 * Useful for stale-data warnings or cache invalidation logic.
 */
export function getCacheMetadata(userId: string, organizationId: string) {
  const state = loadFromStorage(userId, organizationId);
  return {
    lastUpdated: state.lastUpdated,
    cachedCount: state.operations.size,
    total: state.total,
    hasMore: state.hasMore,
    pageNumber: state.pageNumber,
    pageSize: state.pageSize,
  };
}

/**
 * Check if an operation in the cache is stale (differs from provided version).
 * Used for detecting concurrent modifications.
 */
export function isOperationStale(
  userId: string,
  organizationId: string,
  operation: ApprovalOperation,
  serverRevision?: string
): boolean {
  const cached = getOperation(userId, organizationId, operation.id);
  if (!cached) return false;

  // If server provides explicit revision, compare it
  if (serverRevision) {
    return cached.conflictVersion !== serverRevision;
  }

  // Otherwise, compare operation status
  return cached.status !== operation.status;
}

/**
 * Detect conflicts: if an operation is terminal/expired, no further action is allowed.
 * Returns error message if conflict detected, null if OK.
 */
export function detectOperationConflict(
  operation: ApprovalOperation,
  approverId: string
): string | null {
  // Terminal operations (approved, rejected, expired) cannot be acted upon
  if (isTerminalStatus(operation.status)) {
    return `Cannot act on ${operation.status} operations.`;
  }

  // Expired operations cannot be acted upon
  const expiryTime = new Date(operation.expiresAt).getTime();
  if (expiryTime < Date.now()) {
    return "Operation has expired.";
  }

  // User cannot approve own operations
  if (operation.requestedBy === approverId) {
    return "You cannot approve your own operations.";
  }

  return null;
}

/**
 * Compact store by removing expired operations.
 * Call periodically to clean up stale data.
 */
export function compactStore(userId: string, organizationId: string): void {
  const state = loadFromStorage(userId, organizationId);
  const now = Date.now();

  for (const [id, entry] of state.operations.entries()) {
    const expiryTime = new Date(entry.operation.expiresAt).getTime();
    if (expiryTime < now && isTerminalStatus(entry.operation.status)) {
      state.operations.delete(id);
    }
  }

  saveToStorage(userId, organizationId, state);
}

/**
 * Invalidate cache for a specific organization.
 * Call this after performing an action (approve/reject) to force fresh API fetch.
 */
export function invalidateCache(userId: string, organizationId: string): void {
  clearOperations(userId, organizationId);
}

/**
 * Export store state for debugging or testing.
 */
export function exportStoreState(userId: string, organizationId: string) {
  const state = loadFromStorage(userId, organizationId);
  return {
    operations: Array.from(state.operations.values()),
    metadata: {
      lastUpdated: state.lastUpdated,
      pageNumber: state.pageNumber,
      pageSize: state.pageSize,
      total: state.total,
      hasMore: state.hasMore,
    },
  };
}
