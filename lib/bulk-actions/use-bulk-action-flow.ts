"use client";

/**
 * Orchestrates the review -> confirm -> execute -> result lifecycle of a
 * bulk admin action (#251), composing three existing mechanisms rather
 * than inventing parallel ones:
 *
 * - lib/proofs/use-idempotent-operation.ts's `useIdempotentOperation`
 *   (#254) for the operation's idempotency key. `begin()` is called with
 *   an intent keyed on the batch's sorted item IDs, so re-submitting the
 *   identical batch (double-click, re-render, accidental double submit)
 *   reuses the same key rather than minting a new one — this is the
 *   "duplicate submission" guarantee.
 * - lib/a11y/announcer-context.tsx's `useAnnounce()` (#252) for every
 *   status-change announcement (review opened, execution started,
 *   progress, final outcome) — no separate aria-live region is rendered
 *   here.
 * - lib/bulk-actions/execute-bulk-action.ts's `runBulkAction` for the
 *   actual per-item execution and result classification.
 */
import { useCallback, useRef, useState } from "react";
import { useAnnounce } from "@/lib/a11y/announcer-context";
import { useIdempotentOperation } from "@/lib/proofs/use-idempotent-operation";
import {
  runBulkAction,
  type BulkActionResult,
  type BulkItemOutcome,
} from "./execute-bulk-action";

export type BulkActionPhase = "idle" | "reviewing" | "executing" | "result";

export interface UseBulkActionFlowOptions {
  tenantId: string;
  /** A stable name for this specific action (e.g. "remove-members",
   * "change-role-admin") — part of the idempotency intent, so a bulk
   * remove and a bulk role-change over the same IDs never share a key. */
  actionName: string;
  performAction: (itemId: string) => Promise<void>;
}

export interface UseBulkActionFlowResult {
  phase: BulkActionPhase;
  progress: { completed: number; total: number };
  result: BulkActionResult | null;
  startReview: () => void;
  cancelReview: () => void;
  confirmAndExecute: (itemIds: readonly string[]) => Promise<void>;
  cancelExecution: () => void;
  dismissResult: () => void;
  isPolling: boolean;
}

export function useBulkActionFlow(options: UseBulkActionFlowOptions): UseBulkActionFlowResult {
  const { tenantId, actionName, performAction } = options;
  const { announce } = useAnnounce();
  const operation = useIdempotentOperation(tenantId, "bulk-action");

  const [phase, setPhase] = useState<BulkActionPhase>("idle");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<BulkActionResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startReview = useCallback(() => {
    setPhase("reviewing");
    announce("Review the items affected by this action before confirming.");
  }, [announce]);

  const cancelReview = useCallback(() => {
    setPhase("idle");
  }, []);

  const confirmAndExecute = useCallback(
    async (itemIds: readonly string[]) => {
      // Duplicate-submission guard: resolveOperationKey (via `begin`) reuses
      // the existing record's key when this exact tenant+kind+intent is
      // already in flight/unresolved, so a second click here never mints a
      // second key for the same batch.
      const record = operation.begin({ actionName, targetIds: [...itemIds] });

      setPhase("executing");
      setProgress({ completed: 0, total: itemIds.length });
      announce(`Starting ${actionName.replace(/-/g, " ")} for ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}.`);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const outcome = await runBulkAction({
        idempotencyKey: record.idempotencyKey,
        itemIds,
        performAction,
        signal: controller.signal,
        onItemSettled: (_item: BulkItemOutcome, completedCount: number, total: number) => {
          setProgress({ completed: completedCount, total });
        },
      });

      abortControllerRef.current = null;
      setResult(outcome);
      setPhase("result");

      if (outcome.outcome === "full-success") {
        operation.markSucceeded();
        announce(`${actionName.replace(/-/g, " ")} completed successfully for all ${outcome.items.length} items.`);
      } else if (outcome.outcome === "partial-success") {
        const failedCount = outcome.items.filter((i) => i.status === "failed").length;
        operation.markFailed();
        announce(
          `${actionName.replace(/-/g, " ")} partially completed: ${failedCount} of ${outcome.items.length} items failed.`,
          { politeness: "assertive" },
        );
      } else if (outcome.outcome === "cancelled") {
        operation.markCancelled();
        announce(`${actionName.replace(/-/g, " ")} was cancelled.`);
      } else {
        operation.markFailed();
        announce(`${actionName.replace(/-/g, " ")} failed for all items.`, { politeness: "assertive" });
      }
    },
    [actionName, announce, operation, performAction],
  );

  const cancelExecution = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const dismissResult = useCallback(() => {
    setPhase("idle");
    setResult(null);
    operation.reset();
  }, [operation]);

  return {
    phase,
    progress,
    result,
    startReview,
    cancelReview,
    confirmAndExecute,
    cancelExecution,
    dismissResult,
    isPolling: operation.isPolling,
  };
}
