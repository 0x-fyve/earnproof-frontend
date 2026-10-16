/**
 * Synthetic fixtures for contract upgrade testing
 * 
 * Provides comprehensive test data for positive, negative, authorization,
 * concurrency, boundary, and regression test cases.
 */

import type {
  ContractUpgradeReview,
  ContractUpgradeMetadata,
  CompatibilityCheckResult,
  BlockingFinding,
  MigrationRequirement,
  SignedArtifactHash,
} from "@/lib/validation/contract-upgrades";

/**
 * Helper to create a contract metadata fixture
 */
export function makeContractUpgradeMetadata(
  overrides?: Partial<ContractUpgradeMetadata>
): ContractUpgradeMetadata {
  const now = new Date();
  const startsIn = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  const endsIn = new Date(startsIn.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days later

  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    contractAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    contractIdentity: "earnproof-core-v1",
    currentVersion: "1.0.0",
    proposedVersion: "1.1.0",
    proposedAt: now.toISOString(),
    proposedBy: "GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB",
    activationWindow: {
      startsAt: startsIn.toISOString(),
      endsAt: endsIn.toISOString(),
    },
    description: "Upgrade includes improvements to payment verification logic and enhanced security checks.",
    ...overrides,
  };
}

/**
 * Helper to create a compatibility check fixture
 */
export function makeCompatibilityCheck(
  overrides?: Partial<CompatibilityCheckResult>
): CompatibilityCheckResult {
  return {
    category: "abi",
    status: "compatible",
    severity: "info",
    message: "ABI is backward compatible with current version",
    details: {
      addedMethods: 0,
      removedMethods: 0,
      modifiedMethods: 0,
    },
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper to create a blocking finding fixture
 */
export function makeBlockingFinding(
  overrides?: Partial<BlockingFinding>
): BlockingFinding {
  return {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    title: "Database schema migration required",
    description: "The upgrade requires a database schema migration to add new payment classification types.",
    category: "migration",
    affectedComponent: "PaymentVerificationService",
    resolution: "Run migration script: scripts/migrations/add-payment-types.sql",
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper to create a migration requirement fixture
 */
export function makeMigrationRequirement(
  overrides?: Partial<MigrationRequirement>
): MigrationRequirement {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    phase: 1,
    type: "pre-upgrade",
    title: "Stop all payment verification jobs",
    description: "Disable automated payment verification to prevent data inconsistencies during upgrade.",
    estimatedDurationMinutes: 5,
    dependencies: [],
    completed: false,
    ...overrides,
  };
}

/**
 * Helper to create a signed artifact hash fixture
 */
export function makeSignedArtifactHash(
  overrides?: Partial<SignedArtifactHash>
): SignedArtifactHash {
  return {
    type: "contract-bytecode",
    hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    algorithm: "sha256",
    signature:
      "0x7e7c4a5d8f9e3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e",
    signedBy: "GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB",
    signedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper to create a complete contract upgrade review fixture
 */
export function makeContractUpgradeReview(
  overrides?: Partial<ContractUpgradeReview>
): ContractUpgradeReview {
  return {
    id: "550e8400-e29b-41d4-a716-446655440111",
    metadata: makeContractUpgradeMetadata(),
    compatibilityChecks: [
      makeCompatibilityCheck({
        category: "abi",
        status: "compatible",
        message: "ABI is backward compatible",
      }),
      makeCompatibilityCheck({
        category: "storage",
        status: "compatible",
        message: "Storage layout is compatible with migration",
      }),
      makeCompatibilityCheck({
        category: "dependency",
        status: "compatible",
        message: "All external dependencies are available",
      }),
      makeCompatibilityCheck({
        category: "client",
        status: "compatible",
        message: "Client library versions are compatible",
      }),
    ],
    blockingFindings: [],
    migrationRequirements: [
      makeMigrationRequirement({
        phase: 1,
        type: "pre-upgrade",
        title: "Stop verification jobs",
      }),
      makeMigrationRequirement({
        phase: 2,
        type: "upgrade",
        title: "Deploy contract upgrade",
        estimatedDurationMinutes: 15,
      }),
      makeMigrationRequirement({
        phase: 3,
        type: "post-upgrade",
        title: "Resume verification jobs",
        estimatedDurationMinutes: 5,
      }),
    ],
    artifactHashes: [
      makeSignedArtifactHash({ type: "contract-bytecode" }),
      makeSignedArtifactHash({ type: "abi" }),
      makeSignedArtifactHash({ type: "metadata" }),
    ],
    overallStatus: "pending-review",
    ...overrides,
  };
}

/**
 * Approved upgrade review fixture
 */
export function makeApprovedContractUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    overallStatus: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: "GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB",
    notes: "Upgrade approved after successful testing in staging environment.",
  });
}

/**
 * Rejected upgrade review fixture
 */
export function makeRejectedContractUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    overallStatus: "rejected",
    rejectionReason: "ABI changes are incompatible with active clients",
  });
}

/**
 * Blocked upgrade review fixture (with blocking findings)
 */
export function makeBlockedContractUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    overallStatus: "blocked",
    blockingFindings: [
      makeBlockingFinding({
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        category: "critical",
        title: "Security vulnerability in new code",
        description: "Static analysis detected a potential reentrancy vulnerability in the payment handler.",
      }),
      makeBlockingFinding({
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
        category: "compatibility",
        title: "Unknown compatibility with legacy clients",
        description: "Cannot determine compatibility with clients running versions prior to 0.8.0",
      }),
    ],
  });
}

/**
 * Upgrade with unknown compatibility status (approval disabled)
 */
export function makeUnknownCompatibilityUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    compatibilityChecks: [
      makeCompatibilityCheck({
        category: "abi",
        status: "unknown",
        severity: "warning",
        message: "ABI compatibility could not be determined",
      }),
      makeCompatibilityCheck({
        category: "storage",
        status: "compatible",
        message: "Storage layout is compatible",
      }),
      makeCompatibilityCheck({
        category: "dependency",
        status: "compatible",
        message: "Dependencies are available",
      }),
      makeCompatibilityCheck({
        category: "client",
        status: "unknown",
        severity: "warning",
        message: "Client compatibility unknown",
      }),
    ],
  });
}

/**
 * Upgrade with no contract identity (approval disabled)
 */
export function makeNoIdentityContractUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    metadata: makeContractUpgradeMetadata({
      contractIdentity: "", // Empty identity
    }),
  });
}

/**
 * Upgrade with incompatible ABI
 */
export function makeIncompatibleABIUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    compatibilityChecks: [
      makeCompatibilityCheck({
        category: "abi",
        status: "incompatible",
        severity: "error",
        message: "ABI is not backward compatible - removed methods",
        details: {
          removedMethods: 3,
          affectedMethods: ["verifyPayment", "getRemainingBalance", "getPaymentHistory"],
        },
      }),
      makeCompatibilityCheck({
        category: "storage",
        status: "compatible",
        message: "Storage layout is compatible",
      }),
      makeCompatibilityCheck({
        category: "dependency",
        status: "compatible",
        message: "Dependencies are available",
      }),
      makeCompatibilityCheck({
        category: "client",
        status: "compatible",
        message: "Client versions compatible",
      }),
    ],
  });
}

/**
 * Upgrade with multiple blocking findings
 */
export function makeMultipleBlockingFindingsUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    overallStatus: "blocked",
    blockingFindings: [
      makeBlockingFinding({
        id: "c1",
        category: "critical",
        title: "Critical security issue",
        description: "Reentrancy vulnerability in payment handler",
        affectedComponent: "PaymentHandler",
      }),
      makeBlockingFinding({
        id: "c2",
        category: "security",
        title: "Insufficient access control",
        description: "Admin functions lack proper authorization checks",
        affectedComponent: "AdminFunctions",
      }),
      makeBlockingFinding({
        id: "c3",
        category: "compatibility",
        title: "Breaking API change",
        description: "Payment verification signature format changed",
        affectedComponent: "VerificationAPI",
      }),
      makeBlockingFinding({
        id: "c4",
        category: "migration",
        title: "Data migration required",
        description: "Existing payment records must be migrated to new schema",
        affectedComponent: "Database",
      }),
    ],
  });
}

/**
 * Upgrade with complex migration requirements
 */
export function makeComplexMigrationUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    migrationRequirements: [
      makeMigrationRequirement({
        id: "m1",
        phase: 1,
        type: "pre-upgrade",
        title: "Backup current state",
        estimatedDurationMinutes: 10,
        dependencies: [],
      }),
      makeMigrationRequirement({
        id: "m2",
        phase: 1,
        type: "pre-upgrade",
        title: "Stop payment verification service",
        estimatedDurationMinutes: 2,
        dependencies: ["m1"],
      }),
      makeMigrationRequirement({
        id: "m3",
        phase: 2,
        type: "upgrade",
        title: "Deploy contract bytecode",
        estimatedDurationMinutes: 20,
        dependencies: ["m2"],
      }),
      makeMigrationRequirement({
        id: "m4",
        phase: 2,
        type: "upgrade",
        title: "Run database migrations",
        estimatedDurationMinutes: 15,
        dependencies: ["m3"],
      }),
      makeMigrationRequirement({
        id: "m5",
        phase: 3,
        type: "post-upgrade",
        title: "Verify contract state",
        estimatedDurationMinutes: 5,
        dependencies: ["m4"],
      }),
      makeMigrationRequirement({
        id: "m6",
        phase: 3,
        type: "post-upgrade",
        title: "Resume payment verification",
        estimatedDurationMinutes: 2,
        dependencies: ["m5"],
      }),
    ],
  });
}

/**
 * Upgrade with multiple artifact hashes
 */
export function makeMultipleArtifactHashesUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    artifactHashes: [
      makeSignedArtifactHash({
        type: "contract-bytecode",
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        signedBy: "GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB",
      }),
      makeSignedArtifactHash({
        type: "abi",
        hash: "a4b1c42d8f9e3a7b5c1d4e6f2a9b0c3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
        signedBy: "GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB",
      }),
      makeSignedArtifactHash({
        type: "metadata",
        hash: "b5c2d43e8f0a4b6c2d3e4f5a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
        signedBy: "GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB",
      }),
    ],
  });
}

/**
 * Boundary case: upgrade with maximum string lengths
 */
export function makeBoundaryMaxStringLengthUpgradeReview(): ContractUpgradeReview {
  const maxDescription = "A".repeat(5000);
  const maxNotes = "B".repeat(5000);

  return makeContractUpgradeReview({
    metadata: makeContractUpgradeMetadata({
      description: maxDescription,
    }),
    notes: maxNotes,
  });
}

/**
 * Boundary case: upgrade with minimum required data
 */
export function makeBoundaryMinimumDataUpgradeReview(): ContractUpgradeReview {
  return makeContractUpgradeReview({
    compatibilityChecks: [
      makeCompatibilityCheck({
        category: "abi",
        status: "compatible",
        message: "OK",
      }),
    ],
    blockingFindings: [],
    migrationRequirements: [],
    artifactHashes: [],
  });
}

/**
 * Concurrent modification scenario: same review loaded by multiple operators
 */
export function makeConcurrentModificationScenario(): {
  initial: ContractUpgradeReview;
  updated: ContractUpgradeReview;
} {
  const initial = makeContractUpgradeReview();
  const updated = makeContractUpgradeReview({
    overallStatus: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: "OTHER_OPERATOR_ADDRESS",
  });

  return { initial, updated };
}

/**
 * Regression test: state transitions
 */
export function makeStateTransitionScenarios(): {
  pending: ContractUpgradeReview;
  approved: ContractUpgradeReview;
  rejected: ContractUpgradeReview;
  blocked: ContractUpgradeReview;
} {
  return {
    pending: makeContractUpgradeReview({ overallStatus: "pending-review" }),
    approved: makeApprovedContractUpgradeReview(),
    rejected: makeRejectedContractUpgradeReview(),
    blocked: makeBlockedContractUpgradeReview(),
  };
}
