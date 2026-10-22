"use client";

import {
  formatKeyReferenceWarning,
  isBlockingKeyReference,
  sortKeysForTimeline,
  type IssuerSigningKeyRecord,
  type KeyReferenceWarning,
} from "@/lib/issuers/key-lifecycle-timeline";
import { formatDateTimeWithZone, getTimeZonePreference } from "@/lib/i18n";

const STATE_LABELS: Record<IssuerSigningKeyRecord["lifecycleState"], string> = {
  ACTIVE: "Active",
  OVERLAP_ROTATION: "Overlap rotation",
  RETIRED: "Retired",
  UNKNOWN: "Unknown",
};

const STATE_STYLES: Record<IssuerSigningKeyRecord["lifecycleState"], string> = {
  ACTIVE: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  OVERLAP_ROTATION: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  RETIRED: "border-slate-500/30 bg-slate-500/10 text-slate-200",
  UNKNOWN: "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

/**
 * Admin-facing timeline of ALL of an issuer's signing keys (#245),
 * complementing (not duplicating) the single-key, per-verification
 * `KeyLifecyclePanel` in `components/verification/key-lifecycle-panel.tsx`.
 *
 * Security contract: this component's props type
 * (`IssuerSigningKeyRecord`, from `lib/issuers/key-lifecycle-timeline.ts`)
 * has no field carrying raw key material, so there is no key material for
 * this component to render even by mistake. Only `keyFingerprint` (a
 * short, already-derived display value) is shown, never a full key value.
 */
export function IssuerKeyLifecycleTimeline({
  keys,
  referenceWarning,
  timeZone,
  rotationReviewHref,
}: {
  keys: readonly IssuerSigningKeyRecord[];
  /** An optional warning about a specific credential's key reference, surfaced inline with the relevant key. */
  referenceWarning?: KeyReferenceWarning;
  timeZone?: string;
  /** Link to an authorized rotation review flow; never a key-bearing URL. */
  rotationReviewHref?: string;
}) {
  const resolvedTimeZone = timeZone ?? getTimeZonePreference();
  const ordered = sortKeysForTimeline(keys);

  if (ordered.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-center">
        <p className="text-sm text-slate-400">No signing keys on record for this issuer.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {referenceWarning && (
        <div
          className={`rounded-md border p-3 ${
            isBlockingKeyReference(referenceWarning)
              ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
              : "border-amber-300/30 bg-amber-300/10 text-amber-100"
          }`}
          role={isBlockingKeyReference(referenceWarning) ? "alert" : "status"}
        >
          <p className="text-xs">{formatKeyReferenceWarning(referenceWarning)}</p>
        </div>
      )}

      <ol className="grid gap-3" role="list">
        {ordered.map((key) => (
          <li
            className={`grid gap-2 rounded-lg border p-4 ${STATE_STYLES[key.lifecycleState]}`}
            key={key.keyId}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{key.keyFingerprint}</span>
              <span className="text-xs font-semibold uppercase">{STATE_LABELS[key.lifecycleState]}</span>
            </div>

            <dl className="grid gap-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt>Algorithm</dt>
                <dd>{key.algorithm}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Active since</dt>
                <dd>{formatDateTimeWithZone(key.activatedAt, undefined, resolvedTimeZone)}</dd>
              </div>
              {key.retiredAt && (
                <div className="flex justify-between gap-2">
                  <dt>Retired</dt>
                  <dd>{formatDateTimeWithZone(key.retiredAt, undefined, resolvedTimeZone)}</dd>
                </div>
              )}
              {key.supersedes && (
                <div className="flex justify-between gap-2">
                  <dt>Supersedes</dt>
                  <dd className="font-mono">{key.supersedes}</dd>
                </div>
              )}
              {key.supersededBy && (
                <div className="flex justify-between gap-2">
                  <dt>Superseded by</dt>
                  <dd className="font-mono">{key.supersededBy}</dd>
                </div>
              )}
            </dl>

            {key.compromisedAt && (
              <p className="text-xs text-rose-200" role="alert">
                Marked compromised {formatDateTimeWithZone(key.compromisedAt, undefined, resolvedTimeZone)}.
              </p>
            )}
          </li>
        ))}
      </ol>

      {rotationReviewHref && (
        <a
          className="w-fit text-xs font-semibold text-cyan-300 underline hover:text-cyan-200"
          href={rotationReviewHref}
        >
          Review key rotation
        </a>
      )}
    </div>
  );
}
