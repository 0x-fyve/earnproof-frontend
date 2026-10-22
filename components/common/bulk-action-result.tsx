"use client";

/**
 * Result UI for a completed (or cancelled) bulk action (#251).
 *
 * The central acceptance criterion this component exists to satisfy:
 * partial success must NEVER be rendered as "the whole operation
 * succeeded." It renders strictly off `result.outcome`
 * (lib/bulk-actions/execute-bulk-action.ts's `classifyOutcome`), which has
 * exactly four values — full-success, partial-success, full-failure,
 * cancelled — and each gets its own heading, tone, and (for
 * partial/full-failure) a per-item failure list plus a retry action scoped
 * to only the failed, retryable items.
 */
import type { BulkActionResult } from "@/lib/bulk-actions/execute-bulk-action";
import { retryableItemIds } from "@/lib/bulk-actions/execute-bulk-action";

export interface BulkActionResultProps {
  result: BulkActionResult;
  /** Maps an item ID back to a human label for display. */
  getItemLabel: (itemId: string) => string;
  onRetryFailed: (retryableIds: string[]) => void;
  onDismiss: () => void;
  isRetrying?: boolean;
}

const OUTCOME_COPY: Record<
  BulkActionResult["outcome"],
  { heading: string; tone: string }
> = {
  "full-success": {
    heading: "All items completed successfully",
    tone: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  },
  "partial-success": {
    heading: "Some items could not be completed",
    tone: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  },
  "full-failure": {
    heading: "No items were completed",
    tone: "border-rose-300/30 bg-rose-300/10 text-rose-200",
  },
  cancelled: {
    heading: "Action cancelled",
    tone: "border-white/15 bg-white/[0.04] text-slate-300",
  },
};

export function BulkActionResult({
  result,
  getItemLabel,
  onRetryFailed,
  onDismiss,
  isRetrying = false,
}: BulkActionResultProps) {
  const copy = OUTCOME_COPY[result.outcome];
  const failedItems = result.items.filter((item) => item.status === "failed");
  const skippedItems = result.items.filter((item) => item.status === "skipped");
  const succeededCount = result.items.filter((item) => item.status === "succeeded").length;
  const retryable = retryableItemIds(result);

  return (
    <div
      className={`grid gap-3 rounded-lg border p-4 text-sm ${copy.tone}`}
      data-testid="bulk-action-result"
      role="status"
    >
      <div>
        <p className="font-semibold" data-testid="bulk-action-result-heading">
          {copy.heading}
        </p>
        <p className="mt-1 text-xs opacity-90">
          {succeededCount} succeeded, {failedItems.length} failed
          {skippedItems.length > 0 ? `, ${skippedItems.length} skipped` : ""} of {result.items.length} total.
        </p>
      </div>

      {(failedItems.length > 0 || skippedItems.length > 0) && (
        <ul className="grid gap-1 text-xs" data-testid="bulk-action-result-failures">
          {failedItems.map((item) => (
            <li data-testid={`bulk-result-item-${item.itemId}`} key={item.itemId}>
              {getItemLabel(item.itemId)}: {item.reason}
              {!item.retryable && " (not retryable)"}
            </li>
          ))}
          {skippedItems.map((item) => (
            <li data-testid={`bulk-result-item-${item.itemId}`} key={item.itemId}>
              {getItemLabel(item.itemId)}: {item.reason}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        {retryable.length > 0 && (
          <button
            className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="bulk-action-retry-failed"
            disabled={isRetrying}
            onClick={() => onRetryFailed(retryable)}
            type="button"
          >
            {isRetrying ? "Retrying..." : `Retry ${retryable.length} failed item${retryable.length === 1 ? "" : "s"}`}
          </button>
        )}
        <button
          className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold hover:bg-white/10"
          data-testid="bulk-action-dismiss"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
