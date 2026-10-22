"use client";

/**
 * Proof sharing access history and revocation insights (#221).
 *
 * Renders only pre-aggregated, pre-classified data from
 * lib/proof-sharing/access-history.ts: outcome counts and timestamps. It
 * never receives or renders a raw token, IP address, or verifier payload —
 * there is no prop on this component for any of those, by design.
 */

import { formatDate } from "@/lib/i18n";
import type { ShareLinkAccessSummary } from "@/lib/proof-sharing/access-history";

const OUTCOME_LABELS: Record<"ACCEPTED" | "EXPIRED" | "REJECTED", string> = {
  ACCEPTED: "Accepted",
  EXPIRED: "Expired at use",
  REJECTED: "Rejected",
};

export function ShareLinkAccessInsights({ summary }: { summary: ShareLinkAccessSummary }) {
  if (summary.totalAttempts === 0) {
    return <p className="mt-2 text-xs text-slate-400">No access attempts yet.</p>;
  }

  return (
    <div className="mt-2 grid gap-2 text-xs">
      <div className="flex flex-wrap gap-3">
        <span>Total attempts: {summary.totalAttempts}</span>
        <span>Accepted: {summary.acceptedCount}</span>
        <span>Expired: {summary.expiredCount}</span>
        <span>Rejected: {summary.rejectedCount}</span>
      </div>

      {summary.flaggedAsSuspicious ? (
        <p role="alert" className="font-semibold text-rose-200">
          Flagged: repeated rejected access attempts. Consider revoking this link.
        </p>
      ) : null}

      {summary.recent.length > 0 ? (
        <div>
          <p className="font-medium text-slate-300">Recent activity</p>
          <ul aria-label="Recent access attempts" className="mt-1 grid gap-1">
            {summary.recent.map((event) => (
              <li key={event.id} className="flex justify-between gap-3">
                <span>{OUTCOME_LABELS[event.outcome]}</span>
                <span>{formatDate(new Date(event.occurredAt))}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
