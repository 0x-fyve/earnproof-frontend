"use client";

import { useCallback } from "react";

export interface PaginationState {
  /** Opaque, server-signed cursor. The client never decodes or edits it. */
  nextCursor: string | null;
  /** Opaque, server-signed cursor. The client never decodes or edits it. */
  previousCursor: string | null;
  isLoading: boolean;
}

export interface CursorRecoveryNotice {
  /** Human-readable reason for the restart. */
  message: string;
  /** Optional support reference (code + request ID). */
  supportReference?: string;
}

export function CursorPolicyNotice({
  notice,
}: {
  notice: CursorRecoveryNotice | null;
}) {
  if (!notice) return null;

  return (
    <div
      className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm leading-5 text-amber-200">{notice.message}</p>
      {notice.supportReference ? (
        <p className="mt-1 font-mono text-xs text-amber-200/70">
          {notice.supportReference}
        </p>
      ) : null}
    </div>
  );
}

export function CursorPagination({
  state,
  onPrevious,
  onNext,
  resultCount = 0,
  notice = null,
}: {
  state: PaginationState;
  onPrevious: () => void;
  onNext: () => void;
  resultCount?: number;
  notice?: CursorRecoveryNotice | null;
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
    <div className="grid gap-3">
      <CursorPolicyNotice notice={notice} />
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={handlePreviousClick}
          disabled={isDisabled || !hasPrevious}
          aria-label="Previous page"
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-55 hover:bg-white/5 transition"
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
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-55 hover:bg-white/5 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}
