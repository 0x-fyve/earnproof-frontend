/**
 * Validation schemas and types for privileged operations requiring approval.
 * 
 * Covers: role changes, exports, recovery, key rotation, and governance operations.
 * All schemas use Zod for runtime validation and type safety.
 */

import { z } from "zod";
import { ORGANIZATION_ROLES } from "@/lib/api/organization-members";

/**
 * Operation type discriminator for the approval queue.
 * Each operation type represents a class of privileged actions requiring approver review.
 */
export const OPERATION_TYPES = [
  "role-change",
  "export",
  "recovery",
  "key-rotation",
  "governance",
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

/**
 * Lifecycle state of an operation in the approval queue.
 * 
 * pending: Awaiting approver action
 * approved: Accepted by authorized approver
 * rejected: Denied by authorized approver
 * expired: Expired without action (stale)
 * revoked: Cancelled by requester or system
 */
export const OPERATION_STATUS = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "revoked",
] as const;

export type OperationStatus = (typeof OPERATION_STATUS)[number];

/**
 * Terminal states: operations that cannot transition further.
 * Approval/rejection actions are not allowed on these.
 */
export const TERMINAL_STATUSES: OperationStatus[] = [
  "approved",
  "rejected",
  "expired",
  "revoked",
];

export function isTerminalStatus(status: OperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Base schema for all operations in the approval queue.
 * Contains metadata common to all operation types.
 */
export const baseOperationSchema = z.object({
  id: z.string().uuid("Operation ID must be a valid UUID"),
  operationType: z.enum(OPERATION_TYPES, {
    errorMap: () => ({
      message: `Operation type must be one of: ${OPERATION_TYPES.join(", ")}`,
    }),
  }),
  status: z.enum(OPERATION_STATUS, {
    errorMap: () => ({
      message: `Status must be one of: ${OPERATION_STATUS.join(", ")}`,
    }),
  }),
  organizationId: z.string().min(1, "Organization ID is required"),
  requestedBy: z.string().min(1, "Requester ID is required"),
  createdAt: z.string().datetime("Invalid creation timestamp"),
  expiresAt: z.string().datetime("Invalid expiration timestamp"),
  approverId: z.string().min(1, "Approver ID is required").optional(),
  approvedAt: z.string().datetime("Invalid approval timestamp").optional(),
  rejectionReason: z.string().max(1000, "Reason must be 1000 characters or less").optional(),
  conflictVersion: z.string().optional(),
});

/**
 * Role change operation: changing a member's organizational role.
 * Prevents privilege escalation abuse and ensures role governance.
 */
export const roleChangeOperationSchema = baseOperationSchema.extend({
  operationType: z.literal("role-change"),
  targetMemberId: z.string().min(1, "Target member ID is required"),
  targetWalletAddress: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar wallet address"),
  currentRole: z.enum(ORGANIZATION_ROLES),
  newRole: z.enum(ORGANIZATION_ROLES),
  reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
});

export type RoleChangeOperation = z.infer<typeof roleChangeOperationSchema>;

/**
 * Export operation: requesting sensitive organization data export.
 * Requires time-window validation and reauth confirmation.
 */
export const exportOperationSchema = baseOperationSchema.extend({
  operationType: z.literal("export"),
  exportType: z.enum(["full", "partial"], {
    errorMap: () => ({ message: "Export type must be 'full' or 'partial'" }),
  }),
  exportScope: z.array(z.string()).min(1, "At least one export scope is required"),
  includeProofData: z.boolean().default(false),
});

export type ExportOperation = z.infer<typeof exportOperationSchema>;

/**
 * Recovery operation: account recovery via email or social recovery.
 * High-security operation requiring identity verification.
 */
export const recoveryOperationSchema = baseOperationSchema.extend({
  operationType: z.literal("recovery"),
  walletAddress: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar wallet address"),
  recoveryMethod: z.enum(["email", "social-recovery"], {
    errorMap: () => ({ message: "Recovery method must be 'email' or 'social-recovery'" }),
  }),
  verificationCode: z.string().min(1, "Verification code is required").optional(),
  recoveryIdentifier: z.string().min(1, "Recovery identifier is required"),
});

export type RecoveryOperation = z.infer<typeof recoveryOperationSchema>;

/**
 * Key rotation operation: rotating cryptographic keys for signing operations.
 * Affects ongoing proof generation and verification.
 */
export const keyRotationOperationSchema = baseOperationSchema.extend({
  operationType: z.literal("key-rotation"),
  keyId: z.string().min(1, "Key ID is required"),
  keyType: z.enum(["signing", "encryption", "hmac"], {
    errorMap: () => ({ message: "Key type must be 'signing', 'encryption', or 'hmac'" }),
  }),
  rotateFrom: z.string().min(1, "Current key reference is required"),
  rotateTo: z.string().min(1, "New key reference is required"),
  maintenanceWindow: z
    .object({
      startAt: z.string().datetime("Invalid maintenance start time"),
      endAt: z.string().datetime("Invalid maintenance end time"),
    })
    .optional(),
});

export type KeyRotationOperation = z.infer<typeof keyRotationOperationSchema>;

/**
 * Governance operation: policy, contract, or governance rule changes.
 * May affect multiple organizations or the platform itself.
 */
export const governanceOperationSchema = baseOperationSchema.extend({
  operationType: z.literal("governance"),
  changeType: z.enum([
    "policy-update",
    "contract-change",
    "permission-rule",
    "fee-adjustment",
  ]),
  affectedEntities: z.array(z.string()).min(1, "At least one affected entity is required"),
  changeDescription: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description must be 2000 characters or less"),
  requiresMultiSig: z.boolean().default(false),
});

export type GovernanceOperation = z.infer<typeof governanceOperationSchema>;

/**
 * Union of all operation types.
 * Use discriminated union pattern for type-safe pattern matching.
 */
export const approvalOperationSchema = z.discriminatedUnion("operationType", [
  roleChangeOperationSchema,
  exportOperationSchema,
  recoveryOperationSchema,
  keyRotationOperationSchema,
  governanceOperationSchema,
]);

export type ApprovalOperation = z.infer<typeof approvalOperationSchema>;

/**
 * Request payload for creating a new approval operation.
 * Excludes fields that are server-computed (id, createdAt, etc.)
 */
export const createApprovalOperationRequestSchema = approvalOperationSchema.omit({
  id: true,
  createdAt: true,
  approverId: true,
  approvedAt: true,
  conflictVersion: true,
});

export type CreateApprovalOperationRequest = z.infer<
  typeof createApprovalOperationRequestSchema
>;

/**
 * Approval decision request: approving or rejecting an operation.
 * Includes optional conflict version for optimistic concurrency control.
 */
export const approvalDecisionSchema = z.object({
  operationId: z.string().uuid("Operation ID must be a valid UUID"),
  decision: z.enum(["approve", "reject"], {
    errorMap: () => ({ message: "Decision must be 'approve' or 'reject'" }),
  }),
  reason: z.string().max(1000, "Reason must be 1000 characters or less").optional(),
  conflictVersion: z.string().optional(),
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/**
 * Filter criteria for querying the approval queue.
 * All fields are optional; omitted fields are not applied as filters.
 */
export const approvalFiltersSchema = z.object({
  status: z.enum(OPERATION_STATUS).optional(),
  operationType: z.enum(OPERATION_TYPES).optional(),
  approverId: z.string().optional(),
  requestedBy: z.string().optional(),
  organizationId: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  expiresInDays: z.number().min(0).max(365).optional(),
  searchTerm: z.string().max(100).optional(),
});

export type ApprovalFilters = z.infer<typeof approvalFiltersSchema>;

/**
 * Paginated response for listing operations.
 */
export const paginatedOperationsSchema = z.object({
  operations: z.array(approvalOperationSchema),
  total: z.number().int().nonnegative(),
  pageNumber: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type PaginatedOperations = z.infer<typeof paginatedOperationsSchema>;

/**
 * Validation helper: Check if an operation can be acted upon.
 * Returns null if valid for action, otherwise returns error message.
 */
export function validateOperationForAction(
  operation: ApprovalOperation,
  approverId: string
): string | null {
  // Cannot approve own operations
  if (operation.requestedBy === approverId) {
    return "You cannot approve your own operations. Please ask another approver.";
  }

  // Cannot act on terminal operations
  if (isTerminalStatus(operation.status)) {
    return `Cannot act on ${operation.status} operations.`;
  }

  // Cannot act on expired operations
  const expiryTime = new Date(operation.expiresAt).getTime();
  if (expiryTime < Date.now()) {
    return "This operation has expired and cannot be acted upon.";
  }

  return null;
}

/**
 * Type guard: Check if a value is an ApprovalOperation
 */
export function isApprovalOperation(value: unknown): value is ApprovalOperation {
  try {
    approvalOperationSchema.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard: Check specific operation type
 */
export function isRoleChangeOperation(
  operation: ApprovalOperation
): operation is RoleChangeOperation {
  return operation.operationType === "role-change";
}

export function isExportOperation(operation: ApprovalOperation): operation is ExportOperation {
  return operation.operationType === "export";
}

export function isRecoveryOperation(
  operation: ApprovalOperation
): operation is RecoveryOperation {
  return operation.operationType === "recovery";
}

export function isKeyRotationOperation(
  operation: ApprovalOperation
): operation is KeyRotationOperation {
  return operation.operationType === "key-rotation";
}

export function isGovernanceOperation(
  operation: ApprovalOperation
): operation is GovernanceOperation {
  return operation.operationType === "governance";
}
