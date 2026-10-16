/**
 * Governance Approval Receipt Verification Utilities
 *
 * Provides deterministic verification and integrity checking for approval receipts.
 * Follows patterns from lib/credentials/verify-digest.ts.
 *
 * Supports:
 * - Digest verification (SHA256 of receipt JSON)
 * - Action hash reproducibility checking
 * - Expiration validation
 * - Server confirmation state validation
 * - Replay detection patterns
 */

import {
  GovernanceApprovalIntentConfirmation,
  ActionHashInput,
  GovernanceApprovalValidationResult,
  validateGovernanceApprovalConfirmation,
} from "@/lib/api/governance-approvals";

/** Result of digest verification. */
export type DigestVerificationResult = {
  isValid: boolean;
  computedDigest: string;
  providedDigest?: string;
  algorithm: string;
  message: string;
};

/** Result of action hash reproducibility check. */
export type ActionHashReproducibilityResult = {
  isReproducible: boolean;
  originalHash: string;
  computedHash?: string;
  message: string;
};

/** Result of replay detection check. */
export type ReplayDetectionResult = {
  isLikelyReplay: boolean;
  riskFactors: string[];
  message: string;
};

/** Complete verification report for a receipt. */
export type ReceiptVerificationReport = {
  receiptId: string;
  schemaValidation: GovernanceApprovalValidationResult;
  digestVerification?: DigestVerificationResult;
  actionHashCheck?: ActionHashReproducibilityResult;
  expirationCheck: {
    isExpired: boolean;
    expiresAt: string;
    serverNow?: string;
  };
  replayDetection: ReplayDetectionResult;
  overallValid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Computes SHA256 digest of a JSON string.
 * Uses Web Crypto API for browser compatibility.
 *
 * @param jsonString - JSON representation of receipt
 * @returns Hex-encoded SHA256 digest
 */
export async function computeReceiptDigest(jsonString: string): Promise<string> {
  // Ensure deterministic encoding
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);

  // Use SubtleCrypto (Web Crypto API)
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is not available in this environment.");
  }

  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}

/**
 * Verifies receipt digest against server-provided value.
 * Matches pattern from lib/credentials/verify-digest.ts.
 *
 * @param confirmation - Receipt to verify
 * @param jsonString - Exact JSON bytes used for digest computation
 * @returns Verification result
 */
export async function verifyReceiptDigest(
  confirmation: GovernanceApprovalIntentConfirmation,
  jsonString: string
): Promise<DigestVerificationResult> {
  if (!confirmation.digest) {
    return {
      isValid: true,
      computedDigest: await computeReceiptDigest(jsonString),
      algorithm: "SHA256",
      message: "No digest provided by server; local digest computed for reference.",
    };
  }

  const computedDigest = await computeReceiptDigest(jsonString);
  const providedDigest = confirmation.digest.value.toLowerCase();
  const computedDigestLower = computedDigest.toLowerCase();

  const isValid = computedDigestLower === providedDigest;

  return {
    isValid,
    computedDigest,
    providedDigest,
    algorithm: confirmation.digest.algorithm,
    message: isValid
      ? `Digest verified: ${confirmation.digest.algorithm} matches.`
      : `Digest mismatch: expected ${providedDigest}, computed ${computedDigestLower}.`,
  };
}

/**
 * Checks if an action hash is reproducible from canonical inputs.
 * Uses simple deterministic hashing for demonstration.
 * Production systems should use HMAC or cryptographic commitments.
 *
 * @param confirmation - Receipt containing the action hash
 * @param inputsForReproduction - Canonical inputs used to generate the hash
 * @returns Reproducibility check result
 */
export async function checkActionHashReproducibility(
  confirmation: GovernanceApprovalIntentConfirmation,
  inputsForReproduction: ActionHashInput
): Promise<ActionHashReproducibilityResult> {
  // Construct canonical input for hashing
  const canonicalInput = JSON.stringify({
    targetContract: inputsForReproduction.targetContract,
    proposalId: inputsForReproduction.proposalId,
    approvalRole: inputsForReproduction.approvalRole,
    walletAddress: inputsForReproduction.walletAddress,
    nonce: inputsForReproduction.nonce,
  });

  // Compute hash deterministically
  const computedHash = await computeReceiptDigest(canonicalInput);

  const isReproducible = computedHash === confirmation.actionHash;

  return {
    isReproducible,
    originalHash: confirmation.actionHash,
    computedHash: isReproducible ? undefined : computedHash,
    message: isReproducible
      ? "Action hash is reproducible from canonical inputs."
      : `Action hash does not match reconstructed value (${computedHash} vs ${confirmation.actionHash}).`,
  };
}

/**
 * Checks for common replay attack patterns.
 * A receipt should never be replayed across networks or wallets.
 *
 * @param confirmation - Receipt to check
 * @param expectedNetwork - Expected network (prevents cross-network replay)
 * @param expectedWallet - Expected wallet address (prevents cross-wallet replay)
 * @returns Replay detection result
 */
export function detectReplayAttempts(
  confirmation: GovernanceApprovalIntentConfirmation,
  expectedNetwork: string,
  expectedWallet: string
): ReplayDetectionResult {
  const riskFactors: string[] = [];

  // Check network mismatch
  if (confirmation.network !== expectedNetwork) {
    riskFactors.push(
      `Network mismatch: receipt from ${confirmation.network}, expected ${expectedNetwork}`
    );
  }

  // Check wallet mismatch
  if (confirmation.walletAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
    riskFactors.push(
      `Wallet mismatch: receipt from ${confirmation.walletAddress}, expected ${expectedWallet}`
    );
  }

  // Check if expired (stale receipts should not be replayed)
  if (new Date() > new Date(confirmation.expiresAt)) {
    riskFactors.push("Receipt is expired; should not be replayed");
  }

  // Check state (only confirmed receipts should be used)
  if (confirmation.state !== "confirmed") {
    riskFactors.push(
      `Receipt state is "${confirmation.state}", not "confirmed"; may not be safe to use`
    );
  }

  // Check schema version compatibility
  if (confirmation.schemaVersion !== "1.0") {
    riskFactors.push(
      `Schema version mismatch: receipt uses v${confirmation.schemaVersion}, not v1.0`
    );
  }

  const isLikelyReplay = riskFactors.length > 0;

  return {
    isLikelyReplay,
    riskFactors,
    message: isLikelyReplay
      ? `Replay risk detected: ${riskFactors.join("; ")}`
      : "No replay risk factors detected.",
  };
}

/**
 * Performs comprehensive receipt verification.
 * Checks schema, digest, action hash, expiration, and replay risks.
 *
 * @param confirmation - Receipt to verify
 * @param options - Verification options
 * @returns Complete verification report
 */
export async function verifyReceiptComprehensive(
  confirmation: unknown,
  options?: {
    jsonString?: string; // Exact JSON for digest verification
    actionHashInputs?: ActionHashInput; // For reproducibility check
    expectedNetwork?: string; // For replay detection
    expectedWallet?: string; // For replay detection
    serverNow?: Date; // For expiration check
  }
): Promise<ReceiptVerificationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate schema
  const schemaValidation = validateGovernanceApprovalConfirmation(confirmation);
  if (!schemaValidation.isValid) {
    errors.push(...schemaValidation.errors);
    warnings.push(...schemaValidation.warnings);
  }

  if (!schemaValidation.isValid) {
    // Stop here if schema is invalid
    return {
      receiptId: "(invalid)",
      schemaValidation,
      expirationCheck: {
        isExpired: false,
        expiresAt: "(unknown)",
      },
      replayDetection: {
        isLikelyReplay: true,
        riskFactors: ["Invalid schema; cannot verify receipt"],
        message: "Schema validation failed; stopping verification.",
      },
      overallValid: false,
      errors,
      warnings,
    };
  }

  const conf = confirmation as GovernanceApprovalIntentConfirmation;
  const serverNow = options?.serverNow || new Date();

  // Verify digest if provided
  let digestVerification: DigestVerificationResult | undefined;
  if (options?.jsonString) {
    try {
      digestVerification = await verifyReceiptDigest(conf, options.jsonString);
      if (!digestVerification.isValid) {
        errors.push(`Digest verification failed: ${digestVerification.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Digest verification error";
      warnings.push(`Could not verify digest: ${msg}`);
    }
  }

  // Check action hash reproducibility if inputs provided
  let actionHashCheck: ActionHashReproducibilityResult | undefined;
  if (options?.actionHashInputs) {
    try {
      actionHashCheck = await checkActionHashReproducibility(conf, options.actionHashInputs);
      if (!actionHashCheck.isReproducible) {
        warnings.push(`Action hash reproducibility check failed: ${actionHashCheck.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hash check error";
      warnings.push(`Could not check action hash: ${msg}`);
    }
  }

  // Check expiration
  const isExpired = serverNow >= new Date(conf.expiresAt);
  const expirationCheck = {
    isExpired,
    expiresAt: conf.expiresAt,
    serverNow: serverNow.toISOString(),
  };
  if (isExpired) {
    warnings.push(`Receipt has expired (${conf.expiresAt})`);
  }

  // Replay detection
  let replayDetection: ReplayDetectionResult;
  if (options?.expectedNetwork && options?.expectedWallet) {
    replayDetection = detectReplayAttempts(
      conf,
      options.expectedNetwork,
      options.expectedWallet
    );
    if (replayDetection.isLikelyReplay) {
      errors.push(...replayDetection.riskFactors);
    }
  } else {
    replayDetection = {
      isLikelyReplay: false,
      riskFactors: [],
      message: "Replay detection skipped (no expected network/wallet provided).",
    };
  }

  const overallValid = errors.length === 0 && !isExpired;

  return {
    receiptId: conf.id,
    schemaValidation,
    digestVerification,
    actionHashCheck,
    expirationCheck,
    replayDetection,
    overallValid,
    errors,
    warnings,
  };
}

/**
 * Formats a verification report for human-readable display.
 */
export function formatVerificationReport(report: ReceiptVerificationReport): string {
  const lines: string[] = [
    "=== GOVERNANCE APPROVAL RECEIPT VERIFICATION REPORT ===",
    "",
    `Receipt ID: ${report.receiptId}`,
    `Overall Valid: ${report.overallValid ? "✓ YES" : "✗ NO"}`,
    "",
  ];

  // Schema validation
  lines.push("--- SCHEMA VALIDATION ---");
  lines.push(
    `Valid: ${report.schemaValidation.isValid ? "✓ YES" : "✗ NO"}`
  );
  if (report.schemaValidation.errors.length > 0) {
    lines.push("Errors:");
    report.schemaValidation.errors.forEach((e) => lines.push(`  • ${e}`));
  }
  if (report.schemaValidation.warnings.length > 0) {
    lines.push("Warnings:");
    report.schemaValidation.warnings.forEach((w) => lines.push(`  • ${w}`));
  }
  lines.push("");

  // Digest verification
  if (report.digestVerification) {
    lines.push("--- DIGEST VERIFICATION ---");
    lines.push(`Algorithm: ${report.digestVerification.algorithm}`);
    lines.push(`Valid: ${report.digestVerification.isValid ? "✓ YES" : "✗ NO"}`);
    lines.push(`Message: ${report.digestVerification.message}`);
    lines.push("");
  }

  // Action hash check
  if (report.actionHashCheck) {
    lines.push("--- ACTION HASH REPRODUCIBILITY ---");
    lines.push(
      `Reproducible: ${report.actionHashCheck.isReproducible ? "✓ YES" : "✗ NO"}`
    );
    lines.push(`Message: ${report.actionHashCheck.message}`);
    lines.push("");
  }

  // Expiration check
  lines.push("--- EXPIRATION CHECK ---");
  lines.push(`Expired: ${report.expirationCheck.isExpired ? "✗ YES" : "✓ NO"}`);
  lines.push(`Expires At: ${report.expirationCheck.expiresAt}`);
  if (report.expirationCheck.serverNow) {
    lines.push(`Server Time: ${report.expirationCheck.serverNow}`);
  }
  lines.push("");

  // Replay detection
  lines.push("--- REPLAY DETECTION ---");
  lines.push(`Risk: ${report.replayDetection.isLikelyReplay ? "✗ YES" : "✓ NO"}`);
  lines.push(`Message: ${report.replayDetection.message}`);
  if (report.replayDetection.riskFactors.length > 0) {
    lines.push("Risk Factors:");
    report.replayDetection.riskFactors.forEach((f) => lines.push(`  • ${f}`));
  }
  lines.push("");

  // Summary
  if (report.errors.length > 0) {
    lines.push("--- ERRORS ---");
    report.errors.forEach((e) => lines.push(`✗ ${e}`));
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("--- WARNINGS ---");
    report.warnings.forEach((w) => lines.push(`⚠ ${w}`));
    lines.push("");
  }

  lines.push("=".repeat(52));

  return lines.join("\n");
}
