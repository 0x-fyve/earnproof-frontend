"use client";

import { useState } from "react";
import {
  getConsentReceiptById,
  isReceiptExpired,
  type ConsentReceipt,
} from "@/lib/credentials/consent-receipts";
import { buildConsentReceiptExport } from "@/lib/credentials/export";
import { ArtifactExport } from "@/components/proofs/artifact-export";
import { Timestamp } from "@/components/common/timestamp";

/**
 * Looks up a previously-generated consent receipt by its own privacy-safe
 * receipt ID (#226's "allow later lookup by privacy-safe receipt
 * identifier"). Scoped to the current wallet's own receipts only — a
 * receipt ID from a different wallet's receipt list is never found here.
 */
export function ConsentReceiptLookup({ walletHash }: { walletHash: string }) {
  const [receiptIdInput, setReceiptIdInput] = useState("");
  const [result, setResult] = useState<ConsentReceipt | null | "not-found">(null);

  function handleLookup() {
    const trimmed = receiptIdInput.trim();
    if (!trimmed) return;
    const found = getConsentReceiptById(walletHash, trimmed);
    setResult(found ?? "not-found");
  }

  return (
    <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Look up a consent receipt</h2>
        <p className="mt-2 text-sm text-slate-300">
          Enter a receipt ID to view the disclosure it recorded.
        </p>
      </div>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="receipt-id-input">
          Receipt ID
        </label>
        <input
          id="receipt-id-input"
          value={receiptIdInput}
          onChange={(e) => setReceiptIdInput(e.target.value)}
          placeholder="receipt_..."
          className="h-10 flex-1 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
        />
        <button
          type="button"
          onClick={handleLookup}
          className="h-10 rounded-md border border-cyan-300/30 bg-cyan-300 px-4 text-xs font-semibold text-slate-950 hover:bg-cyan-200 transition"
        >
          Look up
        </button>
      </div>

      {result === "not-found" && (
        <p className="text-xs text-rose-300" role="alert">
          No receipt with that ID was found for this wallet.
        </p>
      )}

      {result && result !== "not-found" && (
        <div
          className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm"
          role="region"
          aria-label="Consent receipt details"
        >
          <dl className="grid gap-2 text-slate-300">
            <div>
              <dt className="inline font-semibold text-slate-200">Verifier: </dt>
              <dd className="inline">{result.verifier.displayName}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-slate-200">Purpose: </dt>
              <dd className="inline">{result.purpose}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-slate-200">Approved fields: </dt>
              <dd className="inline">{result.approvedFields.join(", ")}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-slate-200">Approved at: </dt>
              <dd className="inline">
                <Timestamp value={result.approvedAt} />
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-slate-200">Expires: </dt>
              <dd className="inline">
                <Timestamp value={result.expiresAt} />
                {isReceiptExpired(result) && (
                  <span className="ml-2 text-amber-300">(expired)</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="mt-3">
            <ArtifactExport
              plan={buildConsentReceiptExport(result)}
              title="Download consent receipt"
            />
          </div>
        </div>
      )}
    </div>
  );
}
