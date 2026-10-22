/**
 * Synthetic live verification refresh fixtures (#268). Proof ids are fake
 * and no credential, claim value or proof body is represented.
 */

import type { LiveVerificationRefreshResponse, VerificationEvidence } from "@/lib/api/live-verification-refresh";

export const SYNTHETIC_PROOF_ID = "proof-synthetic-0001";
export const OTHER_SYNTHETIC_PROOF_ID = "proof-synthetic-0002";

/** 2026-01-01T00:00:00.000Z */
export const BASE_TIME = Date.UTC(2026, 0, 1);
export const FIVE_MINUTES_MS = 5 * 60_000;

export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

export function makeEvidence(overrides: Partial<VerificationEvidence> = {}): VerificationEvidence {
  return {
    proofId: SYNTHETIC_PROOF_ID,
    source: "cached_indexer",
    observedAt: isoAt(BASE_TIME - 10 * 60_000),
    result: "VALID",
    ...overrides,
  };
}

export function makeRefreshResponse(overrides: Partial<LiveVerificationRefreshResponse> = {}): LiveVerificationRefreshResponse {
  return {
    schemaVersion: 1,
    proofId: SYNTHETIC_PROOF_ID,
    source: "live_contract",
    observedAt: isoAt(BASE_TIME),
    result: "VALID",
    ...overrides,
  };
}
