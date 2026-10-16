/**
 * Unit tests for operation validation schemas and types
 * 
 * Tests cover:
 * - Schema validation for each operation type
 * - Type guards
 * - Authorization checks
 * - Terminal status detection
 * - Error handling and edge cases
 */

import {
  approvalOperationSchema,
  createApprovalOperationRequestSchema,
  approvalDecisionSchema,
  approvalFiltersSchema,
  validateOperationForAction,
  isApprovalOperation,
  isRoleChangeOperation,
  isExportOperation,
  isRecoveryOperation,
  isKeyRotationOperation,
  isGovernanceOperation,
  isTerminalStatus,
  OPERATION_TYPES,
  OPERATION_STATUS,
  TERMINAL_STATUSES,
} from "@/lib/validation/operations";
import {
  FIXTURE_ROLE_CHANGE_PENDING,
  FIXTURE_ROLE_CHANGE_APPROVED,
  FIXTURE_EXPORT_PENDING,
  FIXTURE_RECOVERY_PENDING,
  FIXTURE_KEY_ROTATION_PENDING,
  FIXTURE_GOVERNANCE_PENDING,
  ADMIN_USER,
  DEVELOPER_USER,
} from "@/tests/fixtures/approval-fixtures";

describe("Operation Validation", () => {
  describe("approvalOperationSchema", () => {
    it("validates role-change operations", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_ROLE_CHANGE_PENDING);
      expect(result.success).toBe(true);
    });

    it("validates export operations", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_EXPORT_PENDING);
      expect(result.success).toBe(true);
    });

    it("validates recovery operations", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_RECOVERY_PENDING);
      expect(result.success).toBe(true);
    });

    it("validates key-rotation operations", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_KEY_ROTATION_PENDING);
      expect(result.success).toBe(true);
    });

    it("validates governance operations", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_GOVERNANCE_PENDING);
      expect(result.success).toBe(true);
    });

    it("rejects invalid operation type", () => {
      const invalid = { ...FIXTURE_ROLE_CHANGE_PENDING, operationType: "invalid-type" };
      const result = approvalOperationSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects missing required fields", () => {
      const incomplete = { ...FIXTURE_ROLE_CHANGE_PENDING };
      delete (incomplete as any).id;
      const result = approvalOperationSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });

    it("rejects invalid UUID for operation ID", () => {
      const invalid = { ...FIXTURE_ROLE_CHANGE_PENDING, id: "not-a-uuid" };
      const result = approvalOperationSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid ISO datetime", () => {
      const invalid = { ...FIXTURE_ROLE_CHANGE_PENDING, createdAt: "not-a-date" };
      const result = approvalOperationSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("allows optional approval fields", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_ROLE_CHANGE_PENDING);
      expect(result.success).toBe(true);
    });

    it("validates approved operation with approver info", () => {
      const result = approvalOperationSchema.safeParse(FIXTURE_ROLE_CHANGE_APPROVED);
      expect(result.success).toBe(true);
    });
  });

  describe("createApprovalOperationRequestSchema", () => {
    it("allows creating new operations without server-computed fields", () => {
      const request = {
        operationType: "role-change" as const,
        status: "pending" as const,
        organizationId: "org-123",
        requestedBy: "user-123",
        expiresAt: "2024-01-20T00:00:00.000Z",
        targetMemberId: "member-456",
        targetWalletAddress: "GBXXXWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX6ZQ",
        currentRole: "MEMBER" as const,
        newRole: "ADMIN" as const,
      };

      const result = createApprovalOperationRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it("rejects server-computed fields (id, createdAt, etc.)", () => {
      const request = {
        operationType: "role-change" as const,
        status: "pending" as const,
        organizationId: "org-123",
        requestedBy: "user-123",
        createdAt: "2024-01-15T00:00:00.000Z", // Should be rejected
        expiresAt: "2024-01-20T00:00:00.000Z",
        targetMemberId: "member-456",
        targetWalletAddress: "GBXXXWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX6ZQ",
        currentRole: "MEMBER" as const,
        newRole: "ADMIN" as const,
        id: "some-uuid", // Should be rejected
      };

      const result = createApprovalOperationRequestSchema.safeParse(request);
      // Should fail because extra fields not part of schema
      expect(result.success).toBe(false);
    });
  });

  describe("approvalDecisionSchema", () => {
    it("validates approval decision", () => {
      const decision = {
        operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
        decision: "approve" as const,
        reason: "Looks good",
      };

      const result = approvalDecisionSchema.safeParse(decision);
      expect(result.success).toBe(true);
    });

    it("validates rejection decision with reason", () => {
      const decision = {
        operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
        decision: "reject" as const,
        reason: "Insufficient justification",
      };

      const result = approvalDecisionSchema.safeParse(decision);
      expect(result.success).toBe(true);
    });

    it("allows decision without reason", () => {
      const decision = {
        operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
        decision: "approve" as const,
      };

      const result = approvalDecisionSchema.safeParse(decision);
      expect(result.success).toBe(true);
    });

    it("rejects invalid decision type", () => {
      const invalid = {
        operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
        decision: "maybe",
      };

      const result = approvalDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects reason exceeding max length", () => {
      const decision = {
        operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
        decision: "reject" as const,
        reason: "a".repeat(1001),
      };

      const result = approvalDecisionSchema.safeParse(decision);
      expect(result.success).toBe(false);
    });
  });

  describe("approvalFiltersSchema", () => {
    it("accepts empty filters", () => {
      const result = approvalFiltersSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts status filter", () => {
      const result = approvalFiltersSchema.safeParse({ status: "pending" });
      expect(result.success).toBe(true);
    });

    it("accepts operation type filter", () => {
      const result = approvalFiltersSchema.safeParse({ operationType: "role-change" });
      expect(result.success).toBe(true);
    });

    it("accepts date range filters", () => {
      const result = approvalFiltersSchema.safeParse({
        createdAfter: "2024-01-01T00:00:00.000Z",
        createdBefore: "2024-01-31T23:59:59.999Z",
      });
      expect(result.success).toBe(true);
    });

    it("accepts expiry window filter", () => {
      const result = approvalFiltersSchema.safeParse({ expiresInDays: 7 });
      expect(result.success).toBe(true);
    });

    it("rejects invalid expiry window", () => {
      const result = approvalFiltersSchema.safeParse({ expiresInDays: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts multiple filters combined", () => {
      const result = approvalFiltersSchema.safeParse({
        status: "pending",
        operationType: "export",
        expiresInDays: 3,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Type guards", () => {
    describe("isApprovalOperation", () => {
      it("returns true for valid operations", () => {
        expect(isApprovalOperation(FIXTURE_ROLE_CHANGE_PENDING)).toBe(true);
        expect(isApprovalOperation(FIXTURE_EXPORT_PENDING)).toBe(true);
      });

      it("returns false for invalid data", () => {
        expect(isApprovalOperation(null)).toBe(false);
        expect(isApprovalOperation({})).toBe(false);
        expect(isApprovalOperation("not an operation")).toBe(false);
      });
    });

    describe("Operation type guards", () => {
      it("isRoleChangeOperation detects role-change type", () => {
        expect(isRoleChangeOperation(FIXTURE_ROLE_CHANGE_PENDING)).toBe(true);
        expect(isRoleChangeOperation(FIXTURE_EXPORT_PENDING)).toBe(false);
      });

      it("isExportOperation detects export type", () => {
        expect(isExportOperation(FIXTURE_EXPORT_PENDING)).toBe(true);
        expect(isExportOperation(FIXTURE_ROLE_CHANGE_PENDING)).toBe(false);
      });

      it("isRecoveryOperation detects recovery type", () => {
        expect(isRecoveryOperation(FIXTURE_RECOVERY_PENDING)).toBe(true);
        expect(isRecoveryOperation(FIXTURE_ROLE_CHANGE_PENDING)).toBe(false);
      });

      it("isKeyRotationOperation detects key-rotation type", () => {
        expect(isKeyRotationOperation(FIXTURE_KEY_ROTATION_PENDING)).toBe(true);
        expect(isKeyRotationOperation(FIXTURE_ROLE_CHANGE_PENDING)).toBe(false);
      });

      it("isGovernanceOperation detects governance type", () => {
        expect(isGovernanceOperation(FIXTURE_GOVERNANCE_PENDING)).toBe(true);
        expect(isGovernanceOperation(FIXTURE_ROLE_CHANGE_PENDING)).toBe(false);
      });
    });
  });

  describe("Terminal status detection", () => {
    it("identifies approved as terminal", () => {
      expect(isTerminalStatus("approved")).toBe(true);
    });

    it("identifies rejected as terminal", () => {
      expect(isTerminalStatus("rejected")).toBe(true);
    });

    it("identifies expired as terminal", () => {
      expect(isTerminalStatus("expired")).toBe(true);
    });

    it("identifies revoked as terminal", () => {
      expect(isTerminalStatus("revoked")).toBe(true);
    });

    it("identifies pending as non-terminal", () => {
      expect(isTerminalStatus("pending")).toBe(false);
    });

    it("TERMINAL_STATUSES contains expected values", () => {
      expect(TERMINAL_STATUSES).toContain("approved");
      expect(TERMINAL_STATUSES).toContain("rejected");
      expect(TERMINAL_STATUSES).toContain("expired");
      expect(TERMINAL_STATUSES).toContain("revoked");
      expect(TERMINAL_STATUSES).not.toContain("pending");
    });
  });

  describe("validateOperationForAction", () => {
    it("allows action by different user on pending operation", () => {
      const error = validateOperationForAction(FIXTURE_ROLE_CHANGE_PENDING, ADMIN_USER.id);
      // Should only error if operation is by the same user
      if (FIXTURE_ROLE_CHANGE_PENDING.requestedBy === ADMIN_USER.id) {
        expect(error).not.toBeNull();
      } else {
        expect(error).toBeNull();
      }
    });

    it("rejects action by same user who requested operation", () => {
      const operation = { ...FIXTURE_ROLE_CHANGE_PENDING, requestedBy: ADMIN_USER.id };
      const error = validateOperationForAction(operation, ADMIN_USER.id);
      expect(error).toContain("cannot approve your own");
    });

    it("rejects action on terminal operations", () => {
      const error = validateOperationForAction(FIXTURE_ROLE_CHANGE_APPROVED, ADMIN_USER.id);
      expect(error).toContain("Cannot act on");
    });

    it("rejects action on expired operations", () => {
      const expired = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        expiresAt: "2024-01-14T00:00:00.000Z", // in the past
      };
      const error = validateOperationForAction(expired, ADMIN_USER.id);
      expect(error).toContain("expired");
    });

    it("allows action within valid window", () => {
      // Create a valid pending operation requested by someone else
      const operation = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        requestedBy: DEVELOPER_USER.id,
      };
      const error = validateOperationForAction(operation, ADMIN_USER.id);
      expect(error).toBeNull();
    });
  });

  describe("Constants", () => {
    it("OPERATION_TYPES contains all expected types", () => {
      expect(OPERATION_TYPES).toContain("role-change");
      expect(OPERATION_TYPES).toContain("export");
      expect(OPERATION_TYPES).toContain("recovery");
      expect(OPERATION_TYPES).toContain("key-rotation");
      expect(OPERATION_TYPES).toContain("governance");
      expect(OPERATION_TYPES.length).toBe(5);
    });

    it("OPERATION_STATUS contains all expected statuses", () => {
      expect(OPERATION_STATUS).toContain("pending");
      expect(OPERATION_STATUS).toContain("approved");
      expect(OPERATION_STATUS).toContain("rejected");
      expect(OPERATION_STATUS).toContain("expired");
      expect(OPERATION_STATUS).toContain("revoked");
      expect(OPERATION_STATUS.length).toBe(5);
    });
  });
});
