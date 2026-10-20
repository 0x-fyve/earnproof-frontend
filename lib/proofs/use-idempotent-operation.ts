"use client";

/**
 * React hook wrapper over lib/proofs/idempotent-operation.ts, intended as
 * the one entry point every mutation flow that needs idempotency/recovery
 * should use (proof issuance and payment sync in this pass; a future #251
 * bulk-action flow should use this same hook rather than reimplementing
 * key generation or polling — see the module doc on idempotent-operation.ts
 * for exactly how).
 */
import { useCallback, useRef, useState } from "react";
import {
  clearOperationRecord,
  markOperationState,
  pollUntilTerminal,
  resolveOperationKey,
  resolveOperationOutcome,
  type OperationIntent,
  type OperationKind,
  type OperationRecord,
} from "./idempotent-operation";
import type { OperationTerminalState } from "@/lib/api/operation-status";

export interface UseIdempotentOperationResult {
  /** The active (or most recently resolved) operation record, if any. */
  record: OperationRecord | null;
  /** Safe collapse of record.lastKnownState + expiry — never a false
   * success/failure for an expired or unresolvable record. */
  outcome: OperationTerminalState | null;
  /**
   * Obtains the key for a new attempt: reuses the existing key if `intent`
   * matches an in-flight/unresolved attempt for this tenant, otherwise
   * mints a new one. Call this immediately before sending the mutation.
   */
  begin: (intent: OperationIntent) => OperationRecord;
  /** Call once the mutation's own response is known. */
  markSucceeded: () => void;
  markFailed: () => void;
  markCancelled: () => void;
  /** Bounded poll against the status endpoint for the current record. */
  resume: (token: string) => Promise<void>;
  /** Drops the current record, so the next `begin()` call always mints a
   * fresh key even for an identical intent (used after a terminal outcome
   * the caller doesn't want to offer "resume" for any longer). */
  reset: () => void;
  isPolling: boolean;
}

export function useIdempotentOperation(
  tenantId: string,
  kind: OperationKind,
): UseIdempotentOperationResult {
  const [record, setRecord] = useState<OperationRecord | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const recordRef = useRef<OperationRecord | null>(null);

  const begin = useCallback(
    (intent: OperationIntent) => {
      const next = resolveOperationKey(tenantId, kind, intent);
      recordRef.current = next;
      setRecord(next);
      return next;
    },
    [tenantId, kind],
  );

  const mark = useCallback((state: OperationTerminalState) => {
    const current = recordRef.current;
    if (!current) return;
    markOperationState(current.idempotencyKey, state);
    const updated = { ...current, lastKnownState: state, updatedAt: new Date().toISOString() };
    recordRef.current = updated;
    setRecord(updated);
  }, []);

  const markSucceeded = useCallback(() => mark("succeeded"), [mark]);
  const markFailed = useCallback(() => mark("failed"), [mark]);
  const markCancelled = useCallback(() => mark("cancelled"), [mark]);

  const resume = useCallback(async (token: string) => {
    const current = recordRef.current;
    if (!current) return;
    setIsPolling(true);
    try {
      await pollUntilTerminal(current, token);
    } finally {
      setIsPolling(false);
      // Re-read via resolveOperationOutcome so expiry during the poll is
      // reflected even if the record's own lastKnownState says "pending".
      const refreshed = recordRef.current;
      if (refreshed) {
        setRecord({ ...refreshed });
      }
    }
  }, []);

  const reset = useCallback(() => {
    const current = recordRef.current;
    if (current) {
      clearOperationRecord(current.idempotencyKey);
    }
    recordRef.current = null;
    setRecord(null);
  }, []);

  return {
    record,
    outcome: record ? resolveOperationOutcome(record) : null,
    begin,
    markSucceeded,
    markFailed,
    markCancelled,
    resume,
    reset,
    isPolling,
  };
}
