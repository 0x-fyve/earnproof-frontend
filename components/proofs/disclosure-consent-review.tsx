"use client";

import { useState } from "react";
import {
  createConsentReceipt,
  isRequestExpired,
  type ConsentReceipt,
  type DisclosureRequest,
} from "@/lib/credentials/consent-receipts";
import { buildConsentReceiptExport } from "@/lib/credentials/export";
import { ArtifactExport } from "@/components/proofs/artifact-export";
import { Timestamp } from "@/components/common/timestamp";

/**
 * Review and approve/decline a verifier's disclosure request (#226).
 *
 * The user reviews the verifier identity commitment, requested purpose,
 * expiry, and exact requested fields, then either declines (no receipt
 * is ever created — see consent-receipts.ts) or approves a subset of the
 * requested fields (never a superset; the field checklist below only
 * ever offers `request.requestedFields`, so there is no UI path to
 * approve a field the verifier didn't ask for).
 */
export function DisclosureConsentReview({
  request,
  walletHash,
  onDecided,
}: {
  request: DisclosureRequest;
  walletHash: string;
  onDecided?: (outcome: { decision: "approved"; receipt: ConsentReceipt } | { decision: "declined" }) => void;
}) {
  const [selectedFields, setSelectedFields] = useState<string[]>([...request.requestedFields]);
  const [decision, setDecision] = useState<"approved" | "declined" | null>(null);
  const [receipt, setReceipt] = useState<ConsentReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expired = isRequestExpired(request);

  function toggleField(field: string) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  }

  function handleApprove() {
    setError(null);
    try {
      const created = createConsentReceipt(request, selectedFields, walletHash);
      setReceipt(created);
      setDecision("approved");
      onDecided?.({ decision: "approved", receipt: created });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a consent receipt.");
    }
  }

  function handleDecline() {
    setDecision("declined");
    onDecided?.({ decision: "declined" });
  }

  if (decision === "declined") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5" role="status">
        <h2 className="text-lg font-semibold text-slate-100">Request declined</h2>
        <p className="mt-2 text-sm text-slate-300">
          No data was disclosed, and no consent receipt was generated.
        </p>
      </div>
    );
  }

  if (decision === "approved" && receipt) {
    return (
      <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-5" role="status">
        <h2 className="text-lg font-semibold text-emerald-100">Disclosure approved</h2>
        <p className="mt-2 text-sm text-emerald-200">
          A receipt has been generated for this approval. Keep the receipt ID (
          <code className="font-mono">{receipt.receiptId}</code>) to look this receipt up later.
        </p>
        <div className="mt-4">
          <ArtifactExport
            plan={buildConsentReceiptExport(receipt)}
            title="Download consent receipt"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
      role="region"
      aria-labelledby="consent-heading"
    >
      <h2 id="consent-heading" className="text-lg font-semibold text-white">
        Review disclosure request
      </h2>

      {expired && (
        <div className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
          <p className="text-xs text-amber-200" role="alert">
            This request expired on <Timestamp value={request.requestExpiresAt} /> and can no
            longer be approved. You may still decline it.
          </p>
        </div>
      )}

      <dl className="mt-4 grid gap-2 text-sm text-slate-300">
        <div>
          <dt className="inline font-semibold text-slate-200">Verifier: </dt>
          <dd className="inline">{request.verifier.displayName}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-200">Identity commitment: </dt>
          <dd className="inline break-all font-mono text-xs">{request.verifier.commitment}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-200">Purpose: </dt>
          <dd className="inline">{request.purpose}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-200">Expires: </dt>
          <dd className="inline">
            <Timestamp value={request.requestExpiresAt} />
          </dd>
        </div>
      </dl>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-slate-200">
          Fields requested — choose which to disclose
        </legend>
        <div className="mt-2 grid gap-1">
          {request.requestedFields.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={selectedFields.includes(field)}
                onChange={() => toggleField(field)}
                disabled={expired}
              />
              {field}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="mt-3 text-xs text-rose-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={expired || selectedFields.length === 0}
          className="h-10 rounded-md border border-emerald-300/30 bg-emerald-300 px-4 text-xs font-semibold text-slate-950 hover:bg-emerald-200 transition disabled:opacity-50"
        >
          Approve disclosure
        </button>
        <button
          type="button"
          onClick={handleDecline}
          className="h-10 rounded-md border border-rose-300/30 px-4 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 transition"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
