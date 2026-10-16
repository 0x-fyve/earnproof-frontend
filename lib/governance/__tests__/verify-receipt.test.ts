/**
 * Jest tests for receipt verification utilities
 *
 * Covers:
 * - Digest computation and verification
 * - Action hash reproducibility
 * - Replay detection
 * - Comprehensive verification reports
 * - Report formatting
 */

import {
  computeReceiptDigest,
  verifyReceiptDigest,
  checkActionHashReproducibility,
  detectReplayAttempts,
  verifyReceiptComprehensive,
  formatVerificationReport,
  GovernanceApprovalIntentConfirmation,
  ActionHashInput,
} from "@/lib/governance/verify-receipt";
import { GOVERNANCE_APPROVALS_SCHEMA_VERSION } from "@/lib/api/governance-approvals";

describe("Receipt Verification Utilities", () => {
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
    confirmedAt: "2024-01-15T10:00:00Z",
    expiresAt: "2025-01-15T10:00:00Z",
    ...overrides,
  });

  describe("computeReceiptDigest", () => {
    it("computes SHA256 digest", async () => {
      const json = '{"test": "data"}';
      const digest = await computeReceiptDigest(json);
      expect(digest).toBeDefined();
      expect(digest.length).toBe(64); // SHA256 in hex is 64 chars
    });

    it("produces lowercase hex output", async () => {
      const json = '{"test": "data"}';
      const digest = await computeReceiptDigest(json);
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic", async () => {
      const json = '{"test": "data"}';
      const digest1 = await computeReceiptDigest(json);
      const digest2 = await computeReceiptDigest(json);
      expect(digest1).toBe(digest2);
    });

    it("changes with different input", async () => {
      const digest1 = await computeReceiptDigest('{"test": "data1"}');
      const digest2 = await computeReceiptDigest('{"test": "data2"}');
      expect(digest1).not.toBe(digest2);
    });

    it("is sensitive to whitespace", async () => {
      const digest1 = await computeReceiptDigest('{"test":"data"}');
      const digest2 = await computeReceiptDigest('{"test": "data"}');
      // Different whitespace = different digest
      expect(digest1).not.toBe(digest2);
    });

    it("handles empty string", async () => {
      const digest = await computeReceiptDigest("");
      expect(digest.length).toBe(64);
    });

    it("handles large input", async () => {
      const largeJson = JSON.stringify({ data: "x".repeat(10000) });
      const digest = await computeReceiptDigest(largeJson);
      expect(digest.length).toBe(64);
    });

    it("handles unicode", async () => {
      const json = '{"unicode": "你好世界🌍"}';
      const digest = await computeReceiptDigest(json);
      expect(digest.length).toBe(64);
    });
  });

  describe("verifyReceiptDigest", () => {
    it("validates matching digest", async () => {
      const json = '{"test": "data"}';
      const digest = await computeReceiptDigest(json);
      const confirmation = createValidConfirmation({
        digest: { algorithm: "SHA256", value: digest },
      });
      const result = await verifyReceiptDigest(confirmation, json);
      expect(result.isValid).toBe(true);
    });

    it("rejects mismatched digest", async () => {
      const confirmation = createValidConfirmation({
        digest: {
          algorithm: "SHA256",
          value:
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      });
      const json = '{"test": "data"}';
      const result = await verifyReceiptDigest(confirmation, json);
      expect(result.isValid).toBe(false);
    });

    it("handles missing digest gracefully", async () => {
      const confirmation = createValidConfirmation();
      delete confirmation.digest;
      const json = '{"test": "data"}';
      const result = await verifyReceiptDigest(confirmation, json);
      expect(result.isValid).toBe(true); // Treats missing digest as OK
    });

    it("is case-insensitive for hex values", async () => {
      const json = '{"test": "data"}';
      const digest = await computeReceiptDigest(json);
      const confirmation = createValidConfirmation({
        digest: {
          algorithm: "SHA256",
          value: digest.toUpperCase(),
        },
      });
      const result = await verifyReceiptDigest(confirmation, json);
      expect(result.isValid).toBe(true);
    });
  });

  describe("checkActionHashReproducibility", () => {
    it("validates reproducible hash", async () => {
      const inputs: ActionHashInput = {
        targetContract: "CONTRACT123",
        proposalId: "prop-42",
        approvalRole: "VOTER",
        walletAddress: "WALLET123",
        nonce: 1,
      };

      // Compute expected hash
      const canonicalInput = JSON.stringify(inputs);
      const expectedHash = await computeReceiptDigest(canonicalInput);

      const confirmation = createValidConfirmation({
        actionHash: expectedHash,
      });

      const result = await checkActionHashReproducibility(confirmation, inputs);
      expect(result.isReproducible).toBe(true);
    });

    it("detects non-reproducible hash", async () => {
      const inputs: ActionHashInput = {
        targetContract: "CONTRACT123",
        proposalId: "prop-42",
        approvalRole: "VOTER",
        walletAddress: "WALLET123",
        nonce: 1,
      };

      const confirmation = createValidConfirmation({
        actionHash:
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      });

      const result = await checkActionHashReproducibility(confirmation, inputs);
      expect(result.isReproducible).toBe(false);
      expect(result.computedHash).toBeDefined();
    });

    it("is sensitive to input order", async () => {
      const inputs1: ActionHashInput = {
        targetContract: "CONTRACT123",
        proposalId: "prop-42",
        approvalRole: "VOTER",
        walletAddress: "WALLET123",
        nonce: 1,
      };

      const inputs2: ActionHashInput = {
        proposalId: "prop-42",
        targetContract: "CONTRACT123",
        approvalRole: "VOTER",
        walletAddress: "WALLET123",
        nonce: 1,
      };

      const hash1 = await computeReceiptDigest(JSON.stringify(inputs1));
      const hash2 = await computeReceiptDigest(JSON.stringify(inputs2));

      // Same values but different JSON representation = different hashes
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("detectReplayAttempts", () => {
    it("passes safe confirmation", () => {
      const confirmation = createValidConfirmation({
        network: "stellar:testnet",
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
        state: "confirmed",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      const result = detectReplayAttempts(
        confirmation,
        "stellar:testnet",
        "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW"
      );
      expect(result.isLikelyReplay).toBe(false);
      expect(result.riskFactors).toHaveLength(0);
    });

    it("detects network mismatch", () => {
      const confirmation = createValidConfirmation({
        network: "stellar:testnet",
      });
      const result = detectReplayAttempts(
        confirmation,
        "stellar:mainnet",
        confirmation.walletAddress
      );
      expect(result.isLikelyReplay).toBe(true);
      expect(result.riskFactors.some((f) => f.includes("Network mismatch"))).toBe(true);
    });

    it("detects wallet mismatch", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const result = detectReplayAttempts(
        confirmation,
        confirmation.network,
        "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7"
      );
      expect(result.isLikelyReplay).toBe(true);
      expect(result.riskFactors.some((f) => f.includes("Wallet mismatch"))).toBe(true);
    });

    it("detects expired receipt", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const result = detectReplayAttempts(
        confirmation,
        confirmation.network,
        confirmation.walletAddress
      );
      expect(result.isLikelyReplay).toBe(true);
      expect(
        result.riskFactors.some((f) => f.includes("expired"))
      ).toBe(true);
    });

    it("detects unconfirmed state", () => {
      const confirmation = createValidConfirmation({
        state: "submitted",
      });
      const result = detectReplayAttempts(
        confirmation,
        confirmation.network,
        confirmation.walletAddress
      );
      expect(result.isLikelyReplay).toBe(true);
      expect(result.riskFactors.some((f) => f.includes("not \"confirmed\""))).toBe(true);
    });

    it("is case-insensitive for wallet addresses", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const result = detectReplayAttempts(
        confirmation,
        confirmation.network,
        "gbrpyhil2ci3whzdtooqfc6eb4pszbmqv24ichtdfg7uk7gqei6n3xew"
      );
      expect(result.isLikelyReplay).toBe(false);
    });
  });

  describe("verifyReceiptComprehensive", () => {
    it("validates valid confirmation", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      expect(report.overallValid).toBe(true);
      expect(report.schemaValidation.isValid).toBe(true);
    });

    it("rejects invalid structure", async () => {
      const report = await verifyReceiptComprehensive({ invalid: "object" });
      expect(report.overallValid).toBe(false);
    });

    it("includes digest verification when json provided", async () => {
      const confirmation = createValidConfirmation({
        digest: {
          algorithm: "SHA256",
          value: await computeReceiptDigest('{"test": "data"}'),
        },
      });
      const report = await verifyReceiptComprehensive(confirmation, {
        jsonString: '{"test": "data"}',
      });
      expect(report.digestVerification).toBeDefined();
      expect(report.digestVerification?.isValid).toBe(true);
    });

    it("includes action hash check when inputs provided", async () => {
      const inputs: ActionHashInput = {
        targetContract: "CONTRACT123",
        proposalId: "prop-42",
        approvalRole: "VOTER",
        walletAddress: "WALLET123",
        nonce: 1,
      };
      const canonicalInput = JSON.stringify(inputs);
      const hash = await computeReceiptDigest(canonicalInput);

      const confirmation = createValidConfirmation({
        actionHash: hash,
      });

      const report = await verifyReceiptComprehensive(confirmation, {
        actionHashInputs: inputs,
      });
      expect(report.actionHashCheck).toBeDefined();
      expect(report.actionHashCheck?.isReproducible).toBe(true);
    });

    it("includes replay detection when network/wallet provided", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation, {
        expectedNetwork: "stellar:testnet",
        expectedWallet: confirmation.walletAddress,
      });
      expect(report.replayDetection).toBeDefined();
      expect(report.replayDetection.isLikelyReplay).toBe(false);
    });

    it("detects expiration", async () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const report = await verifyReceiptComprehensive(confirmation);
      expect(report.expirationCheck.isExpired).toBe(true);
      expect(report.overallValid).toBe(false);
    });

    it("uses provided serverNow parameter", async () => {
      const serverTime = new Date(Date.now() + 1000000);
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() + 500000).toISOString(),
      });
      const report = await verifyReceiptComprehensive(confirmation, {
        serverNow: serverTime,
      });
      expect(report.expirationCheck.isExpired).toBe(true);
    });

    it("collects multiple error types", async () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        state: "failed",
      });
      const report = await verifyReceiptComprehensive(confirmation, {
        expectedNetwork: "stellar:mainnet", // Mismatch
        expectedWallet: "DIFFERENT_WALLET",
      });
      expect(report.errors.length).toBeGreaterThan(0);
    });
  });

  describe("formatVerificationReport", () => {
    it("produces readable text output", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      expect(formatted).toContain("VERIFICATION REPORT");
      expect(formatted).toContain(report.receiptId);
    });

    it("indicates overall validity", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      expect(formatted).toContain("Overall Valid");
      expect(formatted).toContain("✓ YES");
    });

    it("includes schema validation section", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      expect(formatted).toContain("SCHEMA VALIDATION");
    });

    it("includes expiration section", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      expect(formatted).toContain("EXPIRATION CHECK");
    });

    it("includes replay detection section", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      expect(formatted).toContain("REPLAY DETECTION");
    });

    it("lists errors and warnings", async () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      if (report.errors.length > 0) {
        expect(formatted).toContain("ERRORS");
      }
    });

    it("handles reports with no digest verification", async () => {
      const confirmation = createValidConfirmation();
      const report = await verifyReceiptComprehensive(confirmation);
      const formatted = formatVerificationReport(report);
      // Should not crash even if digestVerification is undefined
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});
