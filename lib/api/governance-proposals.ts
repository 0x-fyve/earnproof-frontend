/**
 * Governance proposal review (#246).
 * =====================================
 *
 * Lists and inspects bounded governance PROPOSALS (distinct from contract
 * upgrade reviews in lib/api/contract-upgrades.ts and from approval-intent
 * confirmation receipts in lib/api/governance-approvals.ts, which this module
 * reuses Role/Network/ActionHash types from).
 *
 * Fail-closed contract, mirroring lib/api/contract-migration.ts:
 *   - An unsupported action version is never decoded into a diff and never
 *     offered execution controls. It stays inspectable (raw payload + hash)
 *     only.
 *   - A proposal computed for a different network than the current
 *     deployment can never be approved here, even if the shape otherwise
 *     parses.
 *   - Approval is never shown as available without passing every one of:
 *     network match, non-expired, non-cancelled, non-executed, sufficient
 *     remaining approval slots, and NOT the current user being the proposer
 *     (self-approval policy).
 *   - The canonical action hash is always preserved and shown, independent of
 *     whether the action payload itself could be decoded.
 */

import { apiClient, bearer, retryRead, retryMutation } from "./client";
import { normalizeError, type NormalizedError } from "./error-normalization";
import type {
  GovernanceApprovalRole,
  GovernanceNetwork,
  ActionHash,
} from "./governance-approvals";

export const GOVERNANCE_PROPOSAL_SCHEMA_VERSION = "1.0";

/** Versions of decodable actions this client knows how to render as a diff.
 * Anything outside this set fails closed: inspectable only, no execution. */
export const SUPPORTED_PROPOSAL_ACTION_VERSIONS = ["1", "2"] as const;
export type SupportedProposalActionVersion =
  (typeof SUPPORTED_PROPOSAL_ACTION_VERSIONS)[number];

export type GovernanceProposalLifecycleState =
  | "pending" // open, collecting approvals
  | "insufficient-approval" // voting window elapsed without quorum
  | "approved" // quorum reached, not yet executed
  | "executed" // action was carried out
  | "expired" // voting window elapsed, never had quorum, never explicitly closed
  | "cancelled"; // explicitly withdrawn before execution

export const GOVERNANCE_PROPOSAL_LIFECYCLE_STATES: GovernanceProposalLifecycleState[] =
  [
    "pending",
    "insufficient-approval",
    "approved",
    "executed",
    "expired",
    "cancelled",
  ];

/** A single recorded approval against a proposal. */
export type GovernanceProposalApproval = {
  walletAddress: string;
  role: GovernanceApprovalRole;
  approvedAt: string; // ISO 8601
  actionHash: ActionHash; // must match the proposal's own actionHash
};

/** A known, decodable governance action. Each `version` here must be present
 * in SUPPORTED_PROPOSAL_ACTION_VERSIONS and have a decode case in
 * `decodeProposalAction`. */
export type GovernanceProposalAction = {
  version: string;
  /** Raw, canonical payload exactly as returned by the server — always
   * preserved so the action hash can be independently verified even if the
   * client cannot decode `version`. */
  rawPayload: Record<string, unknown>;
};

export type GovernanceProposal = {
  id: string;
  schemaVersion: string;
  network: GovernanceNetwork;
  targetContract: string;
  proposedBy: string; // wallet address
  proposedAt: string; // ISO 8601
  votingEndsAt: string; // ISO 8601
  requiredApprovals: number;
  approvals: GovernanceProposalApproval[];
  action: GovernanceProposalAction;
  /** Canonical hash of the action payload; stable regardless of whether the
   * client can decode `action.version`. */
  actionHash: ActionHash;
  state: GovernanceProposalLifecycleState;
  executedAt?: string; // ISO 8601, only when state === "executed"
  cancelledAt?: string; // ISO 8601, only when state === "cancelled"
  /** Server-reported freshness of this projection. Absent/old data must be
   * marked stale by the UI, never shown as current on-chain truth. */
  projectedAt: string; // ISO 8601
};

export type HumanReadableDiffField = {
  label: string;
  before: string | null;
  after: string | null;
};

/** A decoded, human-readable diff for a known action version. `null` means
 * the action version is unsupported and must fail closed (no diff shown). */
export type DecodedProposalAction = {
  summary: string;
  fields: HumanReadableDiffField[];
};

/** Decodes a known action version into a human-readable diff. Returns `null`
 * for any version outside SUPPORTED_PROPOSAL_ACTION_VERSIONS — callers must
 * treat `null` as "fail closed: show raw payload + hash only, no execution
 * controls," never retry decoding with partial/best-effort logic. */
export function decodeProposalAction(
  action: GovernanceProposalAction,
): DecodedProposalAction | null {
  if (!isSupportedProposalActionVersion(action.version)) {
    return null;
  }

  const payload = action.rawPayload;

  switch (action.version) {
    case "1": {
      // v1: simple parameter-update action { parameter: string, from, to }
      const parameter = typeof payload.parameter === "string" ? payload.parameter : "unknown parameter";
      const from = payload.from == null ? null : String(payload.from);
      const to = payload.to == null ? null : String(payload.to);
      return {
        summary: `Update ${parameter}`,
        fields: [{ label: parameter, before: from, after: to }],
      };
    }
    case "2": {
      // v2: multi-field role-grant action { role: string, grantee: string, previousGrantee?: string }
      const role = typeof payload.role === "string" ? payload.role : "unknown role";
      const grantee = typeof payload.grantee === "string" ? payload.grantee : null;
      const previousGrantee =
        typeof payload.previousGrantee === "string" ? payload.previousGrantee : null;
      return {
        summary: `Grant role "${role}"`,
        fields: [{ label: "Grantee", before: previousGrantee, after: grantee }],
      };
    }
    default:
      return null;
  }
}

export function isSupportedProposalActionVersion(
  version: string,
): version is SupportedProposalActionVersion {
  return (SUPPORTED_PROPOSAL_ACTION_VERSIONS as readonly string[]).includes(version);
}

/** Validates that a value is a well-formed GovernanceProposal this client
 * understands structurally (not whether it is safe to approve — see
 * `evaluateProposalApprovability` for that). */
export function isGovernanceProposal(value: unknown): value is GovernanceProposal {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.schemaVersion === "string" &&
    typeof obj.network === "string" &&
    typeof obj.targetContract === "string" &&
    typeof obj.proposedBy === "string" &&
    typeof obj.proposedAt === "string" &&
    typeof obj.votingEndsAt === "string" &&
    typeof obj.requiredApprovals === "number" &&
    Array.isArray(obj.approvals) &&
    typeof obj.action === "object" &&
    obj.action !== null &&
    typeof obj.actionHash === "string" &&
    typeof obj.state === "string" &&
    GOVERNANCE_PROPOSAL_LIFECYCLE_STATES.includes(
      obj.state as GovernanceProposalLifecycleState,
    ) &&
    typeof obj.projectedAt === "string"
  );
}

/** A proposal's action hash must match every recorded approval's own
 * actionHash. A mismatch means the proposal payload was tampered with (or
 * corrupted) after approvals were recorded, and the proposal must be treated
 * as untrustworthy for approval purposes — inspectable, never approvable. */
export function hasConsistentActionHash(proposal: GovernanceProposal): boolean {
  return proposal.approvals.every(
    (approval) => approval.actionHash === proposal.actionHash,
  );
}

/** Whether `proposal.network` matches the network this deployment is
 * running against. A mismatch must always fail closed for approval. */
export function isProposalForNetwork(
  proposal: GovernanceProposal,
  currentNetwork: GovernanceNetwork,
): boolean {
  return proposal.network === currentNetwork;
}

/** True once `votingEndsAt` has passed, independent of `state` — some
 * backends may be slow to transition `pending` -> `expired`/`insufficient-
 * approval`, so the client must not rely solely on `state` to detect this. */
export function isProposalVotingWindowElapsed(
  proposal: GovernanceProposal,
  now: Date = new Date(),
): boolean {
  return now >= new Date(proposal.votingEndsAt);
}

/** True when the server-reported projection is older than `maxAgeMs`. Stale
 * projections must be visibly marked and never treated as current on-chain
 * state for approval decisions. */
export function isProjectionStale(
  proposal: GovernanceProposal,
  maxAgeMs: number,
  now: Date = new Date(),
): boolean {
  const projectedAt = new Date(proposal.projectedAt);
  if (Number.isNaN(projectedAt.getTime())) {
    // Unparsable timestamp: fail closed, treat as stale.
    return true;
  }
  const age = now.getTime() - projectedAt.getTime();
  return age > maxAgeMs;
}

export const DEFAULT_PROJECTION_STALE_MS = 2 * 60 * 1000; // 2 minutes

/** A terminal/closed lifecycle state: no further approvals or execution can
 * occur once a proposal reaches one of these. */
export function isProposalTerminal(
  state: GovernanceProposalLifecycleState,
): boolean {
  return (
    state === "executed" ||
    state === "cancelled" ||
    state === "expired" ||
    state === "insufficient-approval"
  );
}

export type ProposalApprovalDenialReason =
  | "unsupported-action-version"
  | "network-mismatch"
  | "tampered-action-hash"
  | "voting-window-elapsed"
  | "proposal-terminal"
  | "already-approved"
  | "self-approval"
  | "insufficient-remaining-slots"
  | "stale-projection";

export type ProposalApprovabilityResult = {
  canApprove: boolean;
  /** All reasons approval is blocked (empty when canApprove is true). A
   * proposal can be blocked by more than one reason simultaneously. */
  reasons: ProposalApprovalDenialReason[];
};

/**
 * The single source of truth for whether the "approve" control may be shown
 * for a proposal. Mirrors `canApproveReview`/`canPerform` in
 * contract-upgrades.ts / contract-migration.ts: every check fails closed.
 */
export function evaluateProposalApprovability(
  proposal: GovernanceProposal,
  params: {
    currentNetwork: GovernanceNetwork;
    currentWalletAddress: string;
    staleProjectionMaxAgeMs?: number;
    now?: Date;
  },
): ProposalApprovabilityResult {
  const now = params.now ?? new Date();
  const staleMs = params.staleProjectionMaxAgeMs ?? DEFAULT_PROJECTION_STALE_MS;
  const reasons: ProposalApprovalDenialReason[] = [];

  if (!isSupportedProposalActionVersion(proposal.action.version)) {
    reasons.push("unsupported-action-version");
  }
  if (!isProposalForNetwork(proposal, params.currentNetwork)) {
    reasons.push("network-mismatch");
  }
  if (!hasConsistentActionHash(proposal)) {
    reasons.push("tampered-action-hash");
  }
  if (isProposalTerminal(proposal.state)) {
    reasons.push("proposal-terminal");
  }
  if (isProposalVotingWindowElapsed(proposal, now)) {
    reasons.push("voting-window-elapsed");
  }
  if (isProjectionStale(proposal, staleMs, now)) {
    reasons.push("stale-projection");
  }

  const normalizedCurrent = params.currentWalletAddress.toLowerCase();
  const isProposer = proposal.proposedBy.toLowerCase() === normalizedCurrent;
  if (isProposer) {
    // Self-approval policy: a user can never approve their own proposal,
    // regardless of role or any other state.
    reasons.push("self-approval");
  }

  const alreadyApproved = proposal.approvals.some(
    (approval) => approval.walletAddress.toLowerCase() === normalizedCurrent,
  );
  if (alreadyApproved) {
    reasons.push("already-approved");
  }

  const remainingSlots = proposal.requiredApprovals - proposal.approvals.length;
  if (remainingSlots <= 0) {
    reasons.push("insufficient-remaining-slots");
  }

  return { canApprove: reasons.length === 0, reasons };
}

const DENIAL_REASON_COPY: Record<ProposalApprovalDenialReason, string> = {
  "unsupported-action-version":
    "This proposal uses an action format this app does not recognize. It can be inspected, but not approved here.",
  "network-mismatch":
    "This proposal was computed for a different network than the one you are connected to.",
  "tampered-action-hash":
    "One or more recorded approvals do not match this proposal's action hash. This proposal cannot be trusted for approval.",
  "voting-window-elapsed": "The voting window for this proposal has ended.",
  "proposal-terminal": "This proposal is already closed (executed, cancelled, or expired).",
  "already-approved": "You have already approved this proposal.",
  "self-approval": "You cannot approve a proposal you proposed.",
  "insufficient-remaining-slots": "This proposal already has no remaining approval slots.",
  "stale-projection":
    "This proposal's data may be out of date. Refresh before approving.",
};

/** Human-readable text for the first (most actionable) denial reason, or
 * `null` when approval is allowed. Mirrors `getApprovalDisabledReason`. */
export function getProposalApprovalDisabledReason(
  result: ProposalApprovabilityResult,
): string | null {
  if (result.canApprove) return null;
  const [first] = result.reasons;
  return first ? DENIAL_REASON_COPY[first] : null;
}

export function proposalApprovalDenialCopy(
  reason: ProposalApprovalDenialReason,
): string {
  return DENIAL_REASON_COPY[reason];
}

/** Display-only derived lifecycle label, distinguishing the common confusion
 * between "expired" (never reached quorum) and "insufficient-approval"
 * (voting closed without quorum reached) from "cancelled"/"executed". */
export function proposalLifecycleLabel(
  state: GovernanceProposalLifecycleState,
): string {
  switch (state) {
    case "pending":
      return "Pending approval";
    case "insufficient-approval":
      return "Insufficient approval";
    case "approved":
      return "Approved";
    case "executed":
      return "Executed";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
  }
}

/* -------------------------------------------------------------------------
 * Network fetch layer
 * ---------------------------------------------------------------------- */

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: NormalizedError };

export type GovernanceProposalApprovalRequest = {
  role: GovernanceApprovalRole;
};

/** Lists bounded governance proposals (defaults to open/pending ones). */
export async function getGovernanceProposals(
  token: string,
  signal: AbortSignal,
): Promise<GovernanceProposal[]> {
  return retryRead(async (signal) => {
    return apiClient<GovernanceProposal[]>({
      path: "/governance/proposals",
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/** Fetches a single proposal for the inspect/detail view. */
export async function getGovernanceProposal(
  token: string,
  proposalId: string,
  signal: AbortSignal,
): Promise<GovernanceProposal> {
  return retryRead(async (signal) => {
    return apiClient<GovernanceProposal>({
      path: `/governance/proposals/${proposalId}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/** Submits an approval for a proposal. Callers MUST have already checked
 * `evaluateProposalApprovability(...).canApprove` and obtained a fresh
 * recent-auth confirmation (see lib/auth/recent-auth.ts) before calling this
 * — this function performs the network request only, it is not itself a
 * policy gate. */
export async function approveGovernanceProposal(
  token: string,
  proposalId: string,
  request: GovernanceProposalApprovalRequest,
  signal: AbortSignal,
): Promise<GovernanceProposal> {
  return retryMutation(async (signal) => {
    return apiClient<GovernanceProposal>({
      path: `/governance/proposals/${proposalId}/approve`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

/** Safe wrapper matching the ApiResult pattern used by contract-upgrades.ts. */
export async function approveGovernanceProposalSafe(
  token: string,
  proposalId: string,
  request: GovernanceProposalApprovalRequest,
  signal: AbortSignal,
): Promise<ApiResult<GovernanceProposal>> {
  try {
    const data = await approveGovernanceProposal(token, proposalId, request, signal);
    return { success: true, data };
  } catch (error) {
    const normalizedError = await normalizeError(error);
    return { success: false, error: normalizedError };
  }
}
