/**
 * Bounded operation-status polling contract (#254).
 *
 * ASSUMPTION: no "operation status" / "job status" endpoint exists anywhere
 * in this repo's OpenAPI spec (lib/api/openapi/earnproof-api.v1.json) or
 * generated client (lib/api/generated/v1.ts) — every mutation here is
 * synchronous request/response with no resumable job concept (see, e.g.,
 * lib/api/payments.ts's note on POST /payments/sync being "a one-shot
 * summary ... no resumable cursor or a separate progress/status endpoint").
 * This module defines the client-side contract/types for a
 * `GET /operations/{idempotencyKey}` style bounded status endpoint the
 * issue assumes exists, so the recovery mechanism below has a real shape to
 * poll against the moment a backend adds one. Until then, callers that
 * cannot reach a real endpoint should treat every poll as resolving to
 * `"unknown"` rather than fabricating a success/failure outcome — see
 * lib/proofs/idempotent-operation.ts's `resolveOperationOutcome`.
 */
import { apiClient, bearer } from "./client";

/**
 * The eventual outcome of an operation whose initiating request's response
 * was lost (timed out, tab closed mid-request, etc). "unknown" is returned
 * for any outcome this client cannot safely distinguish from a transient
 * failure — see the #254 acceptance criterion that an expired or
 * unresolvable record must never be reported as a definite success or
 * failure.
 */
export type OperationTerminalState =
  | "succeeded"
  | "failed"
  | "pending"
  | "cancelled"
  | "unknown";

export type OperationStatusResponse = {
  idempotencyKey: string;
  state: OperationTerminalState;
  /** Present only when state === "succeeded"; the original mutation's result. */
  result?: unknown;
  /** Present only when state === "failed"; a support-safe error reference. */
  errorReference?: string;
  /** Server-side record version/ownership check for conflict detection. */
  updatedAt?: string;
};

export class OperationStatusConflictError extends Error {
  constructor(public readonly serverState: OperationStatusResponse) {
    super(
      "The operation record changed on the server in a way this client didn't expect " +
        "(for example, someone else already resumed or cancelled it).",
    );
    this.name = "OperationStatusConflictError";
    Object.setPrototypeOf(this, OperationStatusConflictError.prototype);
  }
}

/**
 * Polls `GET /operations/{idempotencyKey}` once. Not itself a retry loop —
 * see lib/proofs/idempotent-operation.ts's `pollUntilTerminal` for bounded
 * repeated polling. A 404 (the record aged out / was never created) and a
 * 403 (cross-tenant access attempt — see the #254 cross-tenant-isolation
 * acceptance criterion) are both normalized to the "unknown" terminal
 * state: this client cannot tell "never existed," "expired," and "belongs
 * to another tenant" apart from the outside, and none of those is evidence
 * of success or failure, so none of them may be reported as either.
 */
export async function fetchOperationStatus(
  idempotencyKey: string,
  token: string,
  signal?: AbortSignal,
): Promise<OperationStatusResponse> {
  try {
    return await apiClient<OperationStatusResponse>({
      path: `/operations/${encodeURIComponent(idempotencyKey)}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 403) {
      return { idempotencyKey, state: "unknown" };
    }
    throw error;
  }
}
