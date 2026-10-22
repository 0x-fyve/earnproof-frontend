/**
 * Issuer signing key lifecycle timeline (#245).
 *
 * `components/verification/key-lifecycle-panel.tsx` and
 * `lib/validation/key-lifecycle.ts` already exist, but they render a
 * SINGLE key's current state in the context of one verification outcome
 * (shown when verifying one specific credential). This is genuinely
 * different, complementary work: an admin-facing view of ALL of an
 * issuer's keys across their full history (activation/retirement times,
 * rotation provenance, overlap windows). This module reuses
 * `KeyLifecycleState` and `isBlockingKeyOutcome` from
 * `lib/validation/key-lifecycle.ts` as its state model's foundation so the
 * per-verification display and this admin timeline agree on what
 * ACTIVE/OVERLAP_ROTATION/RETIRED/UNKNOWN mean, rather than inventing a
 * second, parallel vocabulary.
 *
 * Hard security requirement (not UI polish): key material is never
 * rendered, logged, or cached by the client. `IssuerSigningKeyRecord`
 * below has no field for raw key material at all - only identifiers,
 * fingerprints, and metadata - so there is nothing for a future edit to
 * accidentally render. This is enforced structurally (the type has no
 * such field), not just by convention.
 */

import type { KeyLifecycleState } from "@/lib/validation/key-lifecycle";

export type { KeyLifecycleState };

/**
 * One signing key's lifecycle record for the admin timeline. Deliberately
 * carries only identifiers/fingerprints/timestamps/provenance - never a
 * `publicKey`, `privateKey`, or raw key material field. A key's fingerprint
 * (`keyFingerprint`) is a short, one-way-derived display value (e.g. the
 * last few hex characters of a hash), not the key itself.
 */
export type IssuerSigningKeyRecord = {
  keyId: string;
  keyFingerprint: string;
  algorithm: string;
  lifecycleState: KeyLifecycleState;
  activatedAt: string;
  retiredAt: string | null;
  /** The keyId of the key this one was rotated in to replace, if any. */
  supersedes: string | null;
  /** The keyId of the key that replaced this one, if any. */
  supersededBy: string | null;
  /** Set when this key is known to have been compromised, independent of its lifecycle state. */
  compromisedAt: string | null;
};

/**
 * A credential's reference to a signing key that this issuer's key
 * registry does not recognize at all - distinct from a recognized-but-
 * retired key. Both cases must be flagged, but an unrecognized key id is a
 * stronger signal (the credential is internally inconsistent, not just
 * referencing an old key).
 */
export type KeyReferenceWarning =
  | { kind: "unknown-key"; keyId: string }
  | { kind: "retired-key"; key: IssuerSigningKeyRecord }
  | { kind: "not-yet-active"; key: IssuerSigningKeyRecord }
  | { kind: "compromised-key"; key: IssuerSigningKeyRecord }
  | null;

/**
 * Checks whether a credential's referenced key id warrants a warning.
 * Returns `null` when the key is recognized, active, and not compromised -
 * the normal case needing no warning banner.
 *
 * Precedence: compromised > unknown > not-yet-active > retired. A
 * compromised key is flagged regardless of its lifecycle state, since
 * compromise is an independent, more urgent signal than rotation status.
 */
export function checkKeyReference(
  keyId: string,
  registry: readonly IssuerSigningKeyRecord[],
  now: Date = new Date(),
): KeyReferenceWarning {
  const key = registry.find((record) => record.keyId === keyId);

  if (!key) {
    return { kind: "unknown-key", keyId };
  }

  if (key.compromisedAt !== null) {
    return { kind: "compromised-key", key };
  }

  const activatedAt = new Date(key.activatedAt).getTime();
  if (activatedAt > now.getTime()) {
    return { kind: "not-yet-active", key };
  }

  if (key.lifecycleState === "RETIRED") {
    return { kind: "retired-key", key };
  }

  return null;
}

export function formatKeyReferenceWarning(warning: KeyReferenceWarning): string {
  if (!warning) return "";
  switch (warning.kind) {
    case "unknown-key":
      return `This credential references a signing key ("${warning.keyId}") that is not recognized by this issuer's key registry.`;
    case "compromised-key":
      return `This credential references a key that was marked compromised. Treat its signature as untrusted.`;
    case "not-yet-active":
      return `This credential references a signing key that was not yet active at the time it claims to have been signed.`;
    case "retired-key":
      return `This credential references a retired signing key. It may still verify for credentials issued before retirement, but cannot be used for new ones.`;
  }
}

/** Whether a key reference warrants blocking the credential as untrusted, vs. an informational note. */
export function isBlockingKeyReference(warning: KeyReferenceWarning): boolean {
  return warning !== null && (warning.kind === "unknown-key" || warning.kind === "compromised-key");
}

/**
 * Two keys' active windows overlap when both are "live" (activated, not yet
 * retired, or retired after the other activated) for some shared span of
 * time. This is the primitive an overlap-rotation display needs: a
 * successor key activated before its predecessor's retirement is a
 * deliberate overlap window, not a data error, and should be shown as
 * such rather than as two disjoint bars.
 */
export function keysOverlap(a: IssuerSigningKeyRecord, b: IssuerSigningKeyRecord): boolean {
  const aStart = new Date(a.activatedAt).getTime();
  const aEnd = a.retiredAt ? new Date(a.retiredAt).getTime() : Infinity;
  const bStart = new Date(b.activatedAt).getTime();
  const bEnd = b.retiredAt ? new Date(b.retiredAt).getTime() : Infinity;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Orders keys for timeline display: by activation time ascending, with
 * null/invalid dates sorted last rather than throwing or silently
 * reordering unpredictably (a malformed activatedAt should be visible at
 * the end of the list, not crash the whole timeline).
 */
export function sortKeysForTimeline(
  keys: readonly IssuerSigningKeyRecord[],
): IssuerSigningKeyRecord[] {
  return [...keys].sort((a, b) => {
    const aTime = new Date(a.activatedAt).getTime();
    const bTime = new Date(b.activatedAt).getTime();
    const aValid = !Number.isNaN(aTime);
    const bValid = !Number.isNaN(bTime);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    return aTime - bTime;
  });
}

/**
 * Builds the rotation provenance chain starting from `keyId`: every key it
 * supersedes, in order, back to the first key with no predecessor. Stops
 * and returns what it has so far (rather than throwing) if a cycle or a
 * dangling `supersedes` reference (pointing at a keyId not in `registry`)
 * is encountered - a provenance display should degrade to "here's as far
 * back as we could trace" rather than hang or crash on bad data.
 */
export function rotationChain(
  keyId: string,
  registry: readonly IssuerSigningKeyRecord[],
): IssuerSigningKeyRecord[] {
  const byId = new Map(registry.map((key) => [key.keyId, key]));
  const chain: IssuerSigningKeyRecord[] = [];
  const seen = new Set<string>();

  let current = byId.get(keyId);
  while (current && !seen.has(current.keyId)) {
    chain.push(current);
    seen.add(current.keyId);
    current = current.supersedes ? byId.get(current.supersedes) : undefined;
  }

  return chain;
}
