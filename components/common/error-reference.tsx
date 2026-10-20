"use client";

import { useState } from "react";
import type { ApiError } from "@/lib/errors";

type ErrorReferenceProps = {
  error: ApiError | Error;
};

/**
 * Displays a compact error reference with support-safe request IDs
 * Provides a copy action for easy reporting to customer support
 */
export function ErrorReference({ error }: ErrorReferenceProps) {
  const [copied, setCopied] = useState(false);

  const isApiError = error instanceof Error && "requestId" in error;
  const apiError = isApiError ? (error as ApiError) : null;

  const hasReference = apiError && (apiError.requestId || apiError.correlationId);

  if (!hasReference) {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
        <p className="text-sm leading-5 text-rose-200">{error.message}</p>
      </div>
    );
  }

  const referenceText = [
    apiError.requestId ? `Request ID: ${apiError.requestId}` : null,
    apiError.correlationId
      ? `Correlation ID: ${apiError.correlationId}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referenceText);
      setCopied(true);
      // Reset after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API might fail in some contexts, silently ignore
    }
  };

  return (
    <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-rose-200">
            {error.message}
          </p>
          <div className="mt-2 space-y-1 text-xs text-rose-200/80">
            {apiError.requestId && (
              <p className="font-mono">
                Request ID: {apiError.requestId}
              </p>
            )}
            {apiError.correlationId && (
              <p className="font-mono">
                Correlation ID: {apiError.correlationId}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-rose-200/70">
            Include this reference when contacting support.
          </p>
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
