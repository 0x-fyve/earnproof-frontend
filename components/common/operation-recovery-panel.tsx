"use client";

/**
 * Resume / safe-retry / support-reference recovery UI for an interrupted
 * idempotent operation (#254). Driven entirely by an
 * `OperationTerminalState`, so it renders identically regardless of which
 * flow (proof issuance, payment sync, and eventually #251's bulk actions)
 * produced it.
 */
import type { OperationTerminalState } from "@/lib/api/operation-status";

export interface OperationRecoveryPanelProps {
  idempotencyKey: string;
  outcome: OperationTerminalState;
  isPolling?: boolean;
  onResume: () => void;
  onRetry: () => void;
  disableRetry?: boolean;
}

const COPY: Record<
  OperationTerminalState,
  { heading: string; body: string; tone: string }
> = {
  succeeded: {
    heading: "Already completed",
    body: "This operation already finished successfully. Retrying would create a duplicate — no action needed.",
    tone: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  },
  failed: {
    heading: "Operation failed",
    body: "The server confirmed this operation did not complete. It's safe to retry.",
    tone: "border-rose-300/30 bg-rose-300/10 text-rose-200",
  },
  pending: {
    heading: "Still in progress",
    body: "The server may still be processing this request. Check its status before retrying, to avoid starting a duplicate.",
    tone: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  },
  cancelled: {
    heading: "Cancelled",
    body: "This operation was cancelled. You can safely start a new attempt.",
    tone: "border-white/15 bg-white/[0.04] text-slate-300",
  },
  unknown: {
    heading: "Status unknown",
    body: "We can't confirm whether this operation succeeded or failed. Check with support before retrying, using the reference below.",
    tone: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  },
};

export function OperationRecoveryPanel({
  idempotencyKey,
  outcome,
  isPolling = false,
  onResume,
  onRetry,
  disableRetry = false,
}: OperationRecoveryPanelProps) {
  const copy = COPY[outcome];
  // Retrying is never offered for "succeeded" (would duplicate completed
  // work) or "unknown" (true state can't be confirmed — the #254 "must not
  // claim definite failure or success" guarantee also means never
  // offering an action that assumes either).
  const canRetry = outcome === "failed" || outcome === "cancelled";
  const canResume = outcome === "pending";

  return (
    <div
      className={`grid gap-3 rounded-lg border p-4 text-sm ${copy.tone}`}
      data-testid="operation-recovery-panel"
      role="status"
    >
      <div>
        <p className="font-semibold" data-testid="operation-recovery-heading">
          {copy.heading}
        </p>
        <p className="mt-1">{copy.body}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {canResume && (
          <button
            className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="operation-recovery-resume"
            disabled={isPolling}
            onClick={onResume}
            type="button"
          >
            {isPolling ? "Checking status..." : "Check status"}
          </button>
        )}
        {canRetry && (
          <button
            className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="operation-recovery-retry"
            disabled={disableRetry}
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        )}
      </div>

      {outcome === "unknown" && (
        <p className="font-mono text-xs opacity-80" data-testid="operation-recovery-reference">
          Reference: {idempotencyKey}
        </p>
      )}
    </div>
  );
}
