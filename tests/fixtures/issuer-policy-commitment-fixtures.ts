/**
 * Synthetic issuer policy commitment fixtures (#267). Hashes are repeated
 * byte patterns (valid 64-hex-char format, obviously not real commitments);
 * ids and proof references are fake. No policy content, proof bodies or
 * claim values are represented anywhere.
 */

import type { IssuerPolicyCommitmentHistory, PolicyCommitment } from "@/lib/api/issuer-policy-commitments";

export const SYNTHETIC_ISSUER_ID = "issuer-synthetic-0001";
export const OTHER_SYNTHETIC_ISSUER_ID = "issuer-synthetic-0002";

export const HASH_V1 = "11".repeat(32);
export const HASH_V2 = "22".repeat(32);
export const HASH_V3 = "ab".repeat(32);
export const HASH_V3_UPPER = HASH_V3.toUpperCase();

export function makeCommitment(overrides: Partial<PolicyCommitment> = {}): PolicyCommitment {
  return {
    version: 1,
    commitmentHash: HASH_V1,
    effectiveLedger: 1_000,
    recordedAt: "2026-01-01T00:00:00.000Z",
    relatedProofCount: 0,
    relatedProofIds: [],
    ...overrides,
  };
}

/** Three versions effective at ledgers 1000, 2000, 3000; index caught up and in sync at 3500. */
export function makeHistory(overrides: Partial<IssuerPolicyCommitmentHistory> = {}): IssuerPolicyCommitmentHistory {
  return {
    schemaVersion: 1,
    issuerId: SYNTHETIC_ISSUER_ID,
    latestLedger: 3_500,
    indexedLedger: 3_500,
    indexedAt: "2026-01-03T00:00:00.000Z",
    onChainCurrentHash: HASH_V3,
    commitments: [
      makeCommitment({ version: 1, commitmentHash: HASH_V1, effectiveLedger: 1_000, relatedProofCount: 2, relatedProofIds: ["proof-synthetic-0001", "proof-synthetic-0002"] }),
      makeCommitment({ version: 2, commitmentHash: HASH_V2, effectiveLedger: 2_000, recordedAt: "2026-01-02T00:00:00.000Z", relatedProofCount: 45, relatedProofIds: ["proof-synthetic-0003"] }),
      makeCommitment({ version: 3, commitmentHash: HASH_V3, effectiveLedger: 3_000, recordedAt: "2026-01-03T00:00:00.000Z" }),
    ],
    ...overrides,
  };
}
