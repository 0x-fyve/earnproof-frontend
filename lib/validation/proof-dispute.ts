import type { DisputeRecord } from "@/lib/proof-disputes/store";

export type DisputeActorRole = "WORKER" | "ISSUER" | "ADMIN" | "DEVELOPER";

/**
 * #234 acceptance criterion: "Only eligible actors can submit or
 * withdraw a dispute." There is no proof "subject"/"owner" field in this
 * repo's proof schemas (ProofListItem only carries issuerId - see
 * lib/api/proofs-list.ts), so "eligible to submit" is approximated the
 * same way lib/proof-sharing/store.ts and lib/proof-renewal/store.ts
 * approximate ownership: any authenticated caller may submit a dispute
 * against a proof id (disputes are namespaced per that caller's own
 * userId in storage, so one user's disputes are never visible to
 * another's listing), but only the original disputant can withdraw
 * their own dispute, and only ISSUER/ADMIN roles - the parties capable
 * of actually investigating a claim - can accept/reject/resolve one.
 * A real implementation would check the caller's actual relationship to
 * the proof (subject, payer, or payee) once the backend exposes it.
 */
const REVIEW_ROLES: readonly DisputeActorRole[] = ["ISSUER", "ADMIN"];

export function canSubmitDispute(role: DisputeActorRole): boolean {
  // DEVELOPER is a platform-integration role, not a party to any proof's
  // claim - it can read/build against the API but has no standing to
  // dispute a specific proof's content.
  return role !== "DEVELOPER";
}

export function canWithdrawDispute(dispute: DisputeRecord, actorId: string): boolean {
  return dispute.submittedBy === actorId && dispute.state === "pending";
}

export function canReviewDispute(role: DisputeActorRole, dispute: DisputeRecord): boolean {
  return REVIEW_ROLES.includes(role) && (dispute.state === "pending" || dispute.state === "accepted");
}

/**
 * #234 acceptance criterion: "Sensitive evidence is never rendered from
 * untrusted content." Evidence is accepted only as an opaque commitment
 * (a hash or a short reference id the disputant already holds
 * out-of-band) - never a URL, HTML, or markdown string that a review UI
 * might ever interpolate or follow. This validates the *shape* of that
 * commitment defensively; the UI layer (components/proofs/proof-dispute-*)
 * additionally always renders it as inert plain text, never dangerouslySetInnerHTML
 * or an href.
 */
const SAFE_EVIDENCE_PATTERN = /^[a-zA-Z0-9:_-]{8,128}$/;

export function isSafeEvidenceCommitment(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false; // reject anything URL-shaped
  if (/[<>"'`]/.test(trimmed)) return false; // reject anything markup-shaped
  return SAFE_EVIDENCE_PATTERN.test(trimmed);
}

export const MAX_DISPUTE_NOTE_LENGTH = 1000;

export function isValidDisputeNote(note: string | undefined): boolean {
  if (note === undefined) return true;
  return note.length <= MAX_DISPUTE_NOTE_LENGTH;
}
