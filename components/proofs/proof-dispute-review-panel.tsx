"use client";

import { useState } from "react";
import type { DisputeRecord, DisputeState } from "@/lib/proof-disputes/store";
import { canReviewDispute, canWithdrawDispute, type DisputeActorRole } from "@/lib/validation/proof-dispute";
import { formatDateTime } from "@/lib/i18n";

const STATE_STYLES: Record<DisputeState, { badge: string; label: string }> = {
  pending: { badge: "bg-amber-500/20 text-amber-200 border border-amber-400/40", label: "Pending" },
  accepted: { badge: "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40", label: "Accepted" },
  rejected: { badge: "bg-rose-500/20 text-rose-200 border border-rose-400/40", label: "Rejected" },
  withdrawn: { badge: "bg-slate-500/20 text-slate-300 border border-slate-400/40", label: "Withdrawn" },
  resolved: { badge: "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40", label: "Resolved" },
};

const CATEGORY_LABELS: Record<DisputeRecord["category"], string> = {
  incorrect_amount: "Incorrect amount",
  unauthorized_claim: "Unauthorized claim",
  stale_data: "Stale data",
  wrong_recipient: "Wrong recipient",
  other: "Other",
};

/**
 * Lists a proof's disputes across every state (#234's "Display pending,
 * accepted, rejected, withdrawn, and resolved states"), with a visible
 * timestamped history per dispute, and shows the withdraw/review actions
 * only to actors the eligibility checks in lib/validation/proof-dispute.ts
 * actually allow - an ineligible actor sees the same read-only list, not
 * a disabled or hidden-but-reachable control.
 *
 * Evidence commitments and notes are always rendered as plain text
 * nodes (React's default escaping), never via dangerouslySetInnerHTML or
 * as a clickable href, per #234's "sensitive evidence is never rendered
 * from untrusted content" acceptance criterion.
 */
export function ProofDisputeReviewPanel({
  disputes,
  currentActorId,
  currentActorRole,
  onWithdraw,
  onAccept,
  onReject,
  onResolve,
}: {
  disputes: DisputeRecord[];
  currentActorId: string;
  currentActorRole: DisputeActorRole;
  onWithdraw: (disputeId: string) => void;
  onAccept: (disputeId: string) => void;
  onReject: (disputeId: string) => void;
  onResolve: (disputeId: string) => void;
}) {
  const [actingOn, setActingOn] = useState<string | null>(null);

  if (disputes.length === 0) {
    return <p className="text-sm text-slate-400">No disputes have been raised for this proof.</p>;
  }

  function runAction(disputeId: string, action: (id: string) => void) {
    setActingOn(disputeId);
    try {
      action(disputeId);
    } finally {
      setActingOn(null);
    }
  }

  return (
    <ul className="grid gap-4">
      {disputes.map((dispute) => {
        const style = STATE_STYLES[dispute.state];
        const canWithdraw = canWithdrawDispute(dispute, currentActorId);
        const canReview = canReviewDispute(currentActorRole, dispute);
        const busy = actingOn === dispute.id;

        return (
          <li key={dispute.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                data-testid="dispute-state-badge"
                className={`rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}
              >
                {style.label}
              </span>
              <span className="text-xs text-slate-400">{formatDateTime(dispute.createdAt)}</span>
            </div>

            <p className="mt-3 text-sm font-medium text-white">{CATEGORY_LABELS[dispute.category]}</p>
            <p className="mt-1 text-xs text-slate-400">
              Evidence commitment: <span className="font-mono">{dispute.evidenceCommitment}</span>
            </p>
            {dispute.note && <p className="mt-2 text-sm leading-6 text-slate-300">{dispute.note}</p>}

            <ol className="mt-4 grid gap-2 border-t border-white/10 pt-3">
              {dispute.history.map((event, index) => (
                <li key={`${event.state}-${index}`} className="text-xs text-slate-400">
                  <span className="font-medium text-slate-200">{STATE_STYLES[event.state].label}</span>{" "}
                  {formatDateTime(event.at)}
                  {event.note ? <span className="block text-slate-400">{event.note}</span> : null}
                </li>
              ))}
            </ol>

            {(canWithdraw || canReview) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {canWithdraw && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(dispute.id, onWithdraw)}
                    className="h-8 rounded-md border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                )}
                {canReview && dispute.state === "pending" && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(dispute.id, onAccept)}
                      className="h-8 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(dispute.id, onReject)}
                      className="h-8 rounded-md border border-rose-400/40 px-3 text-xs font-medium text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                {canReview && dispute.state === "accepted" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(dispute.id, onResolve)}
                    className="h-8 rounded-md bg-emerald-300 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"
                  >
                    Mark resolved
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
