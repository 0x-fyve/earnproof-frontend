/**
 * API functions for payment account rotation (#281).
 *
 * REAL ENDPOINTS USED
 * ───────────────────
 * POST /auth/challenge   — issues a challenge for the new account address
 * POST /auth/verify      — verifies the signed challenge (proves ownership)
 * POST /payments/sync    — resyncs payments after rotation boundary is confirmed
 *
 * No dedicated rotation or account-management endpoint exists in the current
 * OpenAPI spec. The ownership-challenge flow reuses the existing auth
 * challenge/verify round trip (same as wallet auth) to prove control of the
 * new account without ever asking for a private key or seed phrase. The
 * actual account reassignment is client-local (lib/account-rotation/store.ts)
 * and is the intended drop-in target when a real backend mutation exists.
 *
 * REPLAY SAFETY
 * ─────────────
 * POST /auth/challenge is idempotent per address within the challenge TTL
 * (issuing a second challenge for the same address before the first expires
 * returns a new challenge — not a duplicate of the first, but also not a
 * side-effect beyond the TTL window). POST /auth/verify with the same
 * (challengeId, signature) pair a second time will be rejected by the server
 * as a used/expired challenge, which is the correct duplicate-rejection
 * behavior. POST /payments/sync has no parameters and is inherently
 * idempotent within the same sync window.
 *
 * SECURITY
 * ─────────
 * No function here accepts, returns, logs, or forwards private key material.
 * The `signature` parameter in `verifyRotationChallenge` is the signed
 * challenge output from the user's wallet — it is the *result* of the
 * signing operation, not a private key.
 */

import { apiClient, bearer, retryMutation } from "./client";
import { syncPayments } from "./payments";
import type { AuthChallenge } from "./auth";
import type { PaymentSyncResult } from "./generated/v1";

export type { AuthChallenge };

/**
 * Requests a proof-of-ownership challenge for `walletAddress`.
 *
 * Reuses POST /auth/challenge — the existing challenge endpoint — because
 * the ownership proof for payment account rotation requires the same
 * signed-challenge flow as login. The difference is that this is for the
 * *new* account address, not the currently-authenticated one.
 *
 * Never retried automatically (mutation policy).
 */
export async function requestRotationChallenge(
  token: string,
  walletAddress: string,
  signal: AbortSignal,
): Promise<AuthChallenge> {
  return retryMutation(async (s) => {
    return apiClient<AuthChallenge>({
      path: "/auth/challenge",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ walletAddress }),
      signal: s,
    });
  }, signal);
}

/**
 * Submits the signed challenge to prove ownership of `walletAddress`.
 *
 * `signature` is the base64 output of the wallet's signing operation over
 * the challenge message. It is NOT a private key. This function does not
 * store, log, or return it after the call.
 *
 * A 401 response means the signature was rejected (wrong key or tampered
 * message). A 409 response means the challenge was already used or has
 * expired — the caller should surface a `challenge_failed` or
 * `challenge_expired` state rather than retrying.
 *
 * Never retried automatically (mutation policy).
 */
export async function verifyRotationChallenge(
  token: string,
  input: {
    challengeId: string;
    walletAddress: string;
    signature: string;
  },
  signal: AbortSignal,
): Promise<void> {
  await retryMutation(async (s) => {
    // POST /auth/verify returns { user, session } on success but we do not
    // use the returned session: this rotation uses the *existing* session
    // token (already authenticated as the current account). We only care
    // that the server accepted the signature.
    await apiClient<unknown>({
      path: "/auth/verify",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(input),
      signal: s,
    });
  }, signal);
}

/**
 * Triggers a payment resync for the new account after the boundary is
 * confirmed. Delegates to the existing syncPayments wrapper (POST
 * /payments/sync) which is the only real resync endpoint available.
 *
 * The POST /payments/sync endpoint has no account or range parameters —
 * it always runs a full unbounded sync (same constraint as #171). The
 * "scope" shown to the user in the resync-plan step is therefore the full
 * payment history for the new account, not a bounded window.
 *
 * Never retried automatically (mutation policy — see retryMutation in
 * lib/api/client.ts).
 */
export async function runRotationResync(
  token: string,
  signal: AbortSignal,
): Promise<PaymentSyncResult> {
  return syncPayments(token, signal);
}
