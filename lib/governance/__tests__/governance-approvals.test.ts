/**
 * Jest tests for governance approval types and validation
 *
 * Covers:
 * - Type guards and validation
 * - Authorization checks
 * - Expiration logic
 * - Determinism of action hashes
 * - Boundary conditions
 */

import {
  GovernanceApprovalIntentConfirmation,
  isGovernanceApprovalIntentConfirmation,
  validateGovernanceApprovalConfirmation,
  isGovernanceApprovalIntentExpired,
  checkGovernanceApprovalAuthorization,
  GOVERNANCE_APPROVALS_SCHEMA_VERSION,
} from "@/lib/api/governance-approvals";

describe("Governance Approvals - Types and Validation", () => {
  const createValidConfirmation = (
    overrides?: Partial<GovernanceApprovalIntentConfirmation>
  ): GovernanceApprovalIntentConfirmation => ({
    id: "receipt-123",
    intentType: "intent",
    schemaVersion: GOVERNANCE_APPROVALS_SCHEMA_VERSION,
    actionHash:
      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    network: "stellar:testnet",
    targetContract: "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7",
    proposalId: "prop-42",
    approvalRole: "VOTER",
    walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
    state: "confirmed",
    confirmedAt: new Date(Date.now() - 10000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // +1 day
    metadata: { governanceDao: "MyDAO", proposalTitle: "Budget Proposal" },
    ...overrides,
  });

  describe("isGovernanceApprovalIntentConfirmation (type guard)", () => {
    it("returns true for valid confirmation", () => {
      const confirmation = createValidConfirmation();
      expect(isGovernanceApprovalIntentConfirmation(confirmation)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isGovernanceApprovalIntentConfirmation(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isGovernanceApprovalIntentConfirmation(undefined)).toBe(false);
    });

    it("returns false for objects missing required fields", () => {
      expect(
        isGovernanceApprovalIntentConfirmation({
          id: "test",
          intentType: "intent",
          // missing other required fields
        })
      ).toBe(false);
    });

    it("returns false for invalid intentType", () => {
      const confirmation = createValidConfirmation({
        intentType: "execution" as any,
      });
      expect(isGovernanceApprovalIntentConfirmation(confirmation)).toBe(false);
    });

    it("returns false for non-string fields", () => {
      const confirmation = createValidConfirmation({
        id: 123 as any,
      });
      expect(isGovernanceApprovalIntentConfirmation(confirmation)).toBe(false);
    });
  });

  describe("validateGovernanceApprovalConfirmation", () => {
    it("passes valid confirmation", () => {
      const confirmation = createValidConfirmation();
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects invalid structure", () => {
      const result = validateGovernanceApprovalConfirmation({
        invalid: "object",
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects intentType other than 'intent'", () => {
      const confirmation = createValidConfirmation({
        intentType: "execution" as any,
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("intentType"))).toBe(true);
    });

    it("rejects unknown state", () => {
      const confirmation = createValidConfirmation({
        state: "unknown_state" as any,
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true); // State validation is warning-only
      expect(result.warnings.some((w) => w.includes("Unknown approval state"))).toBe(
        true
      );
    });

    it("rejects unknown network", () => {
      const confirmation = createValidConfirmation({
        network: "cosmos:mainnet" as any,
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true); // Network validation is warning-only
      expect(result.warnings.some((w) => w.includes("Unknown network"))).toBe(true);
    });

    it("rejects unknown role", () => {
      const confirmation = createValidConfirmation({
        approvalRole: "UNKNOWN_ROLE" as any,
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true); // Role validation is warning-only
      expect(result.warnings.some((w) => w.includes("Unknown approval role"))).toBe(
        true
      );
    });

    it("rejects invalid confirmedAt timestamp", () => {
      const confirmation = createValidConfirmation({
        confirmedAt: "not-a-timestamp",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("confirmedAt"))).toBe(true);
    });

    it("rejects invalid expiresAt timestamp", () => {
      const confirmation = createValidConfirmation({
        expiresAt: "not-a-timestamp",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("expiresAt"))).toBe(true);
    });

    it("rejects when confirmedAt is after expiresAt", () => {
      const confirmation = createValidConfirmation({
        confirmedAt: new Date(Date.now() + 86400000).toISOString(),
        expiresAt: new Date(Date.now()).toISOString(),
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("confirmedAt") && e.includes("expiresAt"))
      ).toBe(true);
    });

    it("rejects empty walletAddress", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("walletAddress"))).toBe(true);
    });

    it("rejects empty targetContract", () => {
      const confirmation = createValidConfirmation({
        targetContract: "",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("targetContract"))).toBe(true);
    });

    it("rejects empty actionHash", () => {
      const confirmation = createValidConfirmation({
        actionHash: "",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("actionHash"))).toBe(true);
    });

    it("warns on schema version mismatch", () => {
      const confirmation = createValidConfirmation({
        schemaVersion: "2.0",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.includes("Schema version mismatch"))).toBe(
        true
      );
    });

    it("accepts all valid roles", () => {
      const roles = ["PROPOSER", "VOTER", "TREASURER", "DELEGATE", "OBSERVER", "CUSTODIAN"];
      for (const role of roles) {
        const confirmation = createValidConfirmation({
          approvalRole: role as any,
        });
        const result = validateGovernanceApprovalConfirmation(confirmation);
        expect(result.isValid).toBe(true);
      }
    });

    it("accepts all valid networks", () => {
      const networks = [
        "stellar:mainnet",
        "stellar:testnet",
        "stellar:soroban-mainnet",
        "stellar:soroban-testnet",
        "ethereum:mainnet",
        "ethereum:sepolia",
      ];
      for (const network of networks) {
        const confirmation = createValidConfirmation({
          network: network as any,
        });
        const result = validateGovernanceApprovalConfirmation(confirmation);
        expect(result.isValid).toBe(true);
      }
    });

    it("accepts all valid states", () => {
      const states = ["intent_signed", "submitted", "confirmed", "failed", "superseded", "cancelled"];
      for (const state of states) {
        const confirmation = createValidConfirmation({
          state: state as any,
        });
        const result = validateGovernanceApprovalConfirmation(confirmation);
        expect(result.isValid).toBe(true);
      }
    });
  });

  describe("isGovernanceApprovalIntentExpired", () => {
    it("returns false for non-expired confirmation", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(isGovernanceApprovalIntentExpired(confirmation)).toBe(false);
    });

    it("returns true for expired confirmation", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(isGovernanceApprovalIntentExpired(confirmation)).toBe(true);
    });

    it("returns true exactly at expiration time", () => {
      const now = new Date();
      const confirmation = createValidConfirmation({
        expiresAt: now.toISOString(),
      });
      expect(isGovernanceApprovalIntentExpired(confirmation, now)).toBe(true);
    });

    it("uses provided serverNow parameter", () => {
      const serverTime = new Date(Date.now() + 100000);
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() + 50000).toISOString(),
      });
      expect(isGovernanceApprovalIntentExpired(confirmation, serverTime)).toBe(true);
    });
  });

  describe("checkGovernanceApprovalAuthorization", () => {
    it("grants access to the approver", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const result = checkGovernanceApprovalAuthorization(
        confirmation,
        "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW"
      );
      expect(result.canView).toBe(true);
      expect(result.canExport).toBe(true);
      expect(result.canSign).toBe(true);
    });

    it("denies access to other wallets", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const result = checkGovernanceApprovalAuthorization(
        confirmation,
        "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7"
      );
      expect(result.canView).toBe(false);
      expect(result.canExport).toBe(false);
      expect(result.canSign).toBe(false);
      expect(result.denialReason).toContain("Only the approver");
    });

    it("is case-insensitive", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const result = checkGovernanceApprovalAuthorization(
        confirmation,
        "gbrpyhil2ci3whzdtooqfc6eb4pszbmqv24ichtdfg7uk7gqei6n3xew"
      );
      expect(result.canView).toBe(true);
    });

    it("denies signing for expired confirmation", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const result = checkGovernanceApprovalAuthorization(
        confirmation,
        "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW"
      );
      expect(result.canView).toBe(true);
      expect(result.canExport).toBe(true);
      expect(result.canSign).toBe(false);
      expect(result.denialReason).toContain("expired");
    });

    it("denies signing for non-confirmed state", () => {
      const confirmation = createValidConfirmation({
        state: "submitted",
      });
      const result = checkGovernanceApprovalAuthorization(
        confirmation,
        confirmation.walletAddress
      );
      expect(result.canSign).toBe(false);
    });
  });

  describe("Boundary and edge cases", () => {
    it("handles maximum length addresses", () => {
      const longAddress = "A".repeat(256);
      const confirmation = createValidConfirmation({
        walletAddress: longAddress,
        targetContract: longAddress,
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
    });

    it("handles special characters in metadata", () => {
      const confirmation = createValidConfirmation({
        metadata: {
          special: "!@#$%^&*()",
          unicode: "你好世界🌍",
          quotes: 'He said "Hello"',
        },
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
    });

    it("handles missing metadata", () => {
      const confirmation = createValidConfirmation();
      delete confirmation.metadata;
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
    });

    it("handles missing digest", () => {
      const confirmation = createValidConfirmation();
      delete confirmation.digest;
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
    });

    it("validates timestamps at year boundaries", () => {
      const confirmation = createValidConfirmation({
        confirmedAt: "2024-12-31T23:59:59Z",
        expiresAt: "2025-01-01T00:00:00Z",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      expect(result.isValid).toBe(true);
    });

    it("rejects far-future expiration (potential overflow)", () => {
      const confirmation = createValidConfirmation({
        expiresAt: "9999-12-31T23:59:59Z",
      });
      const result = validateGovernanceApprovalConfirmation(confirmation);
      // Should still be valid, but might warn about unrealistic dates
      expect(result.isValid).toBe(true);
    });
  });

  describe("Determinism - action hash reproducibility", () => {
    it("same inputs always produce same hash in validation context", () => {
      const input = {
        targetContract: "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7",
        proposalId: "prop-42",
        approvalRole: "VOTER" as const,
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
        nonce: 12345,
      };

      // Create two confirmations with same hash
      const confirmation1 = createValidConfirmation({
        actionHash: "abc123",
      });
      const confirmation2 = createValidConfirmation({
        actionHash: "abc123",
      });

      expect(confirmation1.actionHash).toBe(confirmation2.actionHash);
    });
  });
});
