"use client";

/**
 * Review/confirmation step for a bulk admin action (#251). Lists exactly
 * which resources will be affected and states the destructive consequence
 * in plain language before anything is submitted. Items the caller has
 * already determined are stale (changed/disappeared since selection) or
 * not authorized for the actor are shown as explicitly excluded, never
 * silently dropped and never silently included.
 */
import { useEffect, useRef } from "react";

export interface BulkReviewItem {
  id: string;
  label: string;
  /** Present when this item will NOT be submitted — e.g. it went stale or
   * the actor isn't authorized for it. Review must show this, not hide the
   * row. */
  excludedReason?: string;
}

export interface BulkActionReviewDialogProps {
  title: string;
  /** Plain-language statement of what will happen and why it matters
   * (e.g. "This will permanently remove 3 members from Acme Corp."). */
  consequence: string;
  items: BulkReviewItem[];
  confirmText?: string;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkActionReviewDialog({
  title,
  consequence,
  items,
  confirmText = "Confirm",
  isSubmitting = false,
  onConfirm,
  onCancel,
}: BulkActionReviewDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onCancel();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel, isSubmitting]);

  const includedItems = items.filter((item) => !item.excludedReason);
  const excludedItems = items.filter((item) => item.excludedReason);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        aria-describedby="bulk-review-description"
        aria-labelledby="bulk-review-title"
        aria-modal="true"
        className="grid w-full max-w-lg gap-4 rounded-lg border border-white/10 bg-slate-900 p-6 shadow-xl"
        role="dialog"
      >
        <div>
          <h2 className="text-lg font-semibold text-white" id="bulk-review-title">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300" id="bulk-review-description">
            {consequence}
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border border-white/10">
          <ul className="divide-y divide-white/10">
            {includedItems.map((item) => (
              <li
                className="px-3 py-2 text-sm text-slate-200"
                data-testid={`bulk-review-item-${item.id}`}
                key={item.id}
              >
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        {excludedItems.length > 0 && (
          <div
            className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3"
            data-testid="bulk-review-excluded"
            role="status"
          >
            <p className="text-xs font-semibold text-amber-100">
              {excludedItems.length} item{excludedItems.length === 1 ? "" : "s"} excluded from this action
            </p>
            <ul className="mt-1 grid gap-1 text-xs text-amber-100/90">
              {excludedItems.map((item) => (
                <li data-testid={`bulk-review-excluded-${item.id}`} key={item.id}>
                  {item.label}: {item.excludedReason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            className="h-10 rounded-md border border-white/15 px-4 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
            disabled={isSubmitting}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-md bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            data-testid="bulk-review-confirm"
            disabled={isSubmitting || includedItems.length === 0}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? "Processing..." : `${confirmText} (${includedItems.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
