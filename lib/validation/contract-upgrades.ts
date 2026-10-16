import { z } from "zod";

/**
 * Validation schemas for contract upgrade review operations
 */

// Base schemas for versioned upgrade data
export const compatibilityCheckResultSchema = z.object({
  category: z.enum(["abi", "storage", "dependency", "client"]),
  status: z.enum(["compatible", "incompatible", "unknown", "pending"]),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
  details: z.record(z.unknown()).optional(),
  checkedAt: z.string().datetime().optional(),
});

export const blockingFindingSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.enum(["critical", "security", "compatibility", "migration"]),
  affectedComponent: z.string().min(1),
  resolution: z.string().max(1000).optional(),
  detectedAt: z.string().datetime(),
});

export const migrationRequirementSchema = z.object({
  id: z.string().uuid(),
  phase: z.number().int().min(0),
  type: z.enum(["pre-upgrade", "upgrade", "post-upgrade"]),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  dependencies: z.array(z.string().uuid()).optional(),
  completed: z.boolean().optional(),
});

export const signedArtifactHashSchema = z.object({
  type: z.enum(["contract-bytecode", "abi", "metadata"]),
  hash: z.string().regex(/^[a-f0-9]{64}$/, "Must be a valid SHA256 hash"),
  algorithm: z.enum(["sha256", "keccak256"]),
  signature: z.string().min(1),
  signedBy: z.string().min(1),
  signedAt: z.string().datetime(),
});

export const contractUpgradeMetadataSchema = z.object({
  id: z.string().uuid(),
  contractAddress: z.string().min(1).regex(/^[a-zA-Z0-9]{56}$/, "Invalid Stellar contract address"),
  contractIdentity: z.string().min(1),
  currentVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format"),
  proposedVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format"),
  proposedAt: z.string().datetime(),
  proposedBy: z.string().min(1),
  activationWindow: z.object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }).refine(
    data => new Date(data.startsAt) < new Date(data.endsAt),
    "Activation window start must be before end"
  ),
  description: z.string().min(1).max(5000),
});

export const contractUpgradeReviewSchema = z.object({
  id: z.string().uuid(),
  metadata: contractUpgradeMetadataSchema,
  compatibilityChecks: z.array(compatibilityCheckResultSchema),
  blockingFindings: z.array(blockingFindingSchema),
  migrationRequirements: z.array(migrationRequirementSchema),
  artifactHashes: z.array(signedArtifactHashSchema),
  overallStatus: z.enum(["approved", "pending-review", "rejected", "blocked"]),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().min(1).optional(),
  rejectionReason: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
});

// Request/response schemas
export const approveContractUpgradeSchema = z.object({
  notes: z.string().max(5000).optional(),
});

export const rejectContractUpgradeSchema = z.object({
  reason: z.string().min(1).max(500),
  details: z.string().max(2000).optional(),
});

// Inferred types
export type CompatibilityCheckResult = z.infer<typeof compatibilityCheckResultSchema>;
export type BlockingFinding = z.infer<typeof blockingFindingSchema>;
export type MigrationRequirement = z.infer<typeof migrationRequirementSchema>;
export type SignedArtifactHash = z.infer<typeof signedArtifactHashSchema>;
export type ContractUpgradeMetadata = z.infer<typeof contractUpgradeMetadataSchema>;
export type ContractUpgradeReview = z.infer<typeof contractUpgradeReviewSchema>;
export type ApproveContractUpgradeInput = z.infer<typeof approveContractUpgradeSchema>;
export type RejectContractUpgradeInput = z.infer<typeof rejectContractUpgradeSchema>;

/**
 * Validation utilities
 */

/**
 * Check if a version string is a valid semver
 */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Check if a Stellar contract address is valid
 */
export function isValidContractAddress(address: string): boolean {
  return /^[a-zA-Z0-9]{56}$/.test(address);
}

/**
 * Check if a SHA256 hash is valid
 */
export function isValidSha256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

/**
 * Validate a complete contract upgrade review for approval readiness
 */
export function validateReviewForApproval(review: ContractUpgradeReview): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check metadata completeness
  if (!review.metadata.contractIdentity) {
    errors.push("Contract identity is required");
  }

  if (!isValidContractAddress(review.metadata.contractAddress)) {
    errors.push("Contract address is invalid");
  }

  if (!isValidVersion(review.metadata.currentVersion)) {
    errors.push("Current version format is invalid");
  }

  if (!isValidVersion(review.metadata.proposedVersion)) {
    errors.push("Proposed version format is invalid");
  }

  // Check for blocking findings
  if (review.blockingFindings.length > 0) {
    errors.push(`${review.blockingFindings.length} blocking finding(s) must be resolved`);
  }

  // Check compatibility
  const unknownChecks = review.compatibilityChecks.filter(c => c.status === "unknown");
  if (unknownChecks.length > 0) {
    errors.push(`${unknownChecks.length} compatibility check(s) are unknown`);
  }

  const incompatibleChecks = review.compatibilityChecks.filter(c => c.status === "incompatible");
  if (incompatibleChecks.length > 0) {
    errors.push(`${incompatibleChecks.length} incompatibility found`);
  }

  // Check artifact hashes
  if (review.artifactHashes.length === 0) {
    errors.push("No artifact hashes provided for verification");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get status badge information
 */
export function getStatusBadgeInfo(status: ContractUpgradeReview["overallStatus"]): {
  label: string;
  color: string;
} {
  switch (status) {
    case "approved":
      return { label: "Approved", color: "bg-green-900/30 text-green-300" };
    case "rejected":
      return { label: "Rejected", color: "bg-red-900/30 text-red-300" };
    case "blocked":
      return { label: "Blocked", color: "bg-rose-900/30 text-rose-300" };
    case "pending-review":
    default:
      return { label: "Pending Review", color: "bg-amber-900/30 text-amber-300" };
  }
}

/**
 * Get severity badge information
 */
export function getSeverityBadgeInfo(severity: "error" | "warning" | "info"): {
  label: string;
  color: string;
} {
  switch (severity) {
    case "error":
      return { label: "Error", color: "bg-red-900/30 text-red-300" };
    case "warning":
      return { label: "Warning", color: "bg-amber-900/30 text-amber-300" };
    case "info":
    default:
      return { label: "Info", color: "bg-blue-900/30 text-blue-300" };
  }
}

/**
 * Get compatibility status badge information
 */
export function getCompatibilityStatusInfo(status: "compatible" | "incompatible" | "unknown" | "pending"): {
  label: string;
  color: string;
} {
  switch (status) {
    case "compatible":
      return { label: "Compatible", color: "text-green-300" };
    case "incompatible":
      return { label: "Incompatible", color: "text-red-300" };
    case "unknown":
      return { label: "Unknown", color: "text-slate-400" };
    case "pending":
    default:
      return { label: "Pending", color: "text-blue-300" };
  }
}
