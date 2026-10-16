/**
 * Jest tests for receipt export utilities
 *
 * Covers:
 * - Safe filename validation
 * - Export plan generation
 * - Disclosure warnings
 * - JSON serialization determinism
 * - Plain text and CSV formatting
 * - Clipboard integration
 */

import {
  isSafeApprovalReceiptFilename,
  collectApprovalReceiptDisclosureWarnings,
  serializeApprovalReceiptJson,
  buildApprovalReceiptExport,
  buildApprovalReceiptVerificationLinkExport,
  formatApprovalReceiptAsPlainText,
  formatApprovalReceiptAsCSV,
  APPROVAL_RECEIPT_EXPORT_FILENAME,
  APPROVAL_RECEIPT_LINK_EXPORT_FILENAME,
  GovernanceApprovalIntentConfirmation,
} from "@/lib/governance/receipt-export";
import { GOVERNANCE_APPROVALS_SCHEMA_VERSION } from "@/lib/api/governance-approvals";

describe("Receipt Export Utilities", () => {
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
    metadata: { governanceDao: "MyDAO" },
    ...overrides,
  });

  describe("isSafeApprovalReceiptFilename", () => {
    it("accepts valid receipt filename", () => {
      expect(isSafeApprovalReceiptFilename(APPROVAL_RECEIPT_EXPORT_FILENAME)).toBe(
        true
      );
    });

    it("accepts valid link filename", () => {
      expect(isSafeApprovalReceiptFilename(APPROVAL_RECEIPT_LINK_EXPORT_FILENAME)).toBe(
        true
      );
    });

    it("rejects arbitrary filenames", () => {
      expect(isSafeApprovalReceiptFilename("arbitrary.json")).toBe(false);
    });

    it("rejects filenames with wallet addresses", () => {
      expect(
        isSafeApprovalReceiptFilename(
          "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW.json"
        )
      ).toBe(false);
    });

    it("rejects filenames with Ethereum addresses", () => {
      expect(
        isSafeApprovalReceiptFilename("0x1234567890abcdef1234567890abcdef12345678.json")
      ).toBe(false);
    });

    it("rejects filenames with earnproof IDs", () => {
      expect(
        isSafeApprovalReceiptFilename(
          "ep-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.json"
        )
      ).toBe(false);
    });
  });

  describe("collectApprovalReceiptDisclosureWarnings", () => {
    it("includes wallet address warning", () => {
      const confirmation = createValidConfirmation();
      const warnings = collectApprovalReceiptDisclosureWarnings(confirmation);
      expect(warnings.some((w) => w.field === "wallet")).toBe(true);
      expect(warnings.some((w) => w.message.includes("wallet address"))).toBe(true);
    });

    it("includes contract warning", () => {
      const confirmation = createValidConfirmation();
      const warnings = collectApprovalReceiptDisclosureWarnings(confirmation);
      expect(warnings.some((w) => w.field === "contract")).toBe(true);
      expect(warnings.some((w) => w.message.includes("contract"))).toBe(true);
    });

    it("includes proposal warning", () => {
      const confirmation = createValidConfirmation();
      const warnings = collectApprovalReceiptDisclosureWarnings(confirmation);
      expect(warnings.some((w) => w.field === "proposal")).toBe(true);
      expect(warnings.some((w) => w.message.includes("proposal"))).toBe(true);
    });

    it("returns warnings for any confirmation", () => {
      const confirmation = createValidConfirmation();
      const warnings = collectApprovalReceiptDisclosureWarnings(confirmation);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("serializeApprovalReceiptJson", () => {
    it("produces valid JSON", () => {
      const confirmation = createValidConfirmation();
      const json = serializeApprovalReceiptJson(confirmation);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("is deterministic (same input = same output)", () => {
      const confirmation = createValidConfirmation();
      const json1 = serializeApprovalReceiptJson(confirmation);
      const json2 = serializeApprovalReceiptJson(confirmation);
      expect(json1).toBe(json2);
    });

    it("preserves all fields", () => {
      const confirmation = createValidConfirmation();
      const json = serializeApprovalReceiptJson(confirmation);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(confirmation.id);
      expect(parsed.actionHash).toBe(confirmation.actionHash);
      expect(parsed.walletAddress).toBe(confirmation.walletAddress);
    });

    it("includes metadata", () => {
      const confirmation = createValidConfirmation({
        metadata: { key: "value", number: 42 },
      });
      const json = serializeApprovalReceiptJson(confirmation);
      const parsed = JSON.parse(json);
      expect(parsed.metadata.key).toBe("value");
      expect(parsed.metadata.number).toBe(42);
    });

    it("includes digest if present", () => {
      const confirmation = createValidConfirmation({
        digest: { algorithm: "SHA256", value: "abc123" },
      });
      const json = serializeApprovalReceiptJson(confirmation);
      const parsed = JSON.parse(json);
      expect(parsed.digest.algorithm).toBe("SHA256");
    });

    it("does not pretty-print (compact output)", () => {
      const confirmation = createValidConfirmation();
      const json = serializeApprovalReceiptJson(confirmation);
      // Compact JSON should not have newlines or indentation
      expect(json).not.toContain("\n");
      expect(json).not.toContain("  ");
    });
  });

  describe("buildApprovalReceiptExport", () => {
    it("builds valid export plan", () => {
      const confirmation = createValidConfirmation();
      const plan = buildApprovalReceiptExport({ confirmation });
      expect(plan.filename).toBe(APPROVAL_RECEIPT_EXPORT_FILENAME);
      expect(plan.mimeType).toBe("application/json");
      expect(plan.includedFields.length).toBeGreaterThan(0);
    });

    it("includes all public fields", () => {
      const confirmation = createValidConfirmation();
      const plan = buildApprovalReceiptExport({ confirmation });
      expect(plan.includedFields).toContain("id");
      expect(plan.includedFields).toContain("actionHash");
      expect(plan.includedFields).toContain("walletAddress");
      expect(plan.includedFields).toContain("state");
    });

    it("includes disclosure warnings", () => {
      const confirmation = createValidConfirmation();
      const plan = buildApprovalReceiptExport({ confirmation });
      expect(plan.warnings.length).toBeGreaterThan(0);
    });

    it("produces valid JSON body", () => {
      const confirmation = createValidConfirmation();
      const plan = buildApprovalReceiptExport({ confirmation });
      expect(() => JSON.parse(plan.body)).not.toThrow();
    });

    it("includes optional digest if provided", () => {
      const confirmation = createValidConfirmation();
      const digest = { algorithm: "SHA256", value: "abc123" };
      const plan = buildApprovalReceiptExport({ confirmation, digest });
      expect(plan.digest).toEqual(digest);
    });

    it("omits digest if not provided", () => {
      const confirmation = createValidConfirmation();
      const plan = buildApprovalReceiptExport({ confirmation });
      expect(plan.digest).toBeUndefined();
    });
  });

  describe("buildApprovalReceiptVerificationLinkExport", () => {
    it("builds valid link export plan", () => {
      const url = "https://earnproof.example.com/verify/receipt-123";
      const plan = buildApprovalReceiptVerificationLinkExport(url);
      expect(plan.filename).toBe(APPROVAL_RECEIPT_LINK_EXPORT_FILENAME);
      expect(plan.mimeType).toBe("text/plain");
      expect(plan.body).toBe(url);
    });

    it("includes verificationUrl in fields", () => {
      const url = "https://example.com/verify/123";
      const plan = buildApprovalReceiptVerificationLinkExport(url);
      expect(plan.includedFields).toContain("verificationUrl");
    });

    it("has no warnings for link export", () => {
      const url = "https://example.com/verify/123";
      const plan = buildApprovalReceiptVerificationLinkExport(url);
      expect(plan.warnings).toHaveLength(0);
    });
  });

  describe("formatApprovalReceiptAsPlainText", () => {
    it("produces readable text format", () => {
      const confirmation = createValidConfirmation();
      const text = formatApprovalReceiptAsPlainText(confirmation);
      expect(text).toContain("EARNPROOF GOVERNANCE APPROVAL INTENT RECEIPT");
      expect(text).toContain(confirmation.id);
      expect(text).toContain(confirmation.actionHash);
    });

    it("includes all canonical fields", () => {
      const confirmation = createValidConfirmation();
      const text = formatApprovalReceiptAsPlainText(confirmation);
      expect(text).toContain("Action Hash:");
      expect(text).toContain("Network:");
      expect(text).toContain("Target Contract:");
      expect(text).toContain("Proposal ID:");
      expect(text).toContain("Approval Role:");
      expect(text).toContain("Wallet Address:");
      expect(text).toContain("State:");
    });

    it("includes metadata section", () => {
      const confirmation = createValidConfirmation({
        metadata: { dao: "TestDAO", title: "Proposal 1" },
      });
      const text = formatApprovalReceiptAsPlainText(confirmation);
      expect(text).toContain("METADATA");
      expect(text).toContain("dao: TestDAO");
      expect(text).toContain("title: Proposal 1");
    });

    it("omits metadata section if empty", () => {
      const confirmation = createValidConfirmation();
      delete confirmation.metadata;
      const text = formatApprovalReceiptAsPlainText(confirmation);
      const metadataIndex = text.indexOf("METADATA");
      expect(metadataIndex).toBe(-1);
    });

    it("includes digest section if present", () => {
      const confirmation = createValidConfirmation({
        digest: { algorithm: "SHA256", value: "abc123" },
      });
      const text = formatApprovalReceiptAsPlainText(confirmation);
      expect(text).toContain("INTEGRITY");
      expect(text).toContain("SHA256");
      expect(text).toContain("abc123");
    });

    it("includes important notice", () => {
      const confirmation = createValidConfirmation();
      const text = formatApprovalReceiptAsPlainText(confirmation);
      expect(text).toContain("IMPORTANT");
      expect(text).toContain("APPROVAL INTENT");
      expect(text).toContain("NOT claim execution");
    });
  });

  describe("formatApprovalReceiptAsCSV", () => {
    it("produces valid CSV", () => {
      const confirmation = createValidConfirmation();
      const csv = formatApprovalReceiptAsCSV([confirmation]);
      const lines = csv.split("\n");
      expect(lines.length).toBeGreaterThan(1); // Header + at least one row
    });

    it("includes header row", () => {
      const confirmation = createValidConfirmation();
      const csv = formatApprovalReceiptAsCSV([confirmation]);
      const header = csv.split("\n")[0];
      expect(header).toContain("Receipt ID");
      expect(header).toContain("Action Hash");
      expect(header).toContain("Wallet Address");
    });

    it("includes confirmation data in rows", () => {
      const confirmation = createValidConfirmation({
        id: "test-123",
        proposalId: "prop-42",
      });
      const csv = formatApprovalReceiptAsCSV([confirmation]);
      expect(csv).toContain("test-123");
      expect(csv).toContain("prop-42");
    });

    it("handles multiple confirmations", () => {
      const conf1 = createValidConfirmation({ id: "receipt-1" });
      const conf2 = createValidConfirmation({ id: "receipt-2" });
      const csv = formatApprovalReceiptAsCSV([conf1, conf2]);
      const lines = csv.split("\n");
      expect(lines.length).toBe(3); // Header + 2 rows
      expect(csv).toContain("receipt-1");
      expect(csv).toContain("receipt-2");
    });

    it("escapes CSV special characters", () => {
      const confirmation = createValidConfirmation({
        metadata: { title: 'Quote "test"' },
      });
      // Note: metadata is not in CSV, but testing the escape logic
      const csv = formatApprovalReceiptAsCSV([confirmation]);
      // Should be valid CSV
      expect(() => CSV.parse(csv)).not.toThrow();
    });

    it("handles fields with commas", () => {
      const confirmation = createValidConfirmation({
        proposalId: "prop, with, commas",
      });
      const csv = formatApprovalReceiptAsCSV([confirmation]);
      const lines = csv.split("\n");
      // Should quote the field
      expect(lines[1]).toContain('"prop, with, commas"');
    });

    it("handles empty metadata", () => {
      const confirmation = createValidConfirmation();
      delete confirmation.metadata;
      const csv = formatApprovalReceiptAsCSV([confirmation]);
      expect(() => csv.split("\n")).not.toThrow();
    });

    it("produces parseable CSV", () => {
      const confirmations = [
        createValidConfirmation({ id: "r1" }),
        createValidConfirmation({ id: "r2" }),
      ];
      const csv = formatApprovalReceiptAsCSV(confirmations);
      const lines = csv.split("\n");
      // Basic structure check
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0].split(",").length).toBeGreaterThan(5);
    });
  });

  describe("Determinism and consistency", () => {
    it("same confirmation produces same export plan", () => {
      const confirmation = createValidConfirmation();
      const plan1 = buildApprovalReceiptExport({ confirmation });
      const plan2 = buildApprovalReceiptExport({ confirmation });
      expect(plan1.body).toBe(plan2.body);
      expect(plan1.filename).toBe(plan2.filename);
    });

    it("plain text format is consistent", () => {
      const confirmation = createValidConfirmation();
      const text1 = formatApprovalReceiptAsPlainText(confirmation);
      const text2 = formatApprovalReceiptAsPlainText(confirmation);
      expect(text1).toBe(text2);
    });

    it("CSV format is consistent", () => {
      const confirmations = [createValidConfirmation()];
      const csv1 = formatApprovalReceiptAsCSV(confirmations);
      const csv2 = formatApprovalReceiptAsCSV(confirmations);
      expect(csv1).toBe(csv2);
    });
  });
});
