/**
 * Governance Approval Intent Confirmation Receipts
 * 
 * Delivers immutable, server-confirmed summaries of governance approval intents.
 * Never claims execution; records intent only from server-confirmed data.
 * Supports v1 versioning for future schema evolution.
 */

/** Versioning for governance approval data structures.
 * Used to determine compatibility and feature availability.
 */
export const GOVERNANCE_APPROVALS_SCHEMA_VERSION = "1.0";

/** Canonical role types for governance approvals.
 * Defines authorization boundaries for approval actions. */
export type GovernanceApprovalRole =
  | "PROPOSER"
  | "VOTER"
  | "TREASURER"
  | "DELEGATE"
  | "OBSERVER"
  | "CUSTODIAN";

/** Governance approval intent states.
 * Reflects the progression from signing intent to server confirmation. */
export type GovernanceApprovalIntentState =
  | "intent_signed" // Client-side signature created, awaiting server submission
  | "submitted" // Server received the submission
  | "confirmed" // Server confirmed and indexed the approval intent
  | "failed" // Server rejected or could not process
  | "superseded" // Replaced by a later approval intent
  | "cancelled"; // Explicitly revoked by user before confirmation

/** Network identifiers for governance approvals.
 * Ensures reproducibility and prevents cross-network replay. */
export type GovernanceNetwork =
  | "stellar:mainnet"
  | "stellar:testnet"
  | "stellar:soroban-mainnet"
  | "stellar:soroban-testnet"
  | "ethereum:mainnet"
  | "ethereum:sepolia";

/** Canonical action hashes generated from governance operations.
 * Computed deterministically from (target, proposal, role, nonce).
 * Immutable once confirmed by server.
 */
export type ActionHash = string & { readonly __brand: "ActionHash" };

/** Distinguishes execution vs. intent.
 * A receipt always records "intent" — never claims the action was executed.
 */
export type GovernanceApprovalIntentType = "intent";

/** Server-provided integrity metadata for approval receipts.
 * Optional: enables future digest verification patterns (cf. issue #192).
 */
export type GovernanceApprovalDigestMetadata = {
  algorithm: string; // e.g., "SHA256"
  value: string; // hex-encoded digest
};

/** Immutable confirmation receipt from server for an approval intent.
 * ONLY fields present in this record came from the server and can be trusted.
 * Client-side state (like signature) is NOT included.
 */
export type GovernanceApprovalIntentConfirmation = {
  /** Globally unique identifier for this approval intent. */
  id: string;

  /** Semantic type: always "intent" for this schema version. */
  intentType: GovernanceApprovalIntentType;

  /** Schema version for forward/backward compatibility. */
  schemaVersion: string; // e.g., "1.0"

  /** Canonical action hash derived from (target, proposal, role, nonce).
   * Deterministic and immutable post-confirmation.
   */
  actionHash: ActionHash;

  /** Network where this approval intent applies.
   * Prevents accidental cross-network replays.
   */
  network: GovernanceNetwork;

  /** Target contract address or identifier.
   * E.g., Stellar contract ID, Ethereum address.
   */
  targetContract: string;

  /** Proposal identifier on-chain.
   * Matches the governance system's proposal numbering.
   */
  proposalId: string;

  /** Approval role (permission type).
   * Defines what authorization was granted.
   */
  approvalRole: GovernanceApprovalRole;

  /** Wallet address that signed the approval.
   * Immutable; determines which keys can authorize actions derived from this receipt.
   */
  walletAddress: string;

  /** Approval intent state at confirmation time. */
  state: GovernanceApprovalIntentState;

  /** ISO 8601 timestamp when the server confirmed this intent.
   * Not the client time when the user signed; server time.
   */
  confirmedAt: string; // ISO 8601

  /** Expiration deadline for this approval intent.
   * After this time, the intent is no longer valid; server will reject executions.
   */
  expiresAt: string; // ISO 8601

  /** Optional server-provided integrity metadata.
   * Enables future digest verification (cf. credentials/verify-digest.ts).
   */
  digest?: GovernanceApprovalDigestMetadata;

  /** Additional metadata (e.g., governance DAO name, proposal title).
   * Safe for display; non-structural.
   */
  metadata?: Record<string, string | number | boolean | null>;
};

/** Determinism test input for action hash computation.
 * Ensures reproducibility and prevents collisions.
 */
export type ActionHashInput = {
  targetContract: string;
  proposalId: string;
  approvalRole: GovernanceApprovalRole;
  walletAddress: string;
  nonce: string | number;
};

/** Validation result for an approval intent confirmation.
 * Provides structured feedback on confirmation state and authority.
 */
export type GovernanceApprovalValidationResult = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  reason?: string;
};

/** Authorization check for displaying or exporting a receipt.
 * Ensures only authorized parties can view sensitive receipt data.
 */
export type GovernanceApprovalAuthorizationCheck = {
  canView: boolean;
  canExport: boolean;
  canSign: boolean;
  denialReason?: string;
};

/** Public fields safe for export/display.
 * Matches the pattern used in lib/credentials/export.ts.
 */
export const PUBLIC_GOVERNANCE_APPROVAL_FIELDS = [
  "id",
  "intentType",
  "schemaVersion",
  "actionHash",
  "network",
  "targetContract",
  "proposalId",
  "approvalRole",
  "walletAddress",
  "state",
  "confirmedAt",
  "expiresAt",
  "metadata",
] as const;

/** Type guard for confirmation objects.
 * Ensures object matches the expected schema.
 */
export function isGovernanceApprovalIntentConfirmation(
  value: unknown
): value is GovernanceApprovalIntentConfirmation {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    obj.intentType === "intent" &&
    typeof obj.schemaVersion === "string" &&
    typeof obj.actionHash === "string" &&
    typeof obj.network === "string" &&
    typeof obj.targetContract === "string" &&
    typeof obj.proposalId === "string" &&
    typeof obj.approvalRole === "string" &&
    typeof obj.walletAddress === "string" &&
    typeof obj.state === "string" &&
    typeof obj.confirmedAt === "string" &&
    typeof obj.expiresAt === "string"
  );
}

/** Validates that a confirmation has not expired.
 * Compares expiresAt against server time (not client time).
 */
export function isGovernanceApprovalIntentExpired(
  confirmation: GovernanceApprovalIntentConfirmation,
  serverNow: Date = new Date()
): boolean {
  const expiresAtDate = new Date(confirmation.expiresAt);
  return serverNow >= expiresAtDate;
}

/** Validates confirmation state consistency.
 * Ensures state transitions are valid and data is internally consistent.
 */
export function validateGovernanceApprovalConfirmation(
  confirmation: unknown
): GovernanceApprovalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isGovernanceApprovalIntentConfirmation(confirmation)) {
    errors.push("Invalid governance approval confirmation structure.");
    return { isValid: false, errors, warnings };
  }

  const conf = confirmation;

  // Schema version compatibility
  if (conf.schemaVersion !== GOVERNANCE_APPROVALS_SCHEMA_VERSION) {
    warnings.push(
      `Schema version mismatch: expected "${GOVERNANCE_APPROVALS_SCHEMA_VERSION}", got "${conf.schemaVersion}". ` +
      "Receipt may use newer or incompatible format."
    );
  }

  // Validate intentType is always "intent"
  if (conf.intentType !== "intent") {
    errors.push(
      `Invalid intentType: "${conf.intentType}". Must be "intent". ` +
      "This receipt does not claim execution."
    );
  }

  // Validate state is a known value
  const validStates: GovernanceApprovalIntentState[] = [
    "intent_signed",
    "submitted",
    "confirmed",
    "failed",
    "superseded",
    "cancelled",
  ];
  if (!validStates.includes(conf.state)) {
    errors.push(
      `Unknown approval state: "${conf.state}". ` +
      `Valid states are: ${validStates.join(", ")}.`
    );
  }

  // Validate network is a known value
  const validNetworks: GovernanceNetwork[] = [
    "stellar:mainnet",
    "stellar:testnet",
    "stellar:soroban-mainnet",
    "stellar:soroban-testnet",
    "ethereum:mainnet",
    "ethereum:sepolia",
  ];
  if (!validNetworks.includes(conf.network)) {
    warnings.push(
      `Unknown network: "${conf.network}". ` +
      `Known networks are: ${validNetworks.join(", ")}.`
    );
  }

  // Validate approvalRole is a known value
  const validRoles: GovernanceApprovalRole[] = [
    "PROPOSER",
    "VOTER",
    "TREASURER",
    "DELEGATE",
    "OBSERVER",
    "CUSTODIAN",
  ];
  if (!validRoles.includes(conf.approvalRole)) {
    warnings.push(
      `Unknown approval role: "${conf.approvalRole}". ` +
      `Known roles are: ${validRoles.join(", ")}.`
    );
  }

  // Validate timestamps
  try {
    const confirmedDate = new Date(conf.confirmedAt);
    const expiresDate = new Date(conf.expiresAt);
    if (isNaN(confirmedDate.getTime())) {
      errors.push(`Invalid confirmedAt timestamp: "${conf.confirmedAt}".`);
    }
    if (isNaN(expiresDate.getTime())) {
      errors.push(`Invalid expiresAt timestamp: "${conf.expiresAt}".`);
    }
    if (confirmedDate > expiresDate) {
      errors.push(
        `confirmedAt (${conf.confirmedAt}) must not be after expiresAt (${conf.expiresAt}).`
      );
    }
  } catch {
    errors.push("Timestamp parsing failed.");
  }

  // Validate addresses/hashes are non-empty
  if (conf.walletAddress.trim().length === 0) {
    errors.push("walletAddress must not be empty.");
  }
  if (conf.targetContract.trim().length === 0) {
    errors.push("targetContract must not be empty.");
  }
  if (conf.actionHash.trim().length === 0) {
    errors.push("actionHash must not be empty.");
  }

  const isValid = errors.length === 0;
  return { isValid, errors, warnings };
}

/** Checks authorization to view/export/sign with an approval receipt.
 * Used before rendering or allowing download.
 */
export function checkGovernanceApprovalAuthorization(
  confirmation: GovernanceApprovalIntentConfirmation,
  currentWalletAddress: string
): GovernanceApprovalAuthorizationCheck {
  // Only the signer can view the receipt
  const addressMatches = currentWalletAddress.toLowerCase() === 
    confirmation.walletAddress.toLowerCase();

  if (!addressMatches) {
    return {
      canView: false,
      canExport: false,
      canSign: false,
      denialReason: "Only the approver can view this receipt.",
    };
  }

  // Check expiration
  const isExpired = isGovernanceApprovalIntentExpired(confirmation);
  if (isExpired) {
    return {
      canView: true,
      canExport: true,
      canSign: false,
      denialReason: "Approval intent has expired.",
    };
  }

  // Expired or cancelled intents cannot be signed on
  const canSign = confirmation.state === "confirmed";

  return {
    canView: true,
    canExport: true,
    canSign,
  };
}
