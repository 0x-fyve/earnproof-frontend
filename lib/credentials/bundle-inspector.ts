/**
 * Verification evidence bundle inspector (#242).
 *
 * Builds on the existing offline-bundle verification logic
 * (`lib/credentials/offline-bundle.ts`'s `verifyOfflineBundle`) and digest
 * verification (`lib/credentials/verify-digest.ts`) rather than inventing a
 * new cryptographic check: a bundle inspector's job is to render an
 * existing bundle's manifest honestly and decide, from the already-trusted
 * verification result, whether download should be allowed.
 *
 * The hard requirement from the issue's acceptance criteria is: "a failed
 * integrity check blocks trusted download and cannot be dismissed as
 * valid." `canDownloadBundle` is the single gate every download control in
 * this feature must consult - there is deliberately no second path (no
 * "show a warning but leave download enabled" option) through this module.
 *
 * Deferred for this slice (disclosed in the PR): a full UI for comparing
 * contract references against a live network registry, and a dedicated
 * route under `app/verify` wiring this to a real bundle-fetch endpoint
 * (no such endpoint exists in the OpenAPI spec yet; this assumes a bundle
 * shaped like the existing `OfflineVerificationBundle`/
 * `OfflineVerificationResult` types, which is the closest existing
 * comparable shape). The manifest rendering, evidence-state labeling, and
 * the download gate are the security-sensitive core and are fully
 * implemented and tested here.
 */

import {
  verifyOfflineBundle,
  type OfflineVerificationBundle,
  type OfflineVerificationResult,
  type OfflineVerificationStatus,
} from "./offline-bundle";

/**
 * The evidence states this inspector must clearly label, per the issue's
 * scope ("unavailable, stale, mismatched-network, and partially-verified
 * evidence"). Mapped from `OfflineVerificationStatus` plus two states that
 * status alone cannot express: a stale-but-otherwise-verified bundle (not
 * expired, just old enough that `refreshOfflineBundle` hasn't been run
 * recently) and a network mismatch (the bundle's `network` doesn't match
 * the verifier's expected network - a testnet bundle inspected as if it
 * were mainnet evidence, for example).
 */
export type EvidenceState =
  | "verified"
  | "unavailable"
  | "stale"
  | "mismatched-network"
  | "partially-verified"
  | "tampered"
  | "expired"
  | "unsupported-version";

export type BundleManifest = {
  bundleId: string;
  schemaVersion: number;
  createdAt: string;
  validUntil: string;
  network: string;
  contractId: string;
  scopes: readonly string[];
  digestAlgorithm: string;
  digestValue: string;
};

export function buildManifest(bundle: OfflineVerificationBundle): BundleManifest {
  return {
    bundleId: bundle.bundleId,
    schemaVersion: bundle.schemaVersion,
    createdAt: bundle.createdAt,
    validUntil: bundle.validUntil,
    network: bundle.network,
    contractId: bundle.contractId,
    scopes: bundle.scopes,
    digestAlgorithm: bundle.digest.algorithm,
    digestValue: bundle.digest.value,
  };
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isStaleBundle(bundle: OfflineVerificationBundle, now: Date): boolean {
  return now.getTime() - new Date(bundle.createdAt).getTime() > STALE_THRESHOLD_MS;
}

const STATUS_TO_STATE: Record<OfflineVerificationStatus, EvidenceState> = {
  "verified-offline": "verified",
  expired: "expired",
  "integrity-failed": "tampered",
  replayed: "partially-verified",
  "unsupported-schema": "unsupported-version",
};

export type BundleInspectionResult = {
  manifest: BundleManifest;
  state: EvidenceState;
  verification: OfflineVerificationResult;
  message: string;
};

/**
 * Inspects a bundle: verifies its integrity using the existing offline
 * verification logic, then layers on the network-match and staleness
 * checks that are specific to an inspector view (as opposed to a plain
 * pass/fail offline verifier).
 *
 * Check order is deterministic and matches a fail-closed precedence: an
 * unsupported schema version or a failed integrity check is reported
 * before anything else, since neither leaves enough trust in the bundle to
 * make a staleness/network judgment meaningful.
 */
export function inspectBundle(args: {
  bundle: OfflineVerificationBundle;
  actualDigest: string;
  expectedNetwork?: string;
  now?: Date;
  seenNonces?: readonly string[];
}): BundleInspectionResult {
  const { bundle, actualDigest, expectedNetwork, now = new Date(), seenNonces = [] } = args;
  const manifest = buildManifest(bundle);
  const verification = verifyOfflineBundle({ bundle, actualDigest, now, seenNonces });

  if (verification.status === "unsupported-schema" || verification.status === "integrity-failed") {
    return { manifest, state: STATUS_TO_STATE[verification.status], verification, message: verification.message };
  }

  if (verification.status === "expired") {
    return { manifest, state: "expired", verification, message: verification.message };
  }

  if (expectedNetwork && bundle.network !== expectedNetwork) {
    return {
      manifest,
      state: "mismatched-network",
      verification,
      message: `This bundle was issued for "${bundle.network}", not the expected "${expectedNetwork}" network.`,
    };
  }

  if (verification.status === "replayed") {
    return { manifest, state: "partially-verified", verification, message: verification.message };
  }

  if (isStaleBundle(bundle, now)) {
    return {
      manifest,
      state: "stale",
      verification,
      message: "This bundle's integrity verified, but it was created more than 24 hours ago.",
    };
  }

  return { manifest, state: "verified", verification, message: verification.message };
}

/**
 * The single download gate. A failed integrity check, an unsupported
 * schema version, or an expired bundle must NEVER allow a trusted
 * download - these map to `tampered`/`unsupported-version`/`expired` and
 * are excluded here unconditionally. A network mismatch is also blocking:
 * downloading evidence for the wrong network as if it were trusted for
 * the expected one is exactly the kind of silent mis-trust this issue
 * guards against. `stale` and `partially-verified` (replayed in this
 * session) are allowed through but must still be visibly labeled by the
 * caller - they are not failures, just reduced-confidence states.
 */
export function canDownloadBundle(state: EvidenceState): boolean {
  return state === "verified" || state === "stale" || state === "partially-verified";
}

export function isBlockingEvidenceState(state: EvidenceState): boolean {
  return !canDownloadBundle(state);
}

const STATE_LABELS: Record<EvidenceState, string> = {
  verified: "Verified",
  unavailable: "Unavailable",
  stale: "Stale",
  "mismatched-network": "Network mismatch",
  "partially-verified": "Partially verified",
  tampered: "Integrity check failed",
  expired: "Expired",
  "unsupported-version": "Unsupported version",
};

export function formatEvidenceState(state: EvidenceState): string {
  return STATE_LABELS[state];
}

/**
 * Builds the inspection result for a bundle that could not be fetched or
 * parsed at all (e.g. the fetch failed, or the stored bytes are not valid
 * JSON) - distinct from a bundle that was fetched and failed verification.
 * There is no manifest to show in this case.
 */
export function unavailableInspectionResult(message = "This evidence bundle could not be retrieved."): {
  state: "unavailable";
  message: string;
} {
  return { state: "unavailable", message };
}
