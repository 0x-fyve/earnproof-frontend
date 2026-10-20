"use client";

import { useCallback } from "react";

export interface PaginationState {
  nextCursor: string | null;
  previousCursor: string | null;
  isLoading: boolean;
}

export function CursorPagination({
  state,
  onPrevious,
  onNext,
  resultCount = 0,
}: {
  state: PaginationState;
  onPrevious: () => void;
  onNext: () => void;
  resultCount?: number;
}) {
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

  return (
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
  );
}
