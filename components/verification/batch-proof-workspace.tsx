"use client";

import { useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { BatchProofRow, type BatchProofItem } from "./batch-proof-row";
import type { VerifyProofResponse } from "./verification-panel";
import { downloadTextFile, isSafeExportFilename } from "@/lib/credentials/export";
import { parseBatchProofInput, MAX_BATCH_ITEMS } from "@/lib/validation/batch-proof-verification";

const EXPORT_FILENAME = "earnproof-batch-verification-results.json";

/**
 * Batch proof verification workspace (#182). Accepts pasted or uploaded
 * text (one identifier or verification link per line), previews
 * normalized identifiers and duplicates before any request is sent, then
 * verifies each independently against the real
 * GET /proofs/{id}/verify endpoint used by verify-proof-form.tsx.
 */
export function BatchProofWorkspace() {
  const [rawInput, setRawInput] = useState("");
  const [items, setItems] = useState<BatchProofItem[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function buildPreview(text: string) {
    setBatchError(null);
    const rows = parseBatchProofInput(text);
    setItems(
      rows.map((row, index) => ({
        key: `${index}-${row.raw}`,
        raw: row.raw,
        normalizedId: row.normalizedId,
        status: row.status === "VALID_ID" ? "pending" : row.status === "DUPLICATE" ? "duplicate" : "invalid",
      })),
    );
  }

  function handlePreview() {
    if (!rawInput.trim()) {
      setBatchError("Paste or upload at least one identifier.");
      return;
    }
    buildPreview(rawInput);
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const text = await readFileAsText(file);
    if (text === null) {
      setBatchError("Could not read the uploaded file.");
      return;
    }

    setRawInput(text);
    buildPreview(text);
  }

  function updateItem(key: string, patch: Partial<BatchProofItem>) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function verifyItem(item: BatchProofItem) {
    if (!item.normalizedId) {
      return;
    }

    const controller = new AbortController();
    abortControllersRef.current.set(item.key, controller);
    updateItem(item.key, { status: "verifying" });

    try {
      const response = await apiClient<VerifyProofResponse>({
        path: `/proofs/${encodeURIComponent(item.normalizedId)}/verify`,
        signal: controller.signal,
      });

      if (cancelledRef.current) {
        updateItem(item.key, { status: "cancelled" });
        return;
      }

      updateItem(item.key, { status: "verified", result: response });
    } catch {
      if (cancelledRef.current) {
        updateItem(item.key, { status: "cancelled" });
        return;
      }
      updateItem(item.key, { status: "failed" });
    } finally {
      abortControllersRef.current.delete(item.key);
    }
  }

  async function verifyAll() {
    setBatchError(null);
    setShowSummary(false);
    cancelledRef.current = false;
    setIsVerifying(true);

    // Defense in depth: parseBatchProofInput already caps a single preview
    // at MAX_BATCH_ITEMS, but the batch limit must still be enforced here,
    // at submission time, not only when the preview was first built
    // (#324's "batch limits must be enforced before and after submission"),
    // in case `items` is ever extended past the cap some other way.
    const pending = items.filter((item) => item.status === "pending").slice(0, MAX_BATCH_ITEMS);
    await Promise.all(pending.map((item) => verifyItem(item)));

    // A cancelled run already shows each item's own "Cancelled" status; a
    // summary on top of that would misleadingly describe a run that never
    // finished, so it's suppressed here rather than in the render (#324's
    // "partial failures must never be summarized as complete success").
    if (!cancelledRef.current) {
      setShowSummary(true);
    }
    setIsVerifying(false);
  }

  function cancelAll() {
    cancelledRef.current = true;
    setShowSummary(false);
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    setIsVerifying(false);
  }

  function clearBatch() {
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    setItems([]);
    setRawInput("");
    setBatchError(null);
    setShowSummary(false);
  }

  /** Re-queues every failed item as pending so verifyAll() picks it back up, without touching already-verified or still-invalid rows. */
  function retryFailed() {
    setShowSummary(false);
    setItems((prev) => prev.map((item) => (item.status === "failed" ? { ...item, status: "pending" } : item)));
  }

  function exportResults() {
    const exportable = items
      .filter((item) => item.status === "verified" && item.result)
      .map((item) => ({ proofId: item.normalizedId, result: item.result!.result, status: item.result!.status }));

    const plan = {
      filename: isSafeExportFilename(EXPORT_FILENAME) ? EXPORT_FILENAME : "earnproof-batch-results.json",
      includedFields: ["proofId", "result", "status"],
      warnings: [],
      body: JSON.stringify(exportable, null, 2),
      mimeType: "application/json",
    };

    downloadTextFile(plan);
  }

  const canVerify = items.some((item) => item.status === "pending") && !isVerifying;
  const hasVerifiedResults = items.some((item) => item.status === "verified");
  const failedCount = items.filter((item) => item.status === "failed").length;
  const verifiedCount = items.filter((item) => item.status === "verified").length;
  const hasFailedItems = failedCount > 0;

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Add proof identifiers</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Paste or upload up to {MAX_BATCH_ITEMS} proof identifiers or verification links, one
            per line.
          </p>
        </div>

        <label className="grid gap-2" htmlFor="batch-proof-input">
          <span className="text-xs font-semibold text-slate-300">Proof identifiers</span>
          <textarea
            id="batch-proof-input"
            className="h-32 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white"
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            disabled={isVerifying}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePreview}
            disabled={isVerifying}
            className="h-9 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isVerifying}
            className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,text/plain"
            className="sr-only"
            aria-label="Upload proof identifiers file"
            onChange={(event) => void handleFileUpload(event)}
          />
        </div>

        {batchError && (
          <p className="text-sm text-rose-200" role="alert">
            {batchError}
          </p>
        )}
      </section>

      {items.length > 0 && (
        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-white">Batch ({items.length})</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void verifyAll()}
                disabled={!canVerify}
                className="h-9 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"
              >
                {isVerifying ? "Verifying..." : "Verify all"}
              </button>
              {isVerifying && (
                <button
                  type="button"
                  onClick={cancelAll}
                  className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={exportResults}
                disabled={!hasVerifiedResults}
                className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                Export results
              </button>
              <button
                type="button"
                onClick={clearBatch}
                disabled={isVerifying}
                className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                Clear batch
              </button>
            </div>
          </div>

          {showSummary && (
            <div
              className={`rounded-md border p-3 text-sm ${
                hasFailedItems
                  ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                  : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
              }`}
              role="status"
              aria-live="polite"
            >
              {hasFailedItems ? (
                <>
                  Batch finished with errors: {verifiedCount} verified, {failedCount} failed. No
                  result is complete until every item has been retried or acknowledged.
                </>
              ) : (
                <>Batch finished: all {verifiedCount} item{verifiedCount === 1 ? "" : "s"} verified successfully.</>
              )}
            </div>
          )}

          <ul className="grid gap-2" aria-label="Batch proof verification results">
            {items.map((item) => (
              <BatchProofRow key={item.key} item={item} />
            ))}
          </ul>

          {hasFailedItems && !isVerifying && (
            <button
              type="button"
              onClick={retryFailed}
              className="h-9 w-fit rounded-md border border-amber-300/30 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-300/10"
            >
              Retry {failedCount} failed item{failedCount === 1 ? "" : "s"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function readFileAsText(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      resolve(typeof result === "string" ? result : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
