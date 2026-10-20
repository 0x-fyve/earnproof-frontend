"use client";

import { useEffect, useRef , useState } from "react";
import type { ApiError } from "@/lib/errors";

type ErrorReferenceProps = {
  error: ApiError | Error;
  /**
   * Optional callback invoked when the user acknowledges a stale or
   * invalid cursor and wishes to restart pagination from the first page.
   * The client must never re-use the failed cursor contents.
   */
  onRestart?: () => void;
  /** Optional label for the restart action. */
  restartLabel?: string;
};

const COPY_RESET_MS = 2000;

const SUPPORT_HINT =
  "Include this reference when contacting support.";

/**
 * Displays a compact error reference with support-safe request IDs.
 * Provides a copy action for easy reporting to customer support.
 *
 * When the error indicates an invalid or expired cursor, an optional
 * restart action is rendered. The client never edits or trusts cursor
 * contents; restarting always requests the first page and relies on the
 * server to re-authorize the tenant scope.
 */
export function ErrorReference({
  error,
  onRestart,
  restartLabel = "Restart from first page",
}: ErrorReferenceProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const isApiError = error instanceof Error && "requestId" in error;
  const apiError = isApiError ? (error as ApiError) : null;

  const hasReference = Boolean(
    apiError && (apiError.requestId || apiError.correlationId),
  );

  // Determine whether this error represents a cursor failure that can be
  // safely recovered by restarting pagination. The client never inspects
  // cursor contents to make this decision — it relies on the server-set
  // error code only.
  const isCursorError = Boolean(apiError && apiError.code === "INVALID_CURSOR");
  const canRestart = isCursorError && typeof onRestart === "function";

  const referenceText = hasReference
    ? [
        apiError?.requestId ? `Request ID: ${apiError.requestId}` : null,
        apiError?.correlationId
          ? `Correlation ID: ${apiError.correlationId}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const handleCopy = async () => {
    if (!referenceText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(referenceText);
      setCopied(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, COPY_RESET_MS);
    } catch {
      // Clipboard API might fail in some contexts, silently ignore
    }
  };

  if (!hasReference) {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
        <p className="text-sm leading-5 text-rose-200">{error.message}</p>
        {canRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            {restartLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-rose-200">
            {error.message}
          </p>
          <div className="mt-2 space-y-1 text-xs text-rose-200/80">
            {apiError?.requestId && (
              <p className="font-mono">
                Request ID: {apiError.requestId}
              </p>
            )}
            {apiError?.correlationId && (
              <p className="font-mono">
                Correlation ID: {apiError.correlationId}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-rose-200/70">
            {SUPPORT_HINT}
          </p>
          {canRestart && (
            <button
              type="button"
              onClick={onRestart}
              className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              {restartLabel}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy error reference"
          className="flex-shrink-0 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          {copied ? (
            <span className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Copied
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
