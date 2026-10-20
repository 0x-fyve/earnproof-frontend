"use client";

import { useCallback } from "react";
import type { PaginationFilters } from "@/lib/query/pagination-recovery";

export interface PaginationState {
  nextCursor: string | null;
  previousCursor: string | null;
  isLoading: boolean;
  /**
   * Filters active when this page was issued. Preserved across a
   * recovery restart so the user does not lose context.
   */
  filters?: PaginationFilters;
  /** Stable identifier for the current view. */
  viewKey?: string;
}

export interface PaginationRecoveryInfo {
  /** Server-classified cursor error code. */
  code: string;
  /** User-facing message explaining the recovery. */
  message: string;
  /** Support-safe reference for reporting. */
  reference?: { requestId?: string; correlationId?: string };
}

export interface CursorPaginationProps {
  state: PaginationState;
  onPrevious: () => void;
  onNext: () => void;
  /** Restart from the first page with the current filters preserved. */
  onRestart?: () => void;
  resultCount?: number;
  /** Recovery information when a cursor failure occurred. */
  recovery?: PaginationRecoveryInfo | null;
}

export function CursorPagination({
  state,
  onPrevious,
  onNext,
  onRestart,
  resultCount = 0,
  recovery = null,
}: CursorPaginationProps) {
  const hasPrevious = state.previousCursor !== null;
  const hasNext = state.nextCursor !== null;
  const isDisabled = state.isLoading;

  const handlePreviousClick = useCallback(() => {
    if (!isDisabled && hasPrevious) {
      onPrevious();
    }
  }, [isDisabled, hasPrevious, onPrevious]);

  const handleNextClick = useCallback(() => {
    if (!isDisabled && hasNext) {
      onNext();
    }
  }, [isDisabled, hasNext, onNext]);

  const handleRestartClick = useCallback(() => {
    if (!isDisabled && onRestart) {
      onRestart();
    }
  }, [isDisabled, onRestart]);

  const referenceText = recovery?.reference
    ? [
        recovery.reference.requestId
          ? `Request ID: ${recovery.reference.requestId}`
          : null,
        recovery.reference.correlationId
          ? `Correlation ID: ${recovery.reference.correlationId}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <div className="flex flex-col gap-3">
      {recovery && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3"
        >
          <p className="text-sm leading-5 text-amber-200">
            {recovery.message}
          </p>
          {referenceText && (
            <p className="mt-2 font-mono text-xs text-amber-200/80">
              {referenceText}
            </p>
          )}
          {onRestart && (
            <button
              type="button"
              onClick={handleRestartClick}
              disabled={isDisabled}
              aria-label="Restart from first page"
              className="mt-2 h-8 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 text-xs font-semibold text-amber-200 transition hover:bg-amber-300/20 disabled:opacity-50"
            >
              Restart from first page
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <button
          onClick={handlePreviousClick}
          disabled={isDisabled || !hasPrevious}
          aria-label="Previous page"
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50 hover:bg-white/5 transition"
        >
          Previous
        </button>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>
            {resultCount > 0 ? (
              <>
                Showing <span className="font-semibold">{resultCount}</span>{" "}
                result{resultCount === 1 ? "" : "s"}
              </>
            ) : (
              "No results"
            )}
          </span>
        </div>

        <button
          onClick={handleNextClick}
          disabled={isDisabled || !hasNext}
          aria-label="Next page"
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50 hover:bg-white/5 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}
