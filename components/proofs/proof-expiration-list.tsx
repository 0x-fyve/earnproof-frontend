"use client";

import {
  classifyExpirationStatus,
  isEligibleForRenewalLink,
  type ExpirationDisplayStatus,
  type ProofExpirationInput,
} from "@/lib/proofs/expiration-reminders";
import { formatDateTimeWithZone, getTimeZonePreference } from "@/lib/i18n";

const STATUS_LABELS: Record<ExpirationDisplayStatus, string> = {
  upcoming: "Upcoming",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Superseded",
  disputed: "Disputed",
  unrecognized: "Unknown",
};

const STATUS_STYLES: Record<ExpirationDisplayStatus, string> = {
  upcoming: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  expired: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  revoked: "border-rose-300/30 bg-rose-300/10 text-rose-200",
  superseded: "border-amber-300/30 bg-amber-300/10 text-amber-200",
  disputed: "border-amber-300/30 bg-amber-300/10 text-amber-200",
  unrecognized: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

/**
 * A privacy-safe list view of proof expirations (#241). Shows each proof's
 * expiry with an explicit timezone label (never a bare, unlabeled local
 * time, per the issue's "explicit timezones" scope item) and links
 * eligible proofs to the existing renewal flow rather than auto-renewing.
 *
 * Deliberately takes only display-safe fields (id, type label, status
 * inputs, expiresAt) and never a full proof claim/amount — there is no
 * claim/amount prop for a future edit to accidentally render.
 */
export function ProofExpirationList({
  proofs,
  timeZone,
  onRenew,
}: {
  proofs: ReadonlyArray<ProofExpirationInput & { typeLabel: string }>;
  /** Defaults to the viewer's persisted preference; passed explicitly in tests for determinism. */
  timeZone?: string;
  onRenew?: (proofId: string) => void;
}) {
  const resolvedTimeZone = timeZone ?? getTimeZonePreference();

  if (proofs.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-center">
        <p className="text-sm text-slate-400">No proof expirations to show yet.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3" role="list" aria-label="Proof expirations">
      {proofs.map((proof) => {
        const status = classifyExpirationStatus(proof);
        const eligible = isEligibleForRenewalLink(status);

        return (
          <div
            className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4"
            key={proof.id}
            role="listitem"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{proof.typeLabel}</p>
              <p className="mt-1 text-xs text-slate-400">
                Expires {formatDateTimeWithZone(proof.expiresAt, undefined, resolvedTimeZone)}
              </p>
            </div>
            <span
              className={`inline-flex h-7 w-fit items-center rounded-full border px-2.5 text-xs font-semibold uppercase ${STATUS_STYLES[status]}`}
            >
              {STATUS_LABELS[status]}
            </span>
            {eligible && onRenew ? (
              <button
                className="h-9 rounded-md border border-cyan-300/30 px-4 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/10"
                onClick={() => onRenew(proof.id)}
                type="button"
              >
                Review renewal
              </button>
            ) : (
              <span className="text-xs text-slate-500" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
