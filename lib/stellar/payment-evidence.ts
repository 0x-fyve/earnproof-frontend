/**
 * Stellar payment operation evidence (#224).
 *
 * NOTE: as with invitations.ts and payment-checkpoints.ts, the real
 * `Payment` type (lib/api/generated/v1.ts) is sparse — id,
 * stellarTransactionHash, a single opaque operationId, source/destination
 * address, asset code/issuer, occurredAt, classification, isEligible.
 * There is no network, operation index, ledger sequence/close time, or
 * per-operation success status anywhere in it. This module models the
 * richer per-operation evidence endpoint the backend would need to expose
 * that data, following the same documented "not yet in OpenAPI" pattern
 * as the sibling modules; deliberately NOT registered in
 * `lib/api/client-contracts.json` for the same reason.
 *
 * Deliberate separation ("Separate indexed evidence from backend
 * classification and proof eligibility"): this type carries none of
 * `Payment.classification`/`Payment.isEligible` — a caller that wants
 * those fetches the existing `Payment` record separately
 * (see PaymentEligibilityPanel) rather than this module re-exposing them,
 * so the evidence viewer can never be mistaken for an eligibility
 * decision.
 */

import { apiClient, bearer, retryRead } from "@/lib/api/client";

export type StellarNetwork = "testnet" | "public";

export type OperationAmountStatus = "success" | "failed" | "pending";

/**
 * A Stellar account address as it appeared in the operation. `type`
 * distinguishes a muxed account ("M...", SEP-0023) from a plain ed25519
 * account ("G...") so the UI can represent each accurately instead of
 * treating a muxed address as if it were a plain one (or vice versa).
 */
export type StellarOperationAccount = {
  address: string;
  type: "ed25519" | "muxed";
  /** For a muxed account, the underlying "G..." account the mux ID is layered on. Null for a plain ed25519 account. */
  underlyingAccount: string | null;
  /** For a muxed account, the numeric mux ID (SEP-0023). Null for a plain ed25519 account. */
  muxedId: string | null;
};

export type PaymentOperationEvidence = {
  paymentId: string;
  network: StellarNetwork;
  transactionHash: string;
  /** Index of this operation within its transaction (0-based, as Horizon reports it). */
  operationIndex: number;
  /** Total number of operations in the containing transaction, so a single-operation payment can be distinguished from one operation among many. */
  operationCount: number;
  sourceAccount: StellarOperationAccount;
  destinationAccount: StellarOperationAccount;
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  amountStatus: OperationAmountStatus;
  ledgerSequence: number;
  ledgerClosedAt: string;
  /**
   * True if a memo was present on the transaction. The memo's actual
   * content is deliberately never included in this type at all — not
   * fetched, not redacted-at-render-time, simply absent — so there is no
   * code path that could leak it ("Private memo content remains
   * redacted").
   */
  hasMemo: boolean;
};

export async function getPaymentOperationEvidence(
  token: string,
  paymentId: string,
  signal: AbortSignal,
): Promise<PaymentOperationEvidence> {
  return retryRead(async (signal) => {
    return apiClient<PaymentOperationEvidence>({
      path: `/payments/${encodeURIComponent(paymentId)}/evidence`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * True when the evidence's recorded network doesn't match the app's
 * currently configured network — e.g. evidence fetched while pointed at
 * testnet being viewed after switching the app to mainnet. The viewer
 * must call this out rather than silently building an explorer link for
 * the wrong network.
 */
export function isNetworkMismatch(
  evidence: PaymentOperationEvidence,
  configuredNetwork: StellarNetwork,
): boolean {
  return evidence.network !== configuredNetwork;
}
