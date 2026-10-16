"use client";

import Link from "next/link";
import type { ProofListItem } from "@/lib/api/proofs-list";
import {
  formatProofStatus,
  formatProofType,
  getProofStatusColor,
} from "@/lib/api/proofs-list";

export type ProofHistoryListProps = {
  proofs: ProofListItem[];
};

/**
 * Renders a list of proofs with status, type, issuer, and dates.
 * Uses a responsive grid that adapts from mobile (1 column) to desktop (multi-column).
 */
export function ProofHistoryList({ proofs }: ProofHistoryListProps) {
  if (proofs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Desktop table header (hidden on mobile) */}
      <div className="hidden grid-cols-[1.5fr_1fr_1fr_1.2fr_0.8fr] gap-3 bg-white/5 p-3 text-xs font-semibold uppercase tracking-wider text-slate-400 md:grid rounded-lg">
        <div>Proof ID</div>
        <div>Type</div>
        <div>Issuer</div>
        <div>Created</div>
        <div>Status</div>
      </div>

      {/* Proof rows */}
      <div className="space-y-2">
        {proofs.map((proof) => (
          <ProofListRow key={proof.id} proof={proof} />
        ))}
      </div>
    </div>
  );
}

/**
 * Individual proof list row
 */
function ProofListRow({ proof }: { proof: ProofListItem }) {
  const createdDate = new Date(proof.createdAt);
  const expiresDate = new Date(proof.expiresAt);
  const now = new Date();

  // Format dates for display
  const createdFormatted = createdDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const expiresFormatted = expiresDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const isExpired = expiresDate < now;
  const isRevoked = !!proof.revokedAt;

  return (
    <Link href={`/proofs/verify?proof=${proof.id}`}>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.06] transition sm:p-4">
        {/* Mobile layout */}
        <div className="space-y-2 md:hidden">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-medium text-white break-all">
                {proof.id}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {proof.issuerName || `Issuer ${proof.issuerId}`}
              </p>
            </div>
            <StatusBadge status={proof.status} isExpired={isExpired} isRevoked={isRevoked} />
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Type</span>
              <p className="font-medium text-white">{formatProofType(proof.type)}</p>
            </div>
            <div>
              <span className="text-slate-400">Created</span>
              <p className="font-medium text-white">{createdFormatted}</p>
            </div>
            <div>
              <span className="text-slate-400">Expires</span>
              <p className="font-medium text-white">{expiresFormatted}</p>
            </div>
          </div>

          {isRevoked && (
            <div className="rounded bg-rose-400/10 px-2 py-1 text-xs text-rose-300">
              Revoked on {new Date(proof.revokedAt!).toLocaleDateString()}
            </div>
          )}

          <div className="text-xs text-slate-400 pt-1">
            {proof.summary.assetCode}
            {proof.summary.assetIssuer && ` • ${proof.summary.assetIssuer}`}
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1.2fr_0.8fr] gap-3 items-center md:grid">
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium text-white truncate">
              {proof.id}
            </p>
            <p className="mt-1 text-xs text-slate-400 truncate">
              {proof.summary.assetCode}
              {proof.summary.assetIssuer && ` • ${proof.summary.assetIssuer}`}
            </p>
          </div>

          <div className="text-sm text-slate-300">
            {formatProofType(proof.type)}
          </div>

          <div className="text-sm text-slate-300 truncate">
            {proof.issuerName || `Issuer ${proof.issuerId}`}
          </div>

          <div className="text-sm text-slate-400">
            <div>{createdFormatted}</div>
            <div className="text-xs">exp. {expiresFormatted}</div>
          </div>

          <div className="text-right">
            <StatusBadge status={proof.status} isExpired={isExpired} isRevoked={isRevoked} />
          </div>
        </div>

        {/* Revoked indicator (desktop) */}
        {isRevoked && (
          <div className="hidden mt-2 text-xs text-rose-300 md:block">
            Revoked on {new Date(proof.revokedAt!).toLocaleDateString()}
          </div>
        )}
      </div>
    </Link>
  );
}

/**
 * Status badge for proof status display
 */
function StatusBadge({
  status,
  isExpired,
  isRevoked,
}: {
  status: string;
  isExpired: boolean;
  isRevoked: boolean;
}) {
  let displayStatus = formatProofStatus(status);
  let badgeClass = getProofStatusColor(status);

  if (isRevoked) {
    displayStatus = "Revoked";
    badgeClass = "text-rose-300 bg-rose-400/10";
  } else if (isExpired) {
    displayStatus = "Expired";
    badgeClass = "text-slate-300 bg-slate-400/10";
  }

  return (
    <span
      className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${badgeClass}`}
    >
      {displayStatus}
    </span>
  );
}
