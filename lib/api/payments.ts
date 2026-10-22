import { apiClient, bearer, retryRead, retryMutation } from "./client";
import type { Payment, PaymentSyncResult } from "./generated/v1";

export type { Payment };

export async function listPayments(token: string, signal: AbortSignal): Promise<Payment[]> {
  return retryRead(async (signal) => {
    return apiClient<Payment[]>({
      path: "/payments",
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Triggers a payment synchronization pass (#138). `POST /payments/sync`
 * is a mutation and is intentionally never auto-retried by this client
 * (see retryMutation), matching this API's documented retry policy.
 *
 * The response is a one-shot summary (created/updated/skipped counts);
 * the API does not expose a resumable cursor or a separate progress/status
 * endpoint, so callers can distinguish a completed sync's outcome
 * (no-op / partial / full) from these counts, but cannot resume a sync
 * from a server-provided checkpoint mid-run, only retry the whole
 * operation.
 *
 * POST /payments/sync (#171). The real endpoint takes no parameters and
 * runs a full, unbounded, synchronous sync — it has no concept of a ledger
 * range, a queued/async job, or resumable progress. See
 * lib/payment-backfill/store.ts for how the bounded-range request/job
 * lifecycle this issue asks for is layered on top of this call.
 */
/**
 * `idempotencyKey` (#254) is sent as a forward-compatible `Idempotency-Key`
 * header, the same deliberately-defensive treatment as
 * lib/proofs/idempotency.ts gives proof-creation requests: the real
 * `POST /payments/sync` endpoint does not yet define this header in the
 * OpenAPI spec, so sending it is harmless today and lets the backend start
 * deduplicating retries the moment it honors one, with no frontend change.
 * Omitting it preserves this function's existing behavior exactly.
 */
export async function syncPayments(
  token: string,
  signal: AbortSignal,
  idempotencyKey?: string,
): Promise<PaymentSyncResult> {
  return retryMutation(async (signal) => {
    return apiClient<PaymentSyncResult>({
      path: "/payments/sync",
      method: "POST",
      headers: idempotencyKey ? { ...bearer(token), "Idempotency-Key": idempotencyKey } : bearer(token),
      signal,
    });
  }, signal);
}

export type PaymentSyncOutcome = "noop" | "partial" | "complete";

/**
 * Classifies a sync result for display. "Partial" covers any run where at
 * least one payment was skipped alongside a created/updated one; a run
 * that skipped everything and changed nothing is a no-op, not a partial
 * failure, since the API gives no way to distinguish "skipped because
 * already synced" from "skipped because of an error" in this response
 * shape.
 */
export function classifySyncOutcome(result: PaymentSyncResult): PaymentSyncOutcome {
  const created = result.created ?? 0;
  const updated = result.updated ?? 0;
  const skipped = result.skipped ?? 0;

  if (created === 0 && updated === 0 && skipped === 0) {
    return "noop";
  }
  if (skipped > 0) {
    return "partial";
  }
  return "complete";
}
