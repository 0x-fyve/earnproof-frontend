import type { VerifyProofResponse } from "@/lib/api/generated/v1";
import type { VerifierPolicyProfile } from "./store";

export type PolicyEvaluationFailureReason =
  | "cryptographic_verification_failed"
  | "unknown_issuer"
  | "unknown_schema_version"
  | "unknown_proof_type"
  | "unknown_claim_operator"
  | "stale_proof"
  | "missing_disclosure_field";

export interface PolicyEvaluationResult {
  accepted: boolean;
  /** Every reason the profile would reject this proof, not just the first — so a preview can show all issues at once. */
  failureReasons: PolicyEvaluationFailureReason[];
}

const KNOWN_CLAIM_OPERATORS = new Set(["gte"]);

/**
 * Evaluates a policy profile against an already-computed verification
 * result.
 *
 * Hard invariant (#235's "Policies never override cryptographic
 * verification outcomes"): this function is structurally incapable of
 * accepting a proof whose cryptographic result wasn't already "VALID" -
 * the very first check below returns `accepted: false` for every other
 * `result` value, before any profile-specific rule runs, and nothing
 * later in the function can flip `accepted` back to `true`. A caller
 * cannot construct an input that bypasses this: there is no profile
 * field or evaluation path that reads `result` a second time or ignores
 * it.
 *
 * Fail-closed invariant ("Unknown issuers, schemas, and operators fail
 * closed"): an issuer/schemaVersion/proofType/claim.operator this
 * profile doesn't explicitly list as accepted is rejected, never
 * silently passed through. An empty `acceptedIssuerIds` list means "no
 * issuers accepted" (reject everything), not "accept any issuer" - the
 * same applies to the other accepted-list fields.
 */
export function evaluateProfile(
  profile: VerifierPolicyProfile,
  verification: VerifyProofResponse,
): PolicyEvaluationResult {
  const failureReasons: PolicyEvaluationFailureReason[] = [];

  if (verification.result !== "VALID") {
    // Cryptographic/lifecycle verification itself did not pass. No policy
    // rule below is evaluated or can change this outcome.
    return { accepted: false, failureReasons: ["cryptographic_verification_failed"] };
  }

  const credential = verification.credential;
  const proof = verification.proof;

  const issuer = credential?.issuer;
  if (!issuer || !profile.acceptedIssuerIds.includes(issuer)) {
    failureReasons.push("unknown_issuer");
  }

  const schemaVersion = credential?.schemaVersion ?? proof?.schemaVersion;
  if (!schemaVersion || !profile.acceptedSchemaVersions.includes(schemaVersion)) {
    failureReasons.push("unknown_schema_version");
  }

  const proofType = credential?.type ?? proof?.type;
  if (!proofType || !profile.acceptedProofTypes.includes(proofType)) {
    failureReasons.push("unknown_proof_type");
  }

  const operator = credential?.claim?.operator;
  if (!operator || !KNOWN_CLAIM_OPERATORS.has(operator)) {
    failureReasons.push("unknown_claim_operator");
  }

  const issuedAt = proof?.issuedAt;
  if (issuedAt) {
    const ageSeconds = (Date.now() - new Date(issuedAt).getTime()) / 1000;
    if (ageSeconds > profile.maxFreshnessSeconds) {
      failureReasons.push("stale_proof");
    }
  } else {
    // No issuedAt to check freshness against — cannot confirm the proof
    // is fresh enough, so this fails closed rather than being skipped.
    failureReasons.push("stale_proof");
  }

  for (const field of profile.requiredDisclosureFields) {
    const claim = credential?.claim as Record<string, unknown> | undefined;
    if (!claim || claim[field] === undefined || claim[field] === null) {
      failureReasons.push("missing_disclosure_field");
      break;
    }
  }

  return { accepted: failureReasons.length === 0, failureReasons };
}

export function describeFailureReason(reason: PolicyEvaluationFailureReason): string {
  switch (reason) {
    case "cryptographic_verification_failed":
      return "The proof itself did not pass cryptographic verification.";
    case "unknown_issuer":
      return "The issuer is not in this profile's accepted issuer list.";
    case "unknown_schema_version":
      return "The credential schema version is not accepted by this profile.";
    case "unknown_proof_type":
      return "The proof type is not accepted by this profile.";
    case "unknown_claim_operator":
      return "The claim uses an operator this profile does not recognize.";
    case "stale_proof":
      return "The proof is older than this profile's freshness limit, or its age could not be confirmed.";
    case "missing_disclosure_field":
      return "A claim field this profile requires to be disclosed is missing.";
  }
}
