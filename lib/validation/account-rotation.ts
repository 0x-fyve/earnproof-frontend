/**
 * Validation schemas for payment account rotation (#281).
 *
 * Strict public-key validation (format + length) is required before any
 * rotation step proceeds. Secret-key detection (Stellar secret seeds
 * starting with "S" at length 56) is applied at validation time and must
 * also be checked in the UI before the value reaches a server call.
 *
 * Full Stellar StrKey CRC-16 checksum validation would require
 * `@stellar/stellar-base`, which is not a declared dependency of this
 * project. The schema therefore validates the alphanumeric-base32 format
 * and 56-character length as a conservative proxy. Any address that passes
 * this check but fails a live on-chain lookup (Horizon 404) is handled as
 * a `"account_not_found"` error in the UI, not as a validation error.
 */

import { z } from "zod";

/**
 * Regex matching the Stellar public key (G-address) character set.
 * Stellar StrKey uses base-32 with the alphabet A-Z, 2-7.
 * A valid G-address is always exactly 56 characters long.
 */
const STELLAR_PUBKEY_RE = /^G[A-Z2-7]{55}$/;

/**
 * Regex matching a Stellar secret seed (S-address).
 * Inputs matching this pattern must be rejected with a warning.
 * We never accept, store, or forward secret key material.
 */
const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;

/**
 * Returns `true` if the input looks like a Stellar secret seed.
 * Used by the UI to warn users who paste a secret instead of a public key.
 */
export function looksLikeStellarSecret(value: string): boolean {
  return STELLAR_SECRET_RE.test(value.trim());
}

/**
 * Schema for a Stellar public key field.
 *
 * Rejects:
 * - Empty strings
 * - Inputs that look like Stellar secret seeds (S…)
 * - Inputs that do not match the G-address format
 *
 * NOTE: Does NOT perform StrKey CRC-16 checksum validation (no
 * `stellar-base` dep). Addresses that pass format checks but are not
 * real accounts are caught by Horizon lookups at runtime.
 */
export const stellarPublicKeySchema = z
  .string()
  .min(1, "Public key is required")
  .refine(
    (value) => !looksLikeStellarSecret(value.trim()),
    "This looks like a Stellar secret seed. Never enter a private key. Use your wallet's public key (starts with G).",
  )
  .refine(
    (value) => STELLAR_PUBKEY_RE.test(value.trim()),
    "Invalid Stellar public key. Must be 56 characters starting with G (e.g. GABC…).",
  );

/**
 * Input schema for the rotation-review step.
 *
 * Validates:
 * - `newAccountAddress` — valid Stellar public key
 * - `newAccountAddress !== currentAccountAddress` — same-account rotation rejected
 */
export const rotationReviewSchema = z
  .object({
    currentAccountAddress: z.string().min(1),
    newAccountAddress: stellarPublicKeySchema,
  })
  .refine((data) => data.newAccountAddress.trim() !== data.currentAccountAddress.trim(), {
    message:
      "The new account must be different from the current account. Rotating to the same account is not permitted.",
    path: ["newAccountAddress"],
  });

export type RotationReviewInput = z.infer<typeof rotationReviewSchema>;

/**
 * Schema for the ownership challenge submission step.
 *
 * `signedChallenge` must be a non-empty string (a base64-encoded or hex
 * signature produced by the user's wallet). The UI never accepts a private
 * key here — the input is for the *signed result* only.
 */
export const ownershipChallengeSubmitSchema = z.object({
  challengeId: z.string().min(1, "Challenge ID is required"),
  walletAddress: stellarPublicKeySchema,
  signedChallenge: z
    .string()
    .min(1, "Signed challenge is required")
    .refine(
      (value) => !looksLikeStellarSecret(value.trim()),
      "Do not enter a private key. Paste only the signed challenge output from your wallet.",
    ),
});

export type OwnershipChallengeSubmitInput = z.infer<typeof ownershipChallengeSubmitSchema>;

/**
 * Schema for the checkpoint-boundary confirmation step.
 *
 * `confirmedLedger` must be a positive integer. Off-by-one is rejected:
 * the ledger must exactly match the proposed boundary ledger.
 */
export const checkpointBoundarySchema = z.object({
  confirmedLedger: z
    .number()
    .int("Ledger number must be an integer")
    .positive("Ledger number must be positive"),
  proposedLedger: z
    .number()
    .int()
    .positive(),
}).refine(
  (data) => data.confirmedLedger === data.proposedLedger,
  {
    message:
      "Confirmed ledger does not match the proposed boundary. You must confirm the exact ledger shown.",
    path: ["confirmedLedger"],
  },
);

export type CheckpointBoundaryInput = z.infer<typeof checkpointBoundarySchema>;
