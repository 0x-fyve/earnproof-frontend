/**
 * Per-item execution engine for bulk admin actions (#251).
 *
 * Deliberately NOT a bulk/batch HTTP endpoint caller: this app's APIs
 * (lib/api/organization-members.ts, lib/api/issuers.ts, etc.) only expose
 * single-resource mutation endpoints, so a "bulk action" here means
 * invoking the caller-supplied single-item `performAction` once per
 * selected item, sequentially, collecting a per-item outcome for each.
 * This also happens to be exactly what the acceptance criteria need: a
 * result that can tell you precisely which items failed and why, and a
 * retry that targets only those items.
 *
 * Idempotency: callers are expected to have already called
 * `resolveOperationKey("bulk-action", intent)` /
 * `useIdempotentOperation(tenantId, "bulk-action")` (lib/proofs/
 * idempotent-operation.ts, lib/proofs/use-idempotent-operation.ts, #254)
 * before invoking `runBulkAction`, and to pass the resolved idempotency
 * key through so a retry of the same batch intent is distinguishable from
 * a brand-new one. This module does not mint its own keys.
 */

export type BulkItemOutcome =
  | { itemId: string; status: "succeeded" }
  | { itemId: string; status: "failed"; reason: string; retryable: boolean }
  | { itemId: string; status: "skipped"; reason: string };

export type BulkActionOutcome = "full-success" | "partial-success" | "full-failure" | "cancelled";

export interface BulkActionResult {
  idempotencyKey: string;
  outcome: BulkActionOutcome;
  items: BulkItemOutcome[];
}

export class BulkActionAuthorizationError extends Error {
  readonly retryable = false;
  constructor(message = "You are not authorized to perform this action on this item.") {
    super(message);
    this.name = "BulkActionAuthorizationError";
    Object.setPrototypeOf(this, BulkActionAuthorizationError.prototype);
  }
}

export class BulkActionStaleItemError extends Error {
  readonly retryable = false;
  constructor(message = "This item changed or no longer exists. Refresh and try again.") {
    super(message);
    this.name = "BulkActionStaleItemError";
    Object.setPrototypeOf(this, BulkActionStaleItemError.prototype);
  }
}

/** Resolves the outcome classification from the per-item results — the
 * single source of truth for the "never report partial success as full
 * success" guarantee. A caller must render UI strictly from this value,
 * never infer success from "the call didn't throw." */
export function classifyOutcome(items: BulkItemOutcome[], wasCancelled: boolean): BulkActionOutcome {
  if (wasCancelled) return "cancelled";
  const succeeded = items.filter((item) => item.status === "succeeded").length;
  const total = items.length;
  if (total === 0) return "full-failure";
  if (succeeded === total) return "full-success";
  if (succeeded === 0) return "full-failure";
  return "partial-success";
}

export interface RunBulkActionOptions {
  idempotencyKey: string;
  itemIds: readonly string[];
  /** Invoked once per item, sequentially. Must reject with
   * BulkActionAuthorizationError / BulkActionStaleItemError for those
   * specific, non-retryable cases; any other rejection is treated as a
   * generic, retryable failure. */
  performAction: (itemId: string) => Promise<void>;
  signal?: AbortSignal;
  /** Called after each item completes, for progress UI. */
  onItemSettled?: (outcome: BulkItemOutcome, completedCount: number, total: number) => void;
}

export async function runBulkAction(options: RunBulkActionOptions): Promise<BulkActionResult> {
  const { idempotencyKey, itemIds, performAction, signal, onItemSettled } = options;
  const items: BulkItemOutcome[] = [];
  let cancelled = false;

  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i];

    if (signal?.aborted) {
      cancelled = true;
      // Every item from this point on (inclusive) is recorded as skipped
      // rather than silently dropped, so the result UI can show exactly
      // what was and wasn't attempted.
      for (let j = i; j < itemIds.length; j++) {
        const skipped: BulkItemOutcome = {
          itemId: itemIds[j],
          status: "skipped",
          reason: "Cancelled before this item was attempted.",
        };
        items.push(skipped);
        onItemSettled?.(skipped, items.length, itemIds.length);
      }
      break;
    }

    try {
      await performAction(itemId);
      const outcome: BulkItemOutcome = { itemId, status: "succeeded" };
      items.push(outcome);
      onItemSettled?.(outcome, items.length, itemIds.length);
    } catch (error) {
      const outcome = toFailedOutcome(itemId, error);
      items.push(outcome);
      onItemSettled?.(outcome, items.length, itemIds.length);
    }
  }

  return {
    idempotencyKey,
    outcome: classifyOutcome(items, cancelled),
    items,
  };
}

function toFailedOutcome(itemId: string, error: unknown): BulkItemOutcome {
  if (error instanceof BulkActionAuthorizationError) {
    return { itemId, status: "failed", reason: error.message, retryable: false };
  }
  if (error instanceof BulkActionStaleItemError) {
    return { itemId, status: "failed", reason: error.message, retryable: false };
  }
  const message = error instanceof Error ? error.message : "This action failed. You can retry it.";
  return { itemId, status: "failed", reason: message, retryable: true };
}

/** IDs of failed, retryable items only — never includes skipped
 * (cancelled) or non-retryable (authorization/stale) items, so a retry
 * action built from this list can never silently re-target the whole
 * original batch or an item that will deterministically fail again. */
export function retryableItemIds(result: BulkActionResult): string[] {
  return result.items
    .filter((item): item is Extract<BulkItemOutcome, { status: "failed" }> => item.status === "failed")
    .filter((item) => item.retryable)
    .map((item) => item.itemId);
}
