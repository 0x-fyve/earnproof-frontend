"use client";

import { useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { BatchCredentialDropZone } from "./batch-credential-drop-zone";
import {
  BatchCredentialItemRow,
  type BatchItem,
} from "./batch-credential-item-row";
import type { VerifyProofResponse } from "./verification-panel";
import {
  checkBatchFile,
  acceptBatchItem,
  MAX_BATCH_ITEMS,
  MAX_BATCH_TOTAL_BYTES,
} from "@/lib/validation/batch-credential-verification";

/**
 * Batch credential verification workspace (#183). Every item's raw text
 * and result live only in this component's React state: nothing is
 * written to localStorage or any other persistent store, so credential
 * content does not survive a page close, per "credential content is not
 * persisted after the page closes".
 */
export function BatchCredentialWorkspace() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [manualJson, setManualJson] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledRef = useRef(false);

  const totalBytes = useRef(0);

  function addItem(item: BatchItem) {
    setItems((prev) => [...prev, item]);
  }

  function updateItem(key: string, patch: Partial<BatchItem>) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function existingIds(): string[] {
    return items
      .map((item) => item.credentialId)
      .filter((id): id is string => id !== null);
  }

  async function handleFilesSelected(files: File[]) {
    setBatchError(null);

    for (const file of files) {
      const check = checkBatchFile(file, items.length, totalBytes.current);
      if (!check.ok) {
        const reason =
          check.reason === "too-many-items"
            ? `Batch limit reached (${MAX_BATCH_ITEMS} items max).`
            : check.reason === "batch-too-large"
              ? `Batch size limit reached (${Math.round(MAX_BATCH_TOTAL_BYTES / 1024)} KB max combined).`
              : check.reason === "oversized"
                ? "File exceeds the per-file size limit."
                : check.reason === "empty"
                  ? "File is empty."
                  : "Only .json credential files are supported.";

        addItem({
          key: `${file.name}-${crypto.randomUUID()}`,
          source: "file",
          label: file.name,
          credentialId: null,
          status: "rejected",
          rejectReason: reason,
        });
        continue;
      }

      totalBytes.current += file.size;

      const text = await readFileAsText(file);
      if (text === null) {
        addItem({
          key: `${file.name}-${crypto.randomUUID()}`,
          source: "file",
          label: file.name,
          credentialId: null,
          status: "rejected",
          rejectReason: "Could not read file contents.",
        });
        continue;
      }

      const accepted = acceptBatchItem(text, existingIds());
      if (!accepted.ok) {
        const reason =
          accepted.reason === "malformed"
            ? "Enter valid credential JSON."
            : accepted.reason === "missing-id"
              ? "Credential JSON must include a valid id."
              : "This credential id is already in the batch.";

        addItem({
          key: `${file.name}-${crypto.randomUUID()}`,
          source: "file",
          label: file.name,
          credentialId: null,
          status: "rejected",
          rejectReason: reason,
        });
        continue;
      }

      addItem({
        key: `${file.name}-${crypto.randomUUID()}`,
        source: "file",
        label: `${file.name} (${accepted.id})`,
        credentialId: accepted.id,
        status: "pending",
      });
    }
  }

  function handleAddManualEntry() {
    setBatchError(null);

    if (items.length >= MAX_BATCH_ITEMS) {
      setBatchError(`Batch limit reached (${MAX_BATCH_ITEMS} items max).`);
      return;
    }

    const accepted = acceptBatchItem(manualJson, existingIds());
    if (!accepted.ok) {
      const reason =
        accepted.reason === "malformed"
          ? "Enter valid credential JSON."
          : accepted.reason === "missing-id"
            ? "Credential JSON must include a valid id."
            : "This credential id is already in the batch.";
      setBatchError(reason);
      return;
    }

    addItem({
      key: `manual-${crypto.randomUUID()}`,
      source: "manual",
      label: `Manual entry (${accepted.id})`,
      credentialId: accepted.id,
      status: "pending",
    });
    setManualJson("");
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key));
    abortControllersRef.current.get(key)?.abort();
    abortControllersRef.current.delete(key);
  }

  function clearBatch() {
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    totalBytes.current = 0;
    setItems([]);
    setBatchError(null);
  }

  async function verifyItem(item: BatchItem) {
    if (!item.credentialId) {
      return;
    }

    const controller = new AbortController();
    abortControllersRef.current.set(item.key, controller);
    updateItem(item.key, { status: "verifying" });

    try {
      const response = await apiClient<VerifyProofResponse>({
        path: `/proofs/${encodeURIComponent(item.credentialId)}/verify`,
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
    cancelledRef.current = false;
    setIsVerifying(true);

    const pending = items.filter((item) => item.status === "pending");
    await Promise.all(pending.map((item) => verifyItem(item)));

    setIsVerifying(false);
  }

  /**
   * Retries only the items that failed (network/server error), leaving
   * rejected (client-side validation), verified, and cancelled items
   * untouched. Re-verifying resets a failed item back to "pending" first
   * so verifyItem's existing per-item flow runs unchanged.
   */
  async function retryFailed() {
    setBatchError(null);
    cancelledRef.current = false;
    setIsVerifying(true);

    const failed = items.filter((item) => item.status === "failed");
    setItems((prev) =>
      prev.map((item) =>
        item.status === "failed" ? { ...item, status: "pending" } : item,
      ),
    );
    await Promise.all(
      failed.map((item) => verifyItem({ ...item, status: "pending" })),
    );

    setIsVerifying(false);
  }

  function cancelAll() {
    cancelledRef.current = true;
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    setIsVerifying(false);
  }

  /**
   * Exports the batch's failed items as a JSON file the caller can fix up
   * and re-import via "Or paste credential JSON" / drag-and-drop, without
   * needing to re-locate which of the original inputs failed. Only
   * `credentialId` and `label` are included — never raw credential JSON or
   * verification results, consistent with this workspace never persisting
   * credential content beyond the page's lifetime.
   */
  function exportFailed() {
    const failed = items.filter((item) => item.status === "failed");
    if (failed.length === 0) {
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      failedItems: failed.map((item) => ({
        credentialId: item.credentialId,
        label: item.label,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `batch-verification-failures-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const canVerify =
    items.some((item) => item.status === "pending") && !isVerifying;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const canRetryFailed = failedCount > 0 && !isVerifying;

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Add credentials</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Upload up to {MAX_BATCH_ITEMS} .json credential files, or paste
            entries manually. Nothing here is saved once you leave this page.
          </p>
        </div>

        <BatchCredentialDropZone
          onFilesSelected={handleFilesSelected}
          disabled={isVerifying}
        />

        <div className="grid gap-2">
          <label
            className="text-xs font-semibold text-slate-300"
            htmlFor="batch-manual-entry"
          >
            Or paste credential JSON
          </label>
          <textarea
            id="batch-manual-entry"
            className="h-24 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white"
            value={manualJson}
            onChange={(event) => setManualJson(event.target.value)}
            disabled={isVerifying}
          />
          <button
            type="button"
            onClick={handleAddManualEntry}
            disabled={isVerifying || !manualJson.trim()}
            className="h-9 w-fit rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Add entry
          </button>
        </div>

        {batchError && (
          <p className="text-sm text-rose-200" role="alert">
            {batchError}
          </p>
        )}
      </section>

      {items.length > 0 && (
        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">
              Batch ({items.length})
            </h2>
            <div className="flex gap-2">
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
              {failedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => void retryFailed()}
                    disabled={!canRetryFailed}
                    className="h-9 rounded-md border border-amber-300/40 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"
                  >
                    Retry failed ({failedCount})
                  </button>
                  <button
                    type="button"
                    onClick={exportFailed}
                    disabled={isVerifying}
                    className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Export failed
                  </button>
                </>
              )}
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

          <ul className="grid gap-2" aria-label="Batch verification results">
            {items.map((item) => (
              <li
                key={item.key}
                className="grid grid-cols-[1fr_auto] items-start gap-2"
              >
                <BatchCredentialItemRow item={item} />
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  disabled={item.status === "verifying"}
                  className="h-6 rounded-md border border-white/15 px-2 text-xs text-slate-300 disabled:opacity-50"
                  aria-label={`Remove ${item.label}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
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
