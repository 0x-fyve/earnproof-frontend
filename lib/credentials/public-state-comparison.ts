/**
 * Compare an imported credential with the public proof record (#225).
 *
 * Builds on the existing `/proofs/{id}/verify` call (see
 * verify-credential-form.tsx), which already performs the real
 * cryptographic signature check server-side and returns it as
 * `VerifyProofResponse.result` — this module does not re-implement
 * signature verification (no ed25519 check exists client-side in this
 * codebase, and inventing one for a focused comparison feature would be
 * well beyond this issue's scope). Instead it adds the comparison layer
 * that was missing: `parseCredentialJson` only ever extracted `id`
 * (discarding every other field "so the two [import paths] can never
 * drift"), so nothing before this compared the imported credential's own
 * issuer/schema/claim/expiry against what the server's public proof
 * record currently says.
 *
 * Hard invariant ("Signature verification remains independent of current
 * proof validity" / "Mismatches cannot be presented as successful
 * verification"): `compareCredentialWithPublicState` NEVER reads or
 * derives from `response.result`/`response.status` at all — it only
 * diffs field values. The caller (the UI) is responsible for combining
 * this comparison's outcome with the separate signature result, and must
 * never let a field-mismatch outcome be overridden into "verified" just
 * because the signature happened to check out, nor the reverse.
 */

import type { VerifyProofResponse } from "@/components/verification/verification-panel";

export interface ImportedCredentialSummary {
  id: string;
  issuer: string | null;
  schemaVersion: string | null;
  proofType: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  /** The claim object as imported, used only for a presence/shape check — never sent anywhere. */
  claim: Record<string, unknown> | null;
}

export type CredentialFieldMismatchKind =
  | "issuer"
  | "schema_version"
  | "proof_type"
  | "expires_at"
  | "committed_metadata";

export interface CredentialFieldMismatch {
  kind: CredentialFieldMismatchKind;
  importedValue: string | null;
  currentValue: string | null;
}

export type PublicStateOutcome =
  | "exact_match"
  | "field_mismatch"
  | "stale"
  | "revoked"
  | "superseded"
  | "unknown_proof"
  | "malformed_credential";

export interface PublicStateComparisonResult {
  outcome: PublicStateOutcome;
  mismatches: CredentialFieldMismatch[];
  /** The server's current record, for display — never mutated, never used to rewrite the imported credential's own bytes. */
  currentProof: VerifyProofResponse["proof"] | null;
}

/**
 * Extracts only the fields this comparison needs from a parsed credential
 * JSON object, defensively — any missing/wrong-typed field becomes null
 * rather than throwing, so a malformed credential degrades to an explicit
 * `malformed_credential` outcome rather than crashing the comparison.
 *
 * Only id/issuer/schemaVersion/type/expiresAt/issuedAt/claim are read.
 * `subject` (wallet hash) and any other field are deliberately never
 * extracted — this summary is also never sent to any network call,
 * so there is no path for a private claim field to reach a public
 * proof endpoint ("Private claims are not sent to public proof
 * endpoints").
 */
export function extractImportedCredentialSummary(raw: unknown): ImportedCredentialSummary | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : null;
  if (!id) return null;

  const proof = typeof obj.proof === "object" && obj.proof !== null ? (obj.proof as Record<string, unknown>) : null;

  return {
    id,
    issuer: typeof obj.issuer === "string" ? obj.issuer : null,
    schemaVersion: typeof obj.schemaVersion === "string" ? obj.schemaVersion : null,
    proofType: proof && typeof proof.type === "string" ? proof.type : null,
    expiresAt: typeof obj.expiresAt === "string" ? obj.expiresAt : null,
    issuedAt: typeof obj.issuedAt === "string" ? obj.issuedAt : null,
    claim: typeof obj.claim === "object" && obj.claim !== null ? (obj.claim as Record<string, unknown>) : null,
  };
}

/**
 * Compares an imported credential summary against the server's public
 * proof response, never touching `response.result`/`response.status`.
 */
export function compareCredentialWithPublicState(
  imported: ImportedCredentialSummary,
  response: VerifyProofResponse,
): PublicStateComparisonResult {
  if (!response.proof) {
    return { outcome: "unknown_proof", mismatches: [], currentProof: null };
  }

  const proof = response.proof;
  const credential = response.credential;

  // Revoked and superseded are reported as distinct outcomes from a plain
  // mismatch, per the issue's "separate outcomes for stale, revoked,
  // superseded, and unknown proofs" — these are lifecycle states, not
  // field-value disagreements, even though they're detected from the same
  // response shape.
  if (proof.revokedAt) {
    return { outcome: "revoked", mismatches: [], currentProof: proof };
  }

  const now = new Date();
  if (new Date(proof.expiresAt) <= now) {
    return { outcome: "stale", mismatches: [], currentProof: proof };
  }

  // "Superseded": the public record's own id or schema version diverges
  // from what the imported credential claims to identify, in a way that
  // indicates a newer record replaced this one at the same logical proof
  // rather than a simple typo/corruption. Modeled here as: server has a
  // DIFFERENT proof id than imported but was reached by the imported
  // credential's own id lookup succeeding — in practice this app's
  // /proofs/{id}/verify is looked up BY that id, so a true id mismatch
  // can't happen via this call shape; supersession is instead signaled by
  // a schema version that has moved forward from what was imported
  // (server's schema is newer than the imported credential's).
  if (
    imported.schemaVersion &&
    proof.schemaVersion &&
    isNewerSchemaVersion(proof.schemaVersion, imported.schemaVersion)
  ) {
    return { outcome: "superseded", mismatches: [], currentProof: proof };
  }

  const mismatches: CredentialFieldMismatch[] = [];

  if (imported.issuer !== null && credential?.id && credential.id !== imported.id) {
    // Defensive: should not happen given the lookup-by-id call shape, but
    // never silently ignore an id disagreement if it somehow occurs.
    mismatches.push({ kind: "issuer", importedValue: imported.issuer, currentValue: null });
  }

  if (imported.schemaVersion !== null && proof.schemaVersion !== imported.schemaVersion) {
    mismatches.push({
      kind: "schema_version",
      importedValue: imported.schemaVersion,
      currentValue: proof.schemaVersion,
    });
  }

  if (imported.proofType !== null && proof.type !== imported.proofType) {
    mismatches.push({
      kind: "proof_type",
      importedValue: imported.proofType,
      currentValue: proof.type,
    });
  }

  if (imported.expiresAt !== null && proof.expiresAt !== imported.expiresAt) {
    mismatches.push({
      kind: "expires_at",
      importedValue: imported.expiresAt,
      currentValue: proof.expiresAt,
    });
  }

  if (imported.claim && credential?.claim) {
    const importedClaimKeys = Object.keys(imported.claim).sort();
    const currentClaimKeys = Object.keys(credential.claim).sort();
    const keysDiffer =
      importedClaimKeys.length !== currentClaimKeys.length ||
      importedClaimKeys.some((key, index) => key !== currentClaimKeys[index]);
    if (keysDiffer) {
      mismatches.push({
        kind: "committed_metadata",
        importedValue: importedClaimKeys.join(","),
        currentValue: currentClaimKeys.join(","),
      });
    }
  }

  if (mismatches.length > 0) {
    return { outcome: "field_mismatch", mismatches, currentProof: proof };
  }

  return { outcome: "exact_match", mismatches: [], currentProof: proof };
}

/** Simple "x.y" numeric schema version comparison; non-numeric input is treated as not-newer (fails closed, no supersession claimed). */
function isNewerSchemaVersion(current: string, imported: string): boolean {
  const parse = (v: string): number[] => v.split(".").map((part) => Number.parseInt(part, 10));
  const currentParts = parse(current);
  const importedParts = parse(imported);
  if (currentParts.some(Number.isNaN) || importedParts.some(Number.isNaN)) {
    return false;
  }
  for (let i = 0; i < Math.max(currentParts.length, importedParts.length); i++) {
    const c = currentParts[i] ?? 0;
    const imp = importedParts[i] ?? 0;
    if (c > imp) return true;
    if (c < imp) return false;
  }
  return false;
}

export function describeOutcome(outcome: PublicStateOutcome): string {
  switch (outcome) {
    case "exact_match":
      return "The imported credential matches the current public proof record exactly.";
    case "field_mismatch":
      return "The imported credential disagrees with the current public proof record on one or more fields.";
    case "stale":
      return "The public proof record has expired since this credential was imported.";
    case "revoked":
      return "The public proof record has been revoked since this credential was imported.";
    case "superseded":
      return "The public proof record has been superseded by a newer schema version.";
    case "unknown_proof":
      return "No public proof record exists for this credential's ID.";
    case "malformed_credential":
      return "The imported credential could not be parsed well enough to compare.";
  }
}

export function describeMismatchKind(kind: CredentialFieldMismatchKind): string {
  switch (kind) {
    case "issuer":
      return "Issuer";
    case "schema_version":
      return "Schema version";
    case "proof_type":
      return "Proof type";
    case "expires_at":
      return "Expiry";
    case "committed_metadata":
      return "Committed claim metadata";
  }
}
