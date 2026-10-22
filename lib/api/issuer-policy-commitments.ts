import { z } from "zod";

/**
 * Issuer policy commitment history - PROPOSED contract (#267).
 *
 * BACKEND GAP: there is no policy-commitment, ledger or reconciliation
 * endpoint in lib/api/openapi/earnproof-api.v1.json (Issuer is only
 * {id, name, status, organizationId?}). Following the repository precedent
 * for unspecced features (#242, #245), this module defines the response
 * shape the UI needs and validates it, but exports NO fetcher and is NOT
 * registered in client-contracts.json. The viewer
 * (components/issuers/policy-commitment-history.tsx) receives its loader as
 * a prop, so wiring a real endpoint later is a one-line change at the call
 * site once the backend confirms this shape. Assumed route, to be
 * confirmed: GET /issuers/{id}/policy-commitments.
 *
 * Privacy: commitment hashes are OPAQUE. Nothing here (or in the UI)
 * decodes or parses them as policy content; they are only displayed,
 * copied and compared for exact equality. Related proofs are carried as
 * opaque ids and counts only - never proof bodies or claim values.
 *
 * Versioning: `schemaVersion` must equal ISSUER_POLICY_COMMITMENTS_SCHEMA_VERSION.
 * Any other version fails closed as an explicit "unsupported version"
 * error rather than being rendered with a best-effort guess.
 */

export const ISSUER_POLICY_COMMITMENTS_SCHEMA_VERSION = 1;

/** Upper bound on related proof ids carried per commitment; the count field carries the total. */
export const MAX_RELATED_PROOF_REFERENCES = 20;

/** A 32-byte commitment as 64 hex characters (either case on the wire). */
export const COMMITMENT_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

const ledger = z.number().int().positive();
const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");
const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const policyCommitmentSchema = z
  .object({
    version: z.number().int().positive(),
    commitmentHash: z.string().regex(COMMITMENT_HASH_PATTERN),
    effectiveLedger: ledger,
    recordedAt: isoTimestamp,
    relatedProofCount: z.number().int().nonnegative(),
    relatedProofIds: z.array(opaqueId).max(MAX_RELATED_PROOF_REFERENCES),
  })
  .strict()
  .refine((commitment) => commitment.relatedProofIds.length <= commitment.relatedProofCount, {
    message: "relatedProofIds cannot exceed relatedProofCount",
  });

export const issuerPolicyCommitmentHistorySchema = z
  .object({
    schemaVersion: z.literal(ISSUER_POLICY_COMMITMENTS_SCHEMA_VERSION),
    issuerId: opaqueId,
    /** Latest ledger the backend observed on chain. */
    latestLedger: ledger,
    /** Ledger the backend's commitment index has processed up to; null = not yet indexed. */
    indexedLedger: ledger.nullable(),
    indexedAt: isoTimestamp.nullable(),
    /** Commitment hash read directly from the contract at latestLedger; null = not read. */
    onChainCurrentHash: z.string().regex(COMMITMENT_HASH_PATTERN).nullable(),
    commitments: z.array(policyCommitmentSchema),
  })
  .strict()
  .superRefine((history, context) => {
    const sorted = [...history.commitments].sort((a, b) => a.version - b.version);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].version === sorted[index - 1].version) {
        context.addIssue({ code: "custom", message: "Duplicate commitment version" });
      }
      // Two versions effective at the same ledger would make "effective at
      // ledger L" ambiguous, so the history is rejected rather than guessed.
      if (sorted[index].effectiveLedger <= sorted[index - 1].effectiveLedger) {
        context.addIssue({ code: "custom", message: "effectiveLedger must strictly increase with version" });
      }
    }
    if (history.indexedLedger !== null && history.indexedLedger > history.latestLedger) {
      context.addIssue({ code: "custom", message: "indexedLedger cannot be ahead of latestLedger" });
    }
    if (history.indexedLedger !== null) {
      for (const commitment of history.commitments) {
        if (commitment.effectiveLedger > history.indexedLedger) {
          context.addIssue({ code: "custom", message: "Commitment is effective after the indexed ledger" });
        }
      }
    }
  });

export type PolicyCommitment = z.infer<typeof policyCommitmentSchema>;
export type IssuerPolicyCommitmentHistory = z.infer<typeof issuerPolicyCommitmentHistorySchema>;

export type ParseIssuerPolicyCommitmentsResult =
  | { ok: true; history: IssuerPolicyCommitmentHistory }
  | { ok: false; reason: "unsupported_version" | "invalid_response" | "issuer_mismatch" };

/**
 * Validates a raw response for `expectedIssuerId`. A response for a
 * different issuer is rejected, so a misrouted or replayed response can
 * never be shown under the wrong issuer.
 */
export function parseIssuerPolicyCommitments(
  raw: unknown,
  expectedIssuerId: string,
): ParseIssuerPolicyCommitmentsResult {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    (raw as { schemaVersion: unknown }).schemaVersion !== ISSUER_POLICY_COMMITMENTS_SCHEMA_VERSION
  ) {
    return { ok: false, reason: "unsupported_version" };
  }

  const parsed = issuerPolicyCommitmentHistorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid_response" };
  if (parsed.data.issuerId !== expectedIssuerId) return { ok: false, reason: "issuer_mismatch" };
  return { ok: true, history: parsed.data };
}

/**
 * The loader the viewer calls. Must forward `signal` so a superseded
 * request is cancelled; may throw ApiError (status 401/403/...).
 */
export type IssuerPolicyCommitmentLoader = (
  request: { issuerId: string; organizationId: string | null },
  signal: AbortSignal,
) => Promise<unknown>;
