"use client";

/**
 * Selection toolbar for a bulk-action-enabled table (#251). Pure
 * presentation over lib/bulk-actions/use-bulk-selection.ts's state —
 * "select all" here only ever means "select all currently visible rows,"
 * per that module's scoping contract. This component never knows about,
 * and never offers, a cross-page/cross-filter "select everything" action.
 */
export interface BulkActionToolbarProps {
  selectedCount: number;
  visibleCount: number;
  isAllVisibleSelected: boolean;
  isSomeVisibleSelected: boolean;
  onSelectAllVisible: () => void;
  onClear: () => void;
  onReview: () => void;
  actionLabel: string;
  disabled?: boolean;
}

export function BulkActionToolbar({
  selectedCount,
  visibleCount,
  isAllVisibleSelected,
  isSomeVisibleSelected,
  onSelectAllVisible,
  onClear,
  onReview,
  actionLabel,
  disabled = false,
}: BulkActionToolbarProps) {
  if (visibleCount === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3"
      data-testid="bulk-action-toolbar"
    >
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            aria-label="Select all visible rows"
            checked={isAllVisibleSelected}
            data-testid="bulk-select-all-visible"
            onChange={onSelectAllVisible}
            ref={(el) => {
              if (el) el.indeterminate = isSomeVisibleSelected && !isAllVisibleSelected;
            }}
            type="checkbox"
          />
          Select all {visibleCount} visible
        </label>
        <span aria-live="off" className="text-xs text-slate-400" data-testid="bulk-selection-count">
          {selectedCount} selected
        </span>
        {selectedCount > 0 && (
          <button
            className="text-xs text-cyan-300 hover:text-cyan-200"
            onClick={onClear}
            type="button"
          >
            Clear selection
          </button>
        )}
      </div>
      <button
        className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="bulk-action-review-button"
        disabled={disabled || selectedCount === 0}
        onClick={onReview}
        type="button"
      >
        {actionLabel} ({selectedCount})
      </button>
    </div>
  );
}
