import {
  COMMITMENT_HASH_PATTERN,
  type IssuerPolicyCommitmentHistory,
  type PolicyCommitment,
} from "@/lib/api/issuer-policy-commitments";

/**
 * Pure helpers for the issuer policy commitment history viewer (#267).
 * See docs/issuer-policy-commitments.md for the documented rules.
 *
 * Commitment hashes are opaque: these helpers only normalize case and test
 * full-length equality. Nothing decodes a hash or infers policy content.
 */

/** Roles that may view commitment history. AuthUser has no separate verifier role. */
export const POLICY_COMMITMENT_VIEWER_ROLES = ["ADMIN", "ISSUER"] as const;

export function canViewPolicyCommitmentHistory(role: string | null | undefined): boolean {
  return (POLICY_COMMITMENT_VIEWER_ROLES as readonly string[]).includes(role ?? "");
}

/** Lowercases a full-length 64-hex-char hash; anything else (wrong length, prefix, whitespace) is null. */
export function normalizeCommitmentHash(hash: string): string | null {
  return COMMITMENT_HASH_PATTERN.test(hash) ? hash.toLowerCase() : null;
}

export type HashComparison = "identical" | "different" | "invalid";

/** Exact, case-insensitive, full-length equality. Never a partial or prefix match. */
export function compareCommitmentHashes(a: string, b: string): HashComparison {
  const left = normalizeCommitmentHash(a);
  const right = normalizeCommitmentHash(b);
  if (left === null || right === null) return "invalid";
  return left === right ? "identical" : "different";
}

export function sortCommitmentsByVersion(commitments: PolicyCommitment[]): PolicyCommitment[] {
  return [...commitments].sort((a, b) => a.version - b.version);
}

export type EffectiveAtResult =
  | { status: "effective"; commitment: PolicyCommitment }
  | { status: "before_first"; firstEffectiveLedger: number }
  | { status: "empty" }
  | { status: "beyond_index"; indexedLedger: number | null }
  | { status: "invalid_ledger" };

/**
 * Which commitment is effective AT ledger `ledger`.
 *
 * Boundary rule (inclusive): a commitment whose effectiveLedger == L is
 * already effective at L, and the previous version stops applying at L.
 * Formally: the highest version with effectiveLedger <= L.
 *
 * The backend projection only knows commitments up to indexedLedger, so a
 * ledger beyond it (or any ledger when nothing is indexed) is reported as
 * "beyond_index" rather than answered from possibly stale data.
 */
export function commitmentEffectiveAt(history: IssuerPolicyCommitmentHistory, ledger: number): EffectiveAtResult {
  if (!Number.isSafeInteger(ledger) || ledger < 1) return { status: "invalid_ledger" };
  if (history.indexedLedger === null || ledger > history.indexedLedger) {
    return { status: "beyond_index", indexedLedger: history.indexedLedger };
  }
  const sorted = sortCommitmentsByVersion(history.commitments);
  if (sorted.length === 0) return { status: "empty" };

  let effective: PolicyCommitment | null = null;
  for (const commitment of sorted) {
    if (commitment.effectiveLedger <= ledger) effective = commitment;
  }
  return effective
    ? { status: "effective", commitment: effective }
    : { status: "before_first", firstEffectiveLedger: sorted[0].effectiveLedger };
}

/** The commitment effective at the indexed ledger, i.e. the latest the backend projection knows. */
export function latestIndexedCommitment(history: IssuerPolicyCommitmentHistory): PolicyCommitment | null {
  if (history.indexedLedger === null) return null;
  const result = commitmentEffectiveAt(history, history.indexedLedger);
  return result.status === "effective" ? result.commitment : null;
}

export type ReconciliationState =
  | { kind: "in_sync"; ledger: number }
  | {
      kind: "stale_projection";
      indexedLedger: number;
      latestLedger: number;
      indexedAt: string | null;
      /** Whether the last indexed hash differs from the on-chain one; null if either is unknown. */
      hashDiffers: boolean | null;
    }
  | { kind: "mismatch"; ledger: number; backendHash: string | null; onChainHash: string }
  | { kind: "pending" }
  | { kind: "unknown"; reason: "on_chain_not_read" };

/**
 * Backend metadata vs chain. Order of evaluation (first match wins):
 * 1. pending          - indexedLedger is null (nothing indexed yet).
 * 2. stale_projection - indexedLedger < latestLedger. Always reported as
 *    stale even if the hashes happen to match: a projection that is behind
 *    the chain is never presented as current.
 * 3. unknown          - caught up, but the on-chain hash was not read, so
 *    agreement cannot be confirmed (fails closed, never "in sync").
 * 4. mismatch         - caught up and the backend's latest commitment (or
 *    the absence of one) differs from the on-chain hash.
 * 5. in_sync          - caught up and the hashes are identical.
 */
export function reconcileCommitmentHistory(history: IssuerPolicyCommitmentHistory): ReconciliationState {
  if (history.indexedLedger === null) return { kind: "pending" };

  const latest = latestIndexedCommitment(history);
  const onChain = history.onChainCurrentHash;

  if (history.indexedLedger < history.latestLedger) {
    return {
      kind: "stale_projection",
      indexedLedger: history.indexedLedger,
      latestLedger: history.latestLedger,
      indexedAt: history.indexedAt,
      hashDiffers:
        latest && onChain ? compareCommitmentHashes(latest.commitmentHash, onChain) !== "identical" : null,
    };
  }

  if (onChain === null) return { kind: "unknown", reason: "on_chain_not_read" };

  if (latest && compareCommitmentHashes(latest.commitmentHash, onChain) === "identical") {
    return { kind: "in_sync", ledger: history.latestLedger };
  }
  return {
    kind: "mismatch",
    ledger: history.latestLedger,
    backendHash: latest ? latest.commitmentHash.toLowerCase() : null,
    onChainHash: onChain.toLowerCase(),
  };
}
