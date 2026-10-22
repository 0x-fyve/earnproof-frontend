import type { VerifyProofResponse } from "./generated/v1";
import { ApiError } from "@/lib/errors";

/**
 * Live verification refresh with source selection - PROPOSED contract (#268).
 *
 * BACKEND GAP: the only verification endpoint is GET /proofs/{id}/verify,
 * which takes no source, refresh-mode or max-age parameter, and the API
 * exposes no verifier freshness policy. Following the repository precedent
 * for unspecced features (#242, #245), this module defines and validates
 * the shapes the UI needs, exports NO fetcher and is NOT registered in
 * client-contracts.json. The panel receives its loader, the advertised
 * sources and the policy as props. Assumed route, to be confirmed:
 * POST /proofs/{id}/verify/refresh { source }.
 *
 * Validators are hand-written (no zod): /verify has ~16 KB of bundle budget
 * headroom and zod would exceed it once this is mounted there.
 */

export const LIVE_VERIFICATION_REFRESH_SCHEMA_VERSION = 1;

/**
 * Every source this client knows how to label. The backend decides which
 * are actually supported for a deployment; anything it advertises that is
 * not listed here is shown as unknown and is not selectable.
 */
export const VERIFICATION_EVIDENCE_SOURCES = ["cached_indexer", "live_contract"] as const;
export type VerificationEvidenceSource = (typeof VERIFICATION_EVIDENCE_SOURCES)[number];

export const VERIFICATION_EVIDENCE_SOURCE_LABELS: Record<VerificationEvidenceSource, { label: string; description: string }> = {
  cached_indexer: {
    label: "Cached (indexer)",
    description: "Re-reads the backend's indexed verification. Fast, but only as fresh as the indexer.",
  },
  live_contract: {
    label: "Live contract (RPC)",
    description: "Reads proof state directly from the Soroban contract over RPC. Slower, rate-limited.",
  },
};

const VERIFICATION_RESULTS: ReadonlyArray<VerifyProofResponse["result"]> = [
  "VALID",
  "EXPIRED",
  "REVOKED",
  "INVALID_SIGNATURE",
  "UNKNOWN_PROOF",
  "UNVERIFIED_ISSUER",
];

export function isVerificationEvidenceSource(value: unknown): value is VerificationEvidenceSource {
  return typeof value === "string" && (VERIFICATION_EVIDENCE_SOURCES as readonly string[]).includes(value);
}

/** Verifier freshness policy (proposed): evidence must be younger than maxEvidenceAgeMs. */
export interface VerifierFreshnessPolicy {
  maxEvidenceAgeMs: number;
}

/** Evidence as shown in the panel, from the cache or a live refresh. */
export interface VerificationEvidence {
  proofId: string;
  source: VerificationEvidenceSource;
  /** When the source observed the proof state (ISO 8601). */
  observedAt: string;
  result: VerifyProofResponse["result"];
}

export interface LiveVerificationRefreshResponse extends VerificationEvidence {
  schemaVersion: typeof LIVE_VERIFICATION_REFRESH_SCHEMA_VERSION;
}

export type ParseLiveRefreshResult =
  | { ok: true; evidence: VerificationEvidence }
  | { ok: false; reason: "unsupported_version" | "invalid_response" | "proof_mismatch" | "source_mismatch" };

const ALLOWED_FIELDS = new Set(["schemaVersion", "proofId", "source", "observedAt", "result"]);

/**
 * Validates a refresh response against what was REQUESTED. A response for
 * another proof or another source is rejected, so a refresh result can never
 * be applied to a different proof than the one it was requested for.
 */
export function parseLiveVerificationRefresh(
  raw: unknown,
  requested: { proofId: string; source: VerificationEvidenceSource },
): ParseLiveRefreshResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "invalid_response" };
  const value = raw as Record<string, unknown>;

  if (value.schemaVersion !== LIVE_VERIFICATION_REFRESH_SCHEMA_VERSION) {
    return { ok: false, reason: "schemaVersion" in value ? "unsupported_version" : "invalid_response" };
  }
  if (Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) return { ok: false, reason: "invalid_response" };

  const { proofId, source, observedAt, result } = value;
  if (typeof proofId !== "string" || proofId.length === 0) return { ok: false, reason: "invalid_response" };
  if (!isVerificationEvidenceSource(source)) return { ok: false, reason: "invalid_response" };
  if (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt))) {
    return { ok: false, reason: "invalid_response" };
  }
  if (typeof result !== "string" || !(VERIFICATION_RESULTS as readonly string[]).includes(result)) {
    return { ok: false, reason: "invalid_response" };
  }
  if (proofId !== requested.proofId) return { ok: false, reason: "proof_mismatch" };
  if (source !== requested.source) return { ok: false, reason: "source_mismatch" };

  return {
    ok: true,
    evidence: { proofId, source, observedAt, result: result as VerifyProofResponse["result"] },
  };
}

/**
 * An HTTP failure from the refresh loader. `retryAfter` carries the raw
 * Retry-After header for 429/503 responses. lib/api/client.ts does not
 * expose response headers today, so a real loader must read it itself
 * (a backend/client gap to raise).
 */
export class LiveRefreshHttpError extends ApiError {
  public readonly retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null = null) {
    super({ status, message });
    this.name = "LiveRefreshHttpError";
    this.retryAfter = retryAfter;
  }
}

/** Loader the panel calls. Must forward `signal` (used for cancellation and the timeout). */
export type LiveVerificationRefreshLoader = (
  request: { proofId: string; source: VerificationEvidenceSource; organizationId: string | null },
  signal: AbortSignal,
) => Promise<unknown>;
