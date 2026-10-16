/**
 * Governance Approval Receipt Export Utilities
 *
 * Implements export pipeline for governance approval intent receipts,
 * following patterns from lib/credentials/export.ts.
 *
 * Ensures:
 * - Deterministic serialization (no PII leakage, safe filenames)
 * - Integrity metadata (optional digest support)
 * - Clear disclosure warnings
 * - Download and clipboard integration
 */

import {
  GovernanceApprovalIntentConfirmation,
  PUBLIC_GOVERNANCE_APPROVAL_FIELDS,
  GovernanceApprovalDigestMetadata,
} from "@/lib/api/governance-approvals";

export const APPROVAL_RECEIPT_EXPORT_FILENAME = "earnproof-approval-receipt.json";
export const APPROVAL_RECEIPT_LINK_EXPORT_FILENAME = "earnproof-approval-verification-link.txt";

/** Disclosure warnings for exported approval receipts. */
export type ReceiptDisclosureWarning = {
  field: "wallet" | "contract" | "proposal";
  message: string;
};

/** Export plan for an approval receipt, matching ArtifactExportPlan pattern. */
export type ApprovalReceiptExportPlan = {
  filename: string;
  includedFields: string[];
  warnings: ReceiptDisclosureWarning[];
  body: string;
  mimeType: string;
  digest?: GovernanceApprovalDigestMetadata;
};

/** Pattern to detect unsafe filenames (e.g., wallet addresses, contract IDs injected into filename). */
const UNSAFE_FILENAME_PATTERN =
  /G[A-Z0-9]{55}|0x[a-fA-F0-9]{8,}|ep[_-][A-Za-z0-9._:-]+|EP-[A-Za-z0-9._:-]+/i;

/**
 * Validates that a filename is safe for download.
 * Blocks template injection and credential embedding attempts.
 */
export function isSafeApprovalReceiptFilename(filename: string): boolean {
  if (
    filename !== APPROVAL_RECEIPT_EXPORT_FILENAME &&
    filename !== APPROVAL_RECEIPT_LINK_EXPORT_FILENAME
  ) {
    return false;
  }
  return !UNSAFE_FILENAME_PATTERN.test(filename);
}

/**
 * Collects disclosure warnings for an approval receipt export.
 * Similar to credentials/export.ts pattern.
 */
export function collectApprovalReceiptDisclosureWarnings(
  confirmation: GovernanceApprovalIntentConfirmation
): ReceiptDisclosureWarning[] {
  const warnings: ReceiptDisclosureWarning[] = [];

  // Wallet address is always included (needed for verification)
  warnings.push({
    field: "wallet",
    message:
      "This export includes your wallet address. Do not share if you wish to remain anonymous.",
  });

  // Contract ID is always included (needed for verification)
  warnings.push({
    field: "contract",
    message: "This export includes the target contract address. Verify it matches the intended governance system.",
  });

  // Proposal ID is always included (needed for verification)
  warnings.push({
    field: "proposal",
    message:
      "This export includes the proposal ID. Ensure it matches the proposal you intended to approve.",
  });

  return warnings;
}

/**
 * Serializes an approval confirmation to JSON.
 * Preserves structure exactly as provided by server.
 */
export function serializeApprovalReceiptJson(confirmation: GovernanceApprovalIntentConfirmation): string {
  // No pretty-printing or key sorting; preserve exact server structure for determinism
  return JSON.stringify(confirmation);
}

/**
 * Builds an export plan for an approval receipt.
 * Includes all public fields, warnings, and optional digest.
 *
 * @param confirmation - Server-confirmed approval intent
 * @param digest - Optional integrity metadata (e.g., from server)
 * @returns Export plan ready for download or clipboard
 */
export function buildApprovalReceiptExport(input: {
  confirmation: GovernanceApprovalIntentConfirmation;
  digest?: GovernanceApprovalDigestMetadata;
}): ApprovalReceiptExportPlan {
  const { confirmation, digest } = input;

  const body = serializeApprovalReceiptJson(confirmation);
  const warnings = collectApprovalReceiptDisclosureWarnings(confirmation);
  const includedFields = PUBLIC_GOVERNANCE_APPROVAL_FIELDS.map((field) => String(field));

  return {
    filename: APPROVAL_RECEIPT_EXPORT_FILENAME,
    includedFields,
    warnings,
    body,
    mimeType: "application/json",
    digest,
  };
}

/**
 * Builds an export plan for an approval verification link.
 * Plain-text URL for public verification (e.g., earnproof.com/verify/{receiptId}).
 *
 * @param verificationUrl - Public verification endpoint
 * @returns Export plan for link-only export
 */
export function buildApprovalReceiptVerificationLinkExport(verificationUrl: string): ApprovalReceiptExportPlan {
  return {
    filename: APPROVAL_RECEIPT_LINK_EXPORT_FILENAME,
    includedFields: ["verificationUrl"],
    warnings: [],
    body: verificationUrl,
    mimeType: "text/plain",
  };
}

/**
 * Copies text to clipboard with browser compatibility checks.
 */
export async function copyApprovalReceiptToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard is not available in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Downloads an approval receipt export as a file.
 * Implements safety checks matching lib/credentials/export.ts.
 */
export function downloadApprovalReceipt(plan: ApprovalReceiptExportPlan): void {
  if (!isSafeApprovalReceiptFilename(plan.filename)) {
    throw new Error("Refusing to download an unsafe filename.");
  }

  const blob = new Blob([plan.body], { type: plan.mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = plan.filename;
  anchor.rel = "noopener";

  // Append, click, remove immediately to avoid memory leaks
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Clean up blob URL
  URL.revokeObjectURL(href);
}

/**
 * Formats an approval receipt for human-readable display (plain text).
 * Useful for logs, emails, or text-based exports.
 */
export function formatApprovalReceiptAsPlainText(
  confirmation: GovernanceApprovalIntentConfirmation
): string {
  const lines: string[] = [
    "=== EARNPROOF GOVERNANCE APPROVAL INTENT RECEIPT ===",
    "",
    `Receipt ID: ${confirmation.id}`,
    `Schema Version: ${confirmation.schemaVersion}`,
    `Intent Type: ${confirmation.intentType}`,
    "",
    "--- CANONICAL DATA ---",
    `Action Hash: ${confirmation.actionHash}`,
    `Network: ${confirmation.network}`,
    `Target Contract: ${confirmation.targetContract}`,
    `Proposal ID: ${confirmation.proposalId}`,
    "",
    "--- AUTHORIZATION ---",
    `Approval Role: ${confirmation.approvalRole}`,
    `Wallet Address: ${confirmation.walletAddress}`,
    "",
    "--- STATE ---",
    `State: ${confirmation.state}`,
    `Confirmed At: ${confirmation.confirmedAt}`,
    `Expires At: ${confirmation.expiresAt}`,
    "",
  ];

  if (confirmation.metadata && Object.keys(confirmation.metadata).length > 0) {
    lines.push("--- METADATA ---");
    for (const [key, value] of Object.entries(confirmation.metadata)) {
      lines.push(`${key}: ${String(value)}`);
    }
    lines.push("");
  }

  if (confirmation.digest) {
    lines.push("--- INTEGRITY ---");
    lines.push(`Algorithm: ${confirmation.digest.algorithm}`);
    lines.push(`Digest: ${confirmation.digest.value}`);
    lines.push("");
  }

  lines.push("--- IMPORTANT ---");
  lines.push("This receipt confirms APPROVAL INTENT only.");
  lines.push("It does NOT claim execution on-chain.");
  lines.push("Execution must be verified independently.");
  lines.push("=".repeat(50));

  return lines.join("\n");
}

/**
 * Formats an approval receipt for CSV export (useful for bulk governance tracking).
 * One receipt per row.
 */
export function formatApprovalReceiptAsCSV(
  confirmations: GovernanceApprovalIntentConfirmation[]
): string {
  const headers = [
    "Receipt ID",
    "Action Hash",
    "Network",
    "Target Contract",
    "Proposal ID",
    "Approval Role",
    "Wallet Address",
    "State",
    "Confirmed At",
    "Expires At",
  ];

  const rows = confirmations.map((conf) => [
    conf.id,
    conf.actionHash,
    conf.network,
    conf.targetContract,
    conf.proposalId,
    conf.approvalRole,
    conf.walletAddress,
    conf.state,
    conf.confirmedAt,
    conf.expiresAt,
  ]);

  // CSV escape: quote fields with commas or quotes
  const escapeCsvField = (field: string): string => {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  };

  const csvLines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map((cell) => escapeCsvField(String(cell))).join(",")),
  ];

  return csvLines.join("\n");
}
