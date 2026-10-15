/**
 * Stable test fixtures for approval queue operations.
 * 
 * All timestamps are fixed ISO strings (never use Date.now()).
 * All data uses fixtures, never inline objects.
 * Covers: pending, approved, rejected, expired, and revoked operations.
 */

import {
  RoleChangeOperation,
  ExportOperation,
  RecoveryOperation,
  KeyRotationOperation,
  GovernanceOperation,
  ApprovalOperation,
} from "@/lib/validation/operations";
import { ADMIN_USER, DEVELOPER_USER, ISSUER_USER, READONLY_USER } from "./admin-fixtures";

/**
 * Fixed reference timestamp for all test fixtures (2024-01-15T12:00:00Z).
 * Use this to calculate other timestamps deterministically.
 */
export const FIXTURE_NOW_MS = new Date("2024-01-15T12:00:00.000Z").getTime();

/**
 * Organization IDs for test fixtures.
 */
export const ORG_ID_ALPHA = "org-fixture-alpha-001";
export const ORG_ID_BETA = "org-fixture-beta-002";

/**
 * ============================================================================
 * ROLE CHANGE OPERATIONS
 * ============================================================================
 */

/**
 * Pending role change operation: requesting promotion to ADMIN.
 * Created 2 hours ago, expires in 2 days (72 hours total window).
 */
export const FIXTURE_ROLE_CHANGE_PENDING: RoleChangeOperation = {
  id: "op-role-change-pending-001",
  operationType: "role-change",
  status: "pending",
  organizationId: ORG_ID_ALPHA,
  requestedBy: DEVELOPER_USER.id,
  createdAt: "2024-01-15T10:00:00.000Z", // 2 hours ago
  expiresAt: "2024-01-18T10:00:00.000Z", // 72 hours window
  targetMemberId: "member-005",
  targetWalletAddress: "GBXXXMEMBER5WALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX5ZQ",
  currentRole: "MEMBER",
  newRole: "ADMIN",
  reason: "Team lead promotion - needs admin access for member management.",
};

/**
 * Role change operation already approved by admin.
 * Approved 30 minutes ago.
 */
export const FIXTURE_ROLE_CHANGE_APPROVED: RoleChangeOperation = {
  id: "op-role-change-approved-001",
  operationType: "role-change",
  status: "approved",
  organizationId: ORG_ID_ALPHA,
  requestedBy: DEVELOPER_USER.id,
  createdAt: "2024-01-14T14:00:00.000Z",
  expiresAt: "2024-01-17T14:00:00.000Z",
  approverId: ADMIN_USER.id,
  approvedAt: "2024-01-15T11:30:00.000Z", // 30 minutes ago
  targetMemberId: "member-003",
  targetWalletAddress: "GBXXXMEMBER3WALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX3ZQ",
  currentRole: "MEMBER",
  newRole: "ADMIN",
};

/**
 * Role change operation rejected with reason.
 * Rejected 1 hour ago.
 */
export const FIXTURE_ROLE_CHANGE_REJECTED: RoleChangeOperation = {
  id: "op-role-change-rejected-001",
  operationType: "role-change",
  status: "rejected",
  organizationId: ORG_ID_ALPHA,
  requestedBy: ISSUER_USER.id,
  createdAt: "2024-01-15T08:00:00.000Z",
  expiresAt: "2024-01-17T08:00:00.000Z",
  approverId: ADMIN_USER.id,
  rejectionReason: "Cannot promote to owner. Contact leadership for ownership changes.",
  targetMemberId: "member-004",
  targetWalletAddress: "GBXXXMEMBER4WALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX4ZQ",
  currentRole: "ADMIN",
  newRole: "OWNER",
};

/**
 * Role change operation that has expired (no action taken).
 * Created 3 days ago, expired 1 hour ago.
 */
export const FIXTURE_ROLE_CHANGE_EXPIRED: RoleChangeOperation = {
  id: "op-role-change-expired-001",
  operationType: "role-change",
  status: "expired",
  organizationId: ORG_ID_ALPHA,
  requestedBy: READONLY_USER.id,
  createdAt: "2024-01-12T11:00:00.000Z",
  expiresAt: "2024-01-15T11:00:00.000Z", // 1 hour ago (before FIXTURE_NOW)
  targetMemberId: "member-002",
  targetWalletAddress: "GBXXXMEMBER2WALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX2ZQ",
  currentRole: "MEMBER",
  newRole: "ADMIN",
  reason: "Stale promotion request.",
};

/**
 * Role change operation revoked by requester.
 */
export const FIXTURE_ROLE_CHANGE_REVOKED: RoleChangeOperation = {
  id: "op-role-change-revoked-001",
  operationType: "role-change",
  status: "revoked",
  organizationId: ORG_ID_BETA,
  requestedBy: DEVELOPER_USER.id,
  createdAt: "2024-01-14T15:00:00.000Z",
  expiresAt: "2024-01-17T15:00:00.000Z",
  targetMemberId: "member-006",
  targetWalletAddress: "GBXXXMEMBER6WALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX6ZQ",
  currentRole: "MEMBER",
  newRole: "MEMBER",
  reason: "Cancelling this request - no longer needed.",
};

/**
 * ============================================================================
 * EXPORT OPERATIONS
 * ============================================================================
 */

/**
 * Pending full export operation.
 * Created 1 hour ago, expires in 24 hours.
 */
export const FIXTURE_EXPORT_PENDING: ExportOperation = {
  id: "op-export-pending-001",
  operationType: "export",
  status: "pending",
  organizationId: ORG_ID_ALPHA,
  requestedBy: ADMIN_USER.id,
  createdAt: "2024-01-15T11:00:00.000Z", // 1 hour ago
  expiresAt: "2024-01-16T11:00:00.000Z", // 24 hours window
  exportType: "full",
  exportScope: ["members", "proofs", "activity_logs", "audit_trail"],
  includeProofData: true,
};

/**
 * Partial export operation (approved).
 */
export const FIXTURE_EXPORT_APPROVED: ExportOperation = {
  id: "op-export-approved-001",
  operationType: "export",
  status: "approved",
  organizationId: ORG_ID_ALPHA,
  requestedBy: DEVELOPER_USER.id,
  createdAt: "2024-01-14T09:00:00.000Z",
  expiresAt: "2024-01-15T09:00:00.000Z",
  approverId: ADMIN_USER.id,
  approvedAt: "2024-01-15T09:30:00.000Z",
  exportType: "partial",
  exportScope: ["members", "proofs"],
  includeProofData: false,
};

/**
 * Export operation expiring soon (8 hours remaining).
 */
export const FIXTURE_EXPORT_EXPIRING_SOON: ExportOperation = {
  id: "op-export-expiring-001",
  operationType: "export",
  status: "pending",
  organizationId: ORG_ID_BETA,
  requestedBy: ISSUER_USER.id,
  createdAt: "2024-01-15T08:00:00.000Z",
  expiresAt: "2024-01-15T20:00:00.000Z", // 8 hours remaining
  exportType: "full",
  exportScope: ["members", "proofs", "activity_logs"],
  includeProofData: true,
};

/**
 * ============================================================================
 * RECOVERY OPERATIONS
 * ============================================================================
 */

/**
 * Pending email recovery operation.
 * Created 30 minutes ago, expires in 12 hours.
 */
export const FIXTURE_RECOVERY_PENDING: RecoveryOperation = {
  id: "op-recovery-pending-001",
  operationType: "recovery",
  status: "pending",
  organizationId: ORG_ID_ALPHA,
  requestedBy: "user-recovery-request-001",
  createdAt: "2024-01-15T11:30:00.000Z",
  expiresAt: "2024-01-16T00:00:00.000Z", // 12 hours
  walletAddress: "GBXXXRECOVERYWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7ZQ",
  recoveryMethod: "email",
  recoveryIdentifier: "user@example.com",
  verificationCode: "VERIFY-ABC123DEF456",
};

/**
 * Social recovery operation (approved).
 */
export const FIXTURE_RECOVERY_APPROVED: RecoveryOperation = {
  id: "op-recovery-approved-001",
  operationType: "recovery",
  status: "approved",
  organizationId: ORG_ID_ALPHA,
  requestedBy: "user-recovery-request-002",
  createdAt: "2024-01-14T18:00:00.000Z",
  expiresAt: "2024-01-15T06:00:00.000Z",
  approverId: ADMIN_USER.id,
  approvedAt: "2024-01-15T01:00:00.000Z",
  walletAddress: "GBXXXSOCIALRECOVERYWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX8ZQ",
  recoveryMethod: "social-recovery",
  recoveryIdentifier: "github:user123",
};

/**
 * ============================================================================
 * KEY ROTATION OPERATIONS
 * ============================================================================
 */

/**
 * Pending signing key rotation.
 * Scheduled maintenance window: tomorrow 02:00-04:00 UTC.
 */
export const FIXTURE_KEY_ROTATION_PENDING: KeyRotationOperation = {
  id: "op-key-rotation-pending-001",
  operationType: "key-rotation",
  status: "pending",
  organizationId: ORG_ID_ALPHA,
  requestedBy: ADMIN_USER.id,
  createdAt: "2024-01-15T10:00:00.000Z",
  expiresAt: "2024-01-16T02:00:00.000Z", // Approval needed before maintenance
  keyId: "key-signing-001",
  keyType: "signing",
  rotateFrom: "key-v1-xxxx-yyyy-zzzz",
  rotateTo: "key-v2-aaaa-bbbb-cccc",
  maintenanceWindow: {
    startAt: "2024-01-16T02:00:00.000Z",
    endAt: "2024-01-16T04:00:00.000Z",
  },
};

/**
 * HMAC key rotation (approved).
 */
export const FIXTURE_KEY_ROTATION_APPROVED: KeyRotationOperation = {
  id: "op-key-rotation-approved-001",
  operationType: "key-rotation",
  status: "approved",
  organizationId: ORG_ID_BETA,
  requestedBy: DEVELOPER_USER.id,
  createdAt: "2024-01-14T16:00:00.000Z",
  expiresAt: "2024-01-15T16:00:00.000Z",
  approverId: ADMIN_USER.id,
  approvedAt: "2024-01-15T10:30:00.000Z",
  keyId: "key-hmac-002",
  keyType: "hmac",
  rotateFrom: "hmac-v1-old",
  rotateTo: "hmac-v2-new",
};

/**
 * ============================================================================
 * GOVERNANCE OPERATIONS
 * ============================================================================
 */

/**
 * Pending policy update governance operation.
 */
export const FIXTURE_GOVERNANCE_PENDING: GovernanceOperation = {
  id: "op-governance-pending-001",
  operationType: "governance",
  status: "pending",
  organizationId: ORG_ID_ALPHA,
  requestedBy: ADMIN_USER.id,
  createdAt: "2024-01-15T09:00:00.000Z",
  expiresAt: "2024-01-17T09:00:00.000Z",
  changeType: "policy-update",
  affectedEntities: [ORG_ID_ALPHA],
  changeDescription: "Update proof retention policy from 7 days to 30 days for compliance with new regulations. This affects all historical proof records stored.",
  requiresMultiSig: false,
};

/**
 * Fee adjustment governance operation (rejected).
 */
export const FIXTURE_GOVERNANCE_REJECTED: GovernanceOperation = {
  id: "op-governance-rejected-001",
  operationType: "governance",
  status: "rejected",
  organizationId: ORG_ID_BETA,
  requestedBy: ISSUER_USER.id,
  createdAt: "2024-01-14T12:00:00.000Z",
  expiresAt: "2024-01-16T12:00:00.000Z",
  approverId: ADMIN_USER.id,
  rejectionReason: "Fee adjustment requires board approval. Please escalate through governance committee.",
  changeType: "fee-adjustment",
  affectedEntities: [ORG_ID_ALPHA, ORG_ID_BETA],
  changeDescription: "Adjust verification fees from $0.50 to $0.75 per proof.",
  requiresMultiSig: true,
};

/**
 * ============================================================================
 * COMPOSITE FIXTURES (Multiple Operations)
 * ============================================================================
 */

/**
 * All pending operations (waiting for approval).
 */
export const FIXTURE_ALL_PENDING_OPERATIONS: ApprovalOperation[] = [
  FIXTURE_ROLE_CHANGE_PENDING,
  FIXTURE_EXPORT_PENDING,
  FIXTURE_EXPORT_EXPIRING_SOON,
  FIXTURE_RECOVERY_PENDING,
  FIXTURE_KEY_ROTATION_PENDING,
  FIXTURE_GOVERNANCE_PENDING,
];

/**
 * All terminal operations (no further action possible).
 */
export const FIXTURE_ALL_TERMINAL_OPERATIONS: ApprovalOperation[] = [
  FIXTURE_ROLE_CHANGE_APPROVED,
  FIXTURE_ROLE_CHANGE_REJECTED,
  FIXTURE_ROLE_CHANGE_EXPIRED,
  FIXTURE_ROLE_CHANGE_REVOKED,
  FIXTURE_EXPORT_APPROVED,
  FIXTURE_RECOVERY_APPROVED,
  FIXTURE_KEY_ROTATION_APPROVED,
  FIXTURE_GOVERNANCE_REJECTED,
];

/**
 * All operations (mixed statuses).
 */
export const FIXTURE_ALL_OPERATIONS: ApprovalOperation[] = [
  ...FIXTURE_ALL_PENDING_OPERATIONS,
  ...FIXTURE_ALL_TERMINAL_OPERATIONS,
];

/**
 * Operations from different organizations.
 */
export const FIXTURE_OPERATIONS_BY_ORG = {
  [ORG_ID_ALPHA]: FIXTURE_ALL_OPERATIONS.filter((op) => op.organizationId === ORG_ID_ALPHA),
  [ORG_ID_BETA]: FIXTURE_ALL_OPERATIONS.filter((op) => op.organizationId === ORG_ID_BETA),
};

/**
 * Operations pending for specific approver (excluding own requests).
 */
export const FIXTURE_OPERATIONS_FOR_ADMIN_APPROVAL = FIXTURE_ALL_PENDING_OPERATIONS.filter(
  (op) => op.requestedBy !== ADMIN_USER.id
);

/**
 * ============================================================================
 * PAGINATED RESPONSE FIXTURES
 * ============================================================================
 */

export const FIXTURE_PAGINATED_PENDING_RESPONSE = {
  operations: FIXTURE_ALL_PENDING_OPERATIONS,
  total: FIXTURE_ALL_PENDING_OPERATIONS.length,
  pageNumber: 0,
  pageSize: 25,
  hasMore: false,
};

export const FIXTURE_PAGINATED_TERMINAL_RESPONSE = {
  operations: FIXTURE_ALL_TERMINAL_OPERATIONS,
  total: FIXTURE_ALL_TERMINAL_OPERATIONS.length,
  pageNumber: 0,
  pageSize: 25,
  hasMore: false,
};

export const FIXTURE_PAGINATED_ALL_RESPONSE = {
  operations: FIXTURE_ALL_OPERATIONS,
  total: FIXTURE_ALL_OPERATIONS.length,
  pageNumber: 0,
  pageSize: 50,
  hasMore: false,
};

/**
 * ============================================================================
 * APPROVAL DECISION FIXTURES
 * ============================================================================
 */

export const FIXTURE_APPROVAL_DECISION_APPROVE = {
  operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
  decision: "approve" as const,
  reason: "Approved - meets all requirements.",
};

export const FIXTURE_APPROVAL_DECISION_REJECT = {
  operationId: FIXTURE_ROLE_CHANGE_PENDING.id,
  decision: "reject" as const,
  reason: "Insufficient justification provided. Please resubmit with detailed business case.",
};

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Create a custom role change operation for testing.
 */
export function createMockRoleChangeOperation(
  overrides: Partial<RoleChangeOperation> = {}
): RoleChangeOperation {
  return {
    ...FIXTURE_ROLE_CHANGE_PENDING,
    ...overrides,
  };
}

/**
 * Create a custom export operation for testing.
 */
export function createMockExportOperation(
  overrides: Partial<ExportOperation> = {}
): ExportOperation {
  return {
    ...FIXTURE_EXPORT_PENDING,
    ...overrides,
  };
}

/**
 * Create a custom recovery operation for testing.
 */
export function createMockRecoveryOperation(
  overrides: Partial<RecoveryOperation> = {}
): RecoveryOperation {
  return {
    ...FIXTURE_RECOVERY_PENDING,
    ...overrides,
  };
}

/**
 * Create a custom key rotation operation for testing.
 */
export function createMockKeyRotationOperation(
  overrides: Partial<KeyRotationOperation> = {}
): KeyRotationOperation {
  return {
    ...FIXTURE_KEY_ROTATION_PENDING,
    ...overrides,
  };
}

/**
 * Create a custom governance operation for testing.
 */
export function createMockGovernanceOperation(
  overrides: Partial<GovernanceOperation> = {}
): GovernanceOperation {
  return {
    ...FIXTURE_GOVERNANCE_PENDING,
    ...overrides,
  };
}

/**
 * Get all operations of a specific type.
 */
export function getOperationsByType(
  type: "role-change" | "export" | "recovery" | "key-rotation" | "governance"
): ApprovalOperation[] {
  return FIXTURE_ALL_OPERATIONS.filter((op) => op.operationType === type);
}

/**
 * Get all operations with a specific status.
 */
export function getOperationsByStatus(
  status: "pending" | "approved" | "rejected" | "expired" | "revoked"
): ApprovalOperation[] {
  return FIXTURE_ALL_OPERATIONS.filter((op) => op.status === status);
}
