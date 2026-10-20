"use client";

/**
 * Progress UI during bulk-action execution (#251). Shown while
 * `runBulkAction` (lib/bulk-actions/execute-bulk-action.ts) is working
 * through the selected items sequentially.
 */
export interface BulkActionProgressProps {
  completed: number;
  total: number;
  onCancel: () => void;
  isCancelling?: boolean;
}

export function BulkActionProgress({
  completed,
  total,
  onCancel,
  isCancelling = false,
}: BulkActionProgressProps) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div
      className="grid gap-3 rounded-lg border border-white/10 bg-slate-900 p-4"
      data-testid="bulk-action-progress"
      role="status"
    >
      <div className="flex items-center justify-between text-sm text-slate-200">
        <span aria-live="polite">
          Processing {completed} of {total}...
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-end">
        <button
          className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="bulk-action-cancel"
          disabled={isCancelling}
          onClick={onCancel}
          type="button"
        >
          {isCancelling ? "Cancelling..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}
