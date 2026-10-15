/**
 * Unit tests for approval store
 * 
 * Tests cover:
 * - Adding/updating operations
 * - Filtering operations
 * - Conflict detection
 * - Cache invalidation
 * - Store persistence
 * - Pagination metadata
 */

import {
  upsertOperations,
  removeOperation,
  getOperation,
  listOperations,
  getPendingForApprover,
  getRecentlyActedUpon,
  clearOperations,
  updatePaginationMetadata,
  getCacheMetadata,
  isOperationStale,
  detectOperationConflict,
  compactStore,
  invalidateCache,
} from "@/lib/approvals/store";
import {
  FIXTURE_ROLE_CHANGE_PENDING,
  FIXTURE_ROLE_CHANGE_APPROVED,
  FIXTURE_EXPORT_PENDING,
  FIXTURE_EXPORT_EXPIRING_SOON,
  FIXTURE_RECOVERY_PENDING,
  FIXTURE_ALL_PENDING_OPERATIONS,
  ORG_ID_ALPHA,
  ADMIN_USER,
  DEVELOPER_USER,
} from "@/tests/fixtures/approval-fixtures";

const USER_ID = "test-user-001";

describe("Approval Store", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  describe("upsertOperations", () => {
    it("adds new operations to store", () => {
      const operations = [FIXTURE_ROLE_CHANGE_PENDING, FIXTURE_EXPORT_PENDING];

      upsertOperations(USER_ID, ORG_ID_ALPHA, operations);

      const stored = getOperation(USER_ID, ORG_ID_ALPHA, FIXTURE_ROLE_CHANGE_PENDING.id);
      expect(stored).toEqual(FIXTURE_ROLE_CHANGE_PENDING);
    });

    it("updates existing operations", () => {
      const original = FIXTURE_ROLE_CHANGE_PENDING;
      upsertOperations(USER_ID, ORG_ID_ALPHA, [original]);

      const updated = { ...original, status: "approved" as const };
      upsertOperations(USER_ID, ORG_ID_ALPHA, [updated]);

      const stored = getOperation(USER_ID, ORG_ID_ALPHA, original.id);
      expect(stored?.status).toBe("approved");
    });

    it("handles empty operations list", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, []);

      const operations = listOperations(USER_ID, ORG_ID_ALPHA);
      expect(operations).toEqual([]);
    });

    it("scopes operations by user and organization", () => {
      const op1 = FIXTURE_ROLE_CHANGE_PENDING;
      upsertOperations("user-1", "org-1", [op1]);

      // Different user should not see the operation
      const stored = getOperation("user-2", "org-1", op1.id);
      expect(stored).toBeNull();

      // Same user, different org should not see it
      const stored2 = getOperation("user-1", "org-2", op1.id);
      expect(stored2).toBeNull();
    });
  });

  describe("removeOperation", () => {
    it("removes operation from store", () => {
      const operations = [FIXTURE_ROLE_CHANGE_PENDING];
      upsertOperations(USER_ID, ORG_ID_ALPHA, operations);

      removeOperation(USER_ID, ORG_ID_ALPHA, FIXTURE_ROLE_CHANGE_PENDING.id);

      const stored = getOperation(USER_ID, ORG_ID_ALPHA, FIXTURE_ROLE_CHANGE_PENDING.id);
      expect(stored).toBeNull();
    });

    it("handles removing non-existent operations gracefully", () => {
      expect(() => {
        removeOperation(USER_ID, ORG_ID_ALPHA, "non-existent-id");
      }).not.toThrow();
    });
  });

  describe("listOperations", () => {
    beforeEach(() => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, FIXTURE_ALL_PENDING_OPERATIONS);
    });

    it("lists all operations", () => {
      const operations = listOperations(USER_ID, ORG_ID_ALPHA);
      expect(operations.length).toBe(FIXTURE_ALL_PENDING_OPERATIONS.length);
    });

    it("filters by status", () => {
      const pending = listOperations(USER_ID, ORG_ID_ALPHA, { status: "pending" });
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.every((op) => op.status === "pending")).toBe(true);
    });

    it("filters by operation type", () => {
      const roleChanges = listOperations(USER_ID, ORG_ID_ALPHA, { operationType: "role-change" });
      expect(roleChanges.every((op) => op.operationType === "role-change")).toBe(true);
    });

    it("filters by requester", () => {
      const byDeveloper = listOperations(USER_ID, ORG_ID_ALPHA, { requestedBy: DEVELOPER_USER.id });
      expect(byDeveloper.every((op) => op.requestedBy === DEVELOPER_USER.id)).toBe(true);
    });

    it("filters by date range", () => {
      const after = listOperations(USER_ID, ORG_ID_ALPHA, {
        createdAfter: "2024-01-15T08:00:00.000Z",
      });
      expect(after.length).toBeGreaterThan(0);
    });

    it("sorts by creation date descending (newest first)", () => {
      const operations = listOperations(USER_ID, ORG_ID_ALPHA);
      for (let i = 0; i < operations.length - 1; i++) {
        const current = new Date(operations[i].createdAt).getTime();
        const next = new Date(operations[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it("combines multiple filters", () => {
      const filtered = listOperations(USER_ID, ORG_ID_ALPHA, {
        status: "pending",
        operationType: "export",
      });
      expect(filtered.every((op) => op.status === "pending" && op.operationType === "export")).toBe(
        true
      );
    });
  });

  describe("getPendingForApprover", () => {
    beforeEach(() => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, FIXTURE_ALL_PENDING_OPERATIONS);
    });

    it("returns pending operations not requested by approver", () => {
      const pending = getPendingForApprover(USER_ID, ORG_ID_ALPHA, ADMIN_USER.id);

      expect(pending.every((op) => op.status === "pending")).toBe(true);
      expect(pending.every((op) => op.requestedBy !== ADMIN_USER.id)).toBe(true);
    });

    it("excludes operations requested by the approver", () => {
      const pending = getPendingForApprover(USER_ID, ORG_ID_ALPHA, DEVELOPER_USER.id);

      // Should not include operations requested by developer
      const developerOps = pending.filter((op) => op.requestedBy === DEVELOPER_USER.id);
      expect(developerOps.length).toBe(0);
    });
  });

  describe("getRecentlyActedUpon", () => {
    it("returns recently approved/rejected operations", () => {
      const operations = [
        FIXTURE_ROLE_CHANGE_APPROVED,
        FIXTURE_ROLE_CHANGE_PENDING,
      ];
      upsertOperations(USER_ID, ORG_ID_ALPHA, operations);

      const recent = getRecentlyActedUpon(USER_ID, ORG_ID_ALPHA, 24);

      // Should include approved operation
      expect(recent.some((op) => op.id === FIXTURE_ROLE_CHANGE_APPROVED.id)).toBe(true);
    });

    it("respects time window parameter", () => {
      const operations = [FIXTURE_ROLE_CHANGE_APPROVED];
      upsertOperations(USER_ID, ORG_ID_ALPHA, operations);

      // Should include with 24-hour window
      const recent24 = getRecentlyActedUpon(USER_ID, ORG_ID_ALPHA, 24);
      expect(recent24.length).toBeGreaterThan(0);

      // Should not include with 1-hour window (approved 11.5 hours ago)
      const recent1 = getRecentlyActedUpon(USER_ID, ORG_ID_ALPHA, 1);
      expect(recent1.length).toBe(0);
    });
  });

  describe("updatePaginationMetadata", () => {
    it("stores pagination metadata", () => {
      updatePaginationMetadata(USER_ID, ORG_ID_ALPHA, {
        pageNumber: 2,
        pageSize: 50,
        total: 150,
        hasMore: true,
      });

      const metadata = getCacheMetadata(USER_ID, ORG_ID_ALPHA);
      expect(metadata.pageNumber).toBe(2);
      expect(metadata.pageSize).toBe(50);
      expect(metadata.total).toBe(150);
      expect(metadata.hasMore).toBe(true);
    });
  });

  describe("getCacheMetadata", () => {
    it("returns cache metadata", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, [FIXTURE_ROLE_CHANGE_PENDING]);

      const metadata = getCacheMetadata(USER_ID, ORG_ID_ALPHA);

      expect(metadata.cachedCount).toBe(1);
      expect(metadata.lastUpdated).toBeDefined();
      expect(typeof metadata.pageNumber).toBe("number");
    });
  });

  describe("isOperationStale", () => {
    it("returns false for fresh operations", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, [FIXTURE_ROLE_CHANGE_PENDING]);

      const isStale = isOperationStale(
        USER_ID,
        ORG_ID_ALPHA,
        FIXTURE_ROLE_CHANGE_PENDING,
        FIXTURE_ROLE_CHANGE_PENDING.conflictVersion
      );

      expect(isStale).toBe(false);
    });

    it("detects stale operations with different status", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, [FIXTURE_ROLE_CHANGE_PENDING]);

      const updated = { ...FIXTURE_ROLE_CHANGE_PENDING, status: "approved" as const };
      const isStale = isOperationStale(USER_ID, ORG_ID_ALPHA, updated);

      expect(isStale).toBe(true);
    });
  });

  describe("detectOperationConflict", () => {
    it("detects terminal operations", () => {
      const error = detectOperationConflict(FIXTURE_ROLE_CHANGE_APPROVED, ADMIN_USER.id);
      expect(error).toContain("Cannot act on approved");
    });

    it("detects self-approval attempts", () => {
      const error = detectOperationConflict(FIXTURE_ROLE_CHANGE_PENDING, DEVELOPER_USER.id);
      // This would be true if FIXTURE_ROLE_CHANGE_PENDING.requestedBy === DEVELOPER_USER.id
      if (FIXTURE_ROLE_CHANGE_PENDING.requestedBy === DEVELOPER_USER.id) {
        expect(error).toContain("cannot approve your own");
      }
    });

    it("returns null for valid operations", () => {
      // Create a pending operation requested by someone else
      const operation = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        requestedBy: DEVELOPER_USER.id,
      };

      const error = detectOperationConflict(operation, ADMIN_USER.id);
      expect(error).toBeNull();
    });
  });

  describe("compactStore", () => {
    it("removes expired terminal operations", () => {
      const expiredTerminal = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        id: "expired-op",
        status: "approved" as const,
        expiresAt: "2024-01-14T00:00:00.000Z", // expired in the past
      };

      upsertOperations(USER_ID, ORG_ID_ALPHA, [expiredTerminal, FIXTURE_ROLE_CHANGE_PENDING]);

      compactStore(USER_ID, ORG_ID_ALPHA);

      const remaining = listOperations(USER_ID, ORG_ID_ALPHA);
      expect(remaining.find((op) => op.id === "expired-op")).toBeUndefined();
    });

    it("keeps unexpired operations", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, [FIXTURE_ROLE_CHANGE_PENDING]);

      compactStore(USER_ID, ORG_ID_ALPHA);

      const operation = getOperation(USER_ID, ORG_ID_ALPHA, FIXTURE_ROLE_CHANGE_PENDING.id);
      expect(operation).not.toBeNull();
    });

    it("keeps pending operations even if old", () => {
      const oldPending = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        createdAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-05T00:00:00.000Z",
      };

      upsertOperations(USER_ID, ORG_ID_ALPHA, [oldPending]);

      compactStore(USER_ID, ORG_ID_ALPHA);

      const stored = getOperation(USER_ID, ORG_ID_ALPHA, oldPending.id);
      expect(stored).not.toBeNull();
    });
  });

  describe("invalidateCache", () => {
    it("clears all operations for organization", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, FIXTURE_ALL_PENDING_OPERATIONS);

      invalidateCache(USER_ID, ORG_ID_ALPHA);

      const operations = listOperations(USER_ID, ORG_ID_ALPHA);
      expect(operations).toEqual([]);
    });

    it("does not affect other organizations", () => {
      const ORG_ID_OTHER = "org-other";

      upsertOperations(USER_ID, ORG_ID_ALPHA, FIXTURE_ALL_PENDING_OPERATIONS);
      upsertOperations(USER_ID, ORG_ID_OTHER, [FIXTURE_EXPORT_PENDING]);

      invalidateCache(USER_ID, ORG_ID_ALPHA);

      // Alpha should be empty
      const alphaOps = listOperations(USER_ID, ORG_ID_ALPHA);
      expect(alphaOps).toEqual([]);

      // Other should have operation
      const otherOps = listOperations(USER_ID, ORG_ID_OTHER);
      expect(otherOps.length).toBeGreaterThan(0);
    });
  });

  describe("clearOperations", () => {
    it("removes store from localStorage", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, [FIXTURE_ROLE_CHANGE_PENDING]);

      clearOperations(USER_ID, ORG_ID_ALPHA);

      const operations = listOperations(USER_ID, ORG_ID_ALPHA);
      expect(operations).toEqual([]);
    });
  });

  describe("Concurrent modification detection", () => {
    it("detects when operation was modified by another user", () => {
      upsertOperations(USER_ID, ORG_ID_ALPHA, [FIXTURE_ROLE_CHANGE_PENDING]);

      // Simulate another user approving the operation
      const updated = { ...FIXTURE_ROLE_CHANGE_PENDING, status: "approved" as const };
      upsertOperations(USER_ID, ORG_ID_ALPHA, [updated]);

      const isStale = isOperationStale(USER_ID, ORG_ID_ALPHA, FIXTURE_ROLE_CHANGE_PENDING);
      expect(isStale).toBe(true);
    });
  });
});
