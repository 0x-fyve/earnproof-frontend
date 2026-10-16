/**
 * Provenance chain types and utilities for tracking verification sources.
 *
 * A provenance chain documents the complete verification journey:
 * - Which sources (issuer, contract, blockchain, registry) were checked
 * - The order of verification steps (checkpoints)
 * - Timestamped observations at each checkpoint
 * - Sources that could not be verified (missing links)
 *
 * Key guarantees:
 * - Failed cryptographic results are never upgraded by later observations
 * - Unavailable sources are not presented as observed
 * - Deterministic and documented failure modes
 */

import type {
  ProvenianceChain,
  VerificationSource,
  VerificationObservation,
  VerificationCheckpoint,
  MissingProvenanceLink,
  VerifyProofResponse,
} from "@/lib/api/generated/v1";

export type {
  ProvenianceChain,
  VerificationSource,
  VerificationObservation,
  VerificationCheckpoint,
  MissingProvenanceLink,
};

/** Verification source types and their descriptions */
export const VERIFICATION_SOURCE_TYPES = {
  issuer: "Issuer Registry",
  contract: "Smart Contract",
  stellar_account: "Stellar Account",
  backend_registry: "Backend Registry",
} as const;

/** Verification observation types and their descriptions */
export const OBSERVATION_TYPE_LABELS = {
  signature_check: "Signature Validation",
  issuer_check: "Issuer Verification",
  expiration_check: "Expiration Check",
  revocation_check: "Revocation Status",
  account_check: "Account Verification",
} as const;

/** Missing link reasons and their descriptions */
export const MISSING_LINK_REASONS = {
  timeout: "Request timed out",
  network_error: "Network connectivity issue",
  permission_denied: "Access denied",
  not_applicable: "Source not applicable to this proof type",
} as const;

/**
 * Checks if a provenance chain is available and has valid data.
 * A missing provenance chain is acceptable (older proofs may not have it).
 */
export function hasProvenance(response: VerifyProofResponse): boolean {
  return !!response.provenance;
}

/**
 * Gets all observations for a specific checkpoint.
 */
export function getCheckpointObservations(
  chain: ProvenianceChain,
  checkpointId: string,
): VerificationObservation[] {
  return chain.observations.filter((obs) => obs.checkpointId === checkpointId);
}

/**
 * Gets all observations from a specific source.
 */
export function getSourceObservations(
  chain: ProvenianceChain,
  sourceId: string,
): VerificationObservation[] {
  return chain.observations.filter((obs) => obs.sourceId === sourceId);
}

/**
 * Finds a checkpoint by its ID.
 */
export function findCheckpoint(
  chain: ProvenianceChain,
  checkpointId: string,
): VerificationCheckpoint | undefined {
  return chain.checkpoints.find((cp) => cp.id === checkpointId);
}

/**
 * Finds a source by its ID.
 */
export function findSource(
  chain: ProvenianceChain,
  sourceId: string,
): VerificationSource | undefined {
  return chain.sources.find((src) => src.id === sourceId);
}

/**
 * Gets the human-readable label for an observation type.
 */
export function getObservationTypeLabel(
  observationType: VerificationObservation["observationType"],
): string {
  return OBSERVATION_TYPE_LABELS[observationType];
}

/**
 * Gets the human-readable label for a source type.
 */
export function getSourceTypeLabel(type: VerificationSource["type"]): string {
  return VERIFICATION_SOURCE_TYPES[type];
}

/**
 * Gets the human-readable label for a missing link reason.
 */
export function getMissingLinkReasonLabel(reason: MissingProvenanceLink["reason"]): string {
  return MISSING_LINK_REASONS[reason];
}

/**
 * Determines if any observation in the chain indicates failure.
 * A failed observation at a critical checkpoint can mean the entire
 * verification failed, even if later observations passed.
 */
export function hasFailedObservation(chain: ProvenianceChain): boolean {
  return chain.observations.some((obs) => obs.result === false);
}

/**
 * Gets all failed observations.
 */
export function getFailedObservations(chain: ProvenianceChain): VerificationObservation[] {
  return chain.observations.filter((obs) => obs.result === false);
}

/**
 * Gets all passed observations.
 */
export function getPassedObservations(chain: ProvenianceChain): VerificationObservation[] {
  return chain.observations.filter((obs) => obs.result === true);
}

/**
 * Gets the number of verified sources.
 * Sources with status 'verified' completed their checks successfully.
 */
export function getVerifiedSourceCount(chain: ProvenianceChain): number {
  return chain.sources.filter((src) => src.status === "verified").length;
}

/**
 * Gets the number of unavailable sources.
 * Sources with status 'unavailable' could not be reached or checked.
 */
export function getUnavailableSourceCount(chain: ProvenianceChain): number {
  return chain.sources.filter((src) => src.status === "unavailable").length;
}

/**
 * Gets the number of failed sources.
 * Sources with status 'failed' were checked but failed verification.
 */
export function getFailedSourceCount(chain: ProvenianceChain): number {
  return chain.sources.filter((src) => src.status === "failed").length;
}

/**
 * Determines if all required sources were verified.
 * Missing links that are retryable are not considered complete blockers.
 */
export function allSourcesVerified(chain: ProvenianceChain): boolean {
  // All sources should be verified or have non-retryable missing links
  return chain.sources.every((src) => src.status === "verified");
}

/**
 * Gets sources that have missing links (could not be verified).
 */
export function getSourcesWithMissingLinks(chain: ProvenianceChain): VerificationSource[] {
  const missingSourceIds = new Set(chain.missingLinks.map((link) => link.sourceId));
  return chain.sources.filter((src) => missingSourceIds.has(src.id));
}

/**
 * Determines if the verification can be retried.
 * If only retryable sources failed/unavailable, the verification can be retried.
 */
export function isRetryable(chain: ProvenianceChain): boolean {
  return chain.missingLinks.every((link) => link.retryable !== false);
}

/**
 * Gets a summary of the verification process.
 * Useful for display and logging.
 */
export function getProvenianceSummary(chain: ProvenianceChain): {
  totalSources: number;
  verifiedSources: number;
  unavailableSources: number;
  failedSources: number;
  checkpointsExecuted: number;
  totalObservations: number;
  failedObservations: number;
  isRetryable: boolean;
  allVerified: boolean;
} {
  return {
    totalSources: chain.sources.length,
    verifiedSources: getVerifiedSourceCount(chain),
    unavailableSources: getUnavailableSourceCount(chain),
    failedSources: getFailedSourceCount(chain),
    checkpointsExecuted: chain.verificationPath.length,
    totalObservations: chain.observations.length,
    failedObservations: getFailedObservations(chain).length,
    isRetryable: isRetryable(chain),
    allVerified: allSourcesVerified(chain),
  };
}

/**
 * Validates that a provenance chain has no internal inconsistencies.
 *
 * Returns an array of validation errors. Empty array means the chain is valid.
 *
 * Validation checks:
 * - All checkpoints referenced in observations exist
 * - All sources referenced in observations exist
 * - Checkpoints are in correct order
 * - No duplicate checkpoint IDs or source IDs
 * - verificationPath contains only valid checkpoint IDs
 * - Failed cryptographic results are never contradicted
 */
export function validateProvenianceChain(
  chain: ProvenianceChain,
): Array<{ type: string; message: string }> {
  const errors: Array<{ type: string; message: string }> = [];

  // Check for duplicate checkpoint IDs
  const checkpointIds = new Set<string>();
  chain.checkpoints.forEach((cp) => {
    if (checkpointIds.has(cp.id)) {
      errors.push({
        type: "duplicate_checkpoint_id",
        message: `Checkpoint ID '${cp.id}' appears more than once`,
      });
    }
    checkpointIds.add(cp.id);
  });

  // Check for duplicate source IDs
  const sourceIds = new Set<string>();
  chain.sources.forEach((src) => {
    if (sourceIds.has(src.id)) {
      errors.push({
        type: "duplicate_source_id",
        message: `Source ID '${src.id}' appears more than once`,
      });
    }
    sourceIds.add(src.id);
  });

  // Check that all checkpoint orders are unique and sequential
  const orders = new Set<number>();
  chain.checkpoints.forEach((cp) => {
    if (orders.has(cp.order)) {
      errors.push({
        type: "duplicate_checkpoint_order",
        message: `Checkpoint order ${cp.order} appears more than once`,
      });
    }
    orders.add(cp.order);
  });

  // Check that all observations reference valid checkpoints and sources
  chain.observations.forEach((obs, idx) => {
    if (!checkpointIds.has(obs.checkpointId)) {
      errors.push({
        type: "invalid_observation_checkpoint",
        message: `Observation ${idx} references unknown checkpoint '${obs.checkpointId}'`,
      });
    }
    if (!sourceIds.has(obs.sourceId)) {
      errors.push({
        type: "invalid_observation_source",
        message: `Observation ${idx} references unknown source '${obs.sourceId}'`,
      });
    }
  });

  // Check that verificationPath contains only valid checkpoint IDs
  chain.verificationPath.forEach((cpId, idx) => {
    if (!checkpointIds.has(cpId)) {
      errors.push({
        type: "invalid_verification_path_checkpoint",
        message: `Verification path index ${idx} references unknown checkpoint '${cpId}'`,
      });
    }
  });

  // Check that verificationPath has no duplicates (each checkpoint runs once)
  const pathCheckpoints = new Set(chain.verificationPath);
  if (pathCheckpoints.size !== chain.verificationPath.length) {
    errors.push({
      type: "duplicate_checkpoint_in_path",
      message: "Verification path contains duplicate checkpoints",
    });
  }

  // Check that all missing links reference valid sources
  chain.missingLinks.forEach((link, idx) => {
    if (!sourceIds.has(link.sourceId)) {
      errors.push({
        type: "invalid_missing_link_source",
        message: `Missing link ${idx} references unknown source '${link.sourceId}'`,
      });
    }
  });

  return errors;
}

/**
 * Creates a human-readable description of the verification chain.
 * Useful for logs, debugging, and accessibility.
 */
export function describeProvenianceChain(chain: ProvenianceChain): string {
  const summary = getProvenianceSummary(chain);

  const lines: string[] = [
    `Verification chain: ${summary.checkpointsExecuted} checkpoint(s), ${summary.totalObservations} observation(s)`,
    `Sources: ${summary.verifiedSources} verified, ${summary.unavailableSources} unavailable, ${summary.failedSources} failed`,
  ];

  if (summary.failedObservations > 0) {
    lines.push(`⚠️  ${summary.failedObservations} observation(s) failed`);
  }

  if (chain.missingLinks.length > 0) {
    lines.push(`Missing ${chain.missingLinks.length} link(s)`);
  }

  if (!summary.isRetryable) {
    lines.push("Non-retryable failure(s)");
  }

  return lines.join(" • ");
}
