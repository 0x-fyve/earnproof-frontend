import { apiClient, bearer, retryRead, retryMutation } from "./client";

/**
 * Payment sync checkpoint health (#240).
 *
 * NOTE: as with `organization-members.ts` and `invitations.ts`,
 * `/payments/checkpoints` is not yet defined in
 * `lib/api/openapi/earnproof-api.v1.json`. The real `POST /payments/sync`
 * endpoint (see `payments.ts`) is a single, synchronous, unbounded
 * operation with no per-account cursor or ledger-checkpoint concept at
 * all today - this module models the ingestion-checkpoint API the
 * backend would need to expose per-account lag/stall/reorg visibility,
 * following the same request/response conventions as the sibling
 * clients. Deliberately NOT registered in `lib/api/client-contracts.json`
 * for the same reason.
 */

/**
 * `local-processing` covers this app's own worker being behind (queue
 * backlog, restart, etc.) as distinct from every Horizon-side cause,
 * since the recovery action differs (retry on our side vs. wait out an
 * outage/rate-limit/reorg on Horizon's side).
 */
export type CheckpointOutageReason =
  | "horizon_outage"
  | "horizon_rate_limited"
  | "ledger_reorg"
  | "local_processing_delay"
  | null;

export type CheckpointStatus = "healthy" | "lagging" | "stalled" | "regressed" | "reorg";

export type PaymentCheckpoint = {
  accountId: string;
  /** Last ledger sequence this account's ingestion cursor has fully processed. */
  checkpointLedger: number;
  /** Latest ledger Horizon reports as finalized, independent of our ingestion progress. */
  latestFinalizedLedger: number;
  /** latestFinalizedLedger - checkpointLedger. Always >= 0 except during a regression. */
  lagLedgers: number;
  status: CheckpointStatus;
  outageReason: CheckpointOutageReason;
  lastSuccessfulSyncAt: string | null;
  /** True once no progress has been made for longer than the stall threshold. */
  isStalled: boolean;
};

export type PaymentCheckpointsResponse = {
  checkpoints: PaymentCheckpoint[];
  /** Server-side threshold (ledgers behind) past which lag becomes "lagging", for display only. */
  lagWarningThresholdLedgers: number;
};

export type RetryCheckpointResponse = {
  checkpoint: PaymentCheckpoint;
  /** False if the server declined the retry (e.g. already in progress, or still within backoff). */
  accepted: boolean;
  reason?: string;
};

export async function getPaymentCheckpoints(
  token: string,
  signal: AbortSignal
): Promise<PaymentCheckpointsResponse> {
  return retryRead(async (signal) => {
    return apiClient<PaymentCheckpointsResponse>({
      path: "/payments/checkpoints",
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Requests a bounded retry of a single stalled/regressed account's
 * ingestion. "Bounded" per the issue's scope: the server owns backoff and
 * in-flight de-duplication, this call does not loop or poll on its own -
 * callers re-fetch getPaymentCheckpoints to observe the outcome.
 */
export async function retryCheckpoint(
  token: string,
  accountId: string,
  signal: AbortSignal
): Promise<RetryCheckpointResponse> {
  return retryMutation(async (signal) => {
    return apiClient<RetryCheckpointResponse>({
      path: `/payments/checkpoints/${encodeURIComponent(accountId)}/retry`,
      method: "POST",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export function describeOutageReason(reason: CheckpointOutageReason): string | null {
  switch (reason) {
    case "horizon_outage":
      return "Horizon is currently unreachable. This will recover automatically once Horizon is back.";
    case "horizon_rate_limited":
      return "Horizon is rate-limiting our requests. Ingestion will resume automatically after the limit clears.";
    case "ledger_reorg":
      return "A ledger reorganization was detected. The checkpoint is being re-validated against the new canonical chain.";
    case "local_processing_delay":
      return "Our own ingestion worker is behind. A manual retry may help if this persists.";
    case null:
      return null;
  }
}

/**
 * Distinguishes "stale" (the stall threshold was reached) from "just
 * lagging normally" and from "regressed" (checkpoint ledger moved
 * backward, e.g. after a reorg rollback) — the issue's acceptance
 * criteria call these out as needing to be visibly different, not
 * collapsed into one generic "behind" indicator.
 */
export function getCheckpointSeverity(
  checkpoint: PaymentCheckpoint,
): "normal" | "stale" | "regressed" {
  if (checkpoint.status === "regressed") return "regressed";
  if (checkpoint.isStalled || checkpoint.status === "stalled") return "stale";
  return "normal";
}
