# Payment Account Rotation (#281)

Replaces the monitored Stellar payment account for an organisation without
mixing checkpoint history or proof eligibility across the old and new accounts.

---

## Workflow

The workflow is a six-step wizard:

| Step | ID | What happens |
|------|----|---|
| 1 | `review` | Operator enters the new account address; the current account, network, and what will change are displayed for explicit confirmation. |
| 2 | `challenge` | A server-issued challenge is signed by the new account's wallet (via Freighter or an external signer), proving control without ever asking for a private key or seed phrase. |
| 3 | `boundary` | The exact ledger sequence number where the old account's checkpoint history ends and the new account's begins is confirmed. |
| 4 | `resync-plan` | The scope of the resync (full payment history for the new account) and the expected effect on proof eligibility are reviewed. |
| 5 | `progress` | The resync runs; deterministic states (pending → running → complete/failed) are shown. |
| 6 | `rollback` | The rotation can be reverted to the old account until the resync completes. |

---

## State machine

```
pending
  → challenge_pending       (challenge issued)
  → boundary_confirmed      (challenge verified; boundary step done)
  → resync_planned          (resync scope attached)
  → resync_running          (POST /payments/sync in flight)
  → completed               (resync succeeded — IRREVERSIBLE)

  ↓ at any step before completed
rolled_back

Error states (terminal; restart required):
  challenge_expired         (challenge TTL elapsed before submission)
  challenge_failed          (signature rejected by server)
  resync_failed             (sync call returned an error)
  stale                     (server-side state changed mid-flow)
```

---

## API contract

Real endpoints used (per current OpenAPI spec v1.0.0):

| Call | Purpose |
|------|---------|
| `POST /auth/challenge` | Issues a proof-of-ownership challenge for the new account address. |
| `POST /auth/verify` | Verifies the signed challenge (proves the user controls the new account). |
| `POST /payments/sync` | Resyncs payments for the new account after the boundary is confirmed. |

No dedicated rotation or account-management endpoint exists in the current spec.
The ownership-challenge flow reuses the existing auth challenge/verify round trip.
All other rotation state is client-local (`lib/account-rotation/store.ts`) and is
the intended drop-in target when a real backend mutation endpoint is added.

---

## Ownership challenge design

1. Operator enters the new account's Stellar public key (G-address) in the review step.
2. The wizard calls `POST /auth/challenge` with `{ walletAddress: newAccountAddress }`.
3. The server returns a `{ id, message, expiresAt }` challenge.
4. The challenge `message` is displayed verbatim (not rendered as HTML).
5. The operator signs the message via **Freighter** (one click) or an **external signer** (paste base64/hex output).
6. The signed result is submitted to `POST /auth/verify`.
7. A successful `POST /auth/verify` response means the server accepted the signature as proof of control.

**No private key is ever requested, displayed, stored, or transmitted.** The
`signature` field submitted to `/auth/verify` is the cryptographic output of the
signing operation, not the private key itself. The UI detects S-address patterns
in every input field and blocks submission with an explicit warning.

---

## Checkpoint boundary

The boundary is the exact ledger sequence number at which the old account's
payment history ends and the new account's begins.

- Payments at ledger ≤ `boundary.ledger` belong exclusively to the old account.
- Payments at ledger ≥ `boundary.ledger + 1` are tracked for the new account.
- The confirmed ledger must exactly match the proposed ledger (off-by-one is rejected).
- Checkpoints and proof eligibility are **never shared, merged, or inherited** across accounts.

In this implementation the boundary ledger is a synthetic value
(`SYNTHETIC_BOUNDARY_LEDGER = 50_000_000`) because no Horizon lookup is performed
by the client. In production the current ledger sequence should be read from
Horizon before presenting the boundary step.

---

## Network mismatch

If the connected wallet reports a network passphrase that does not match
`appConfig.stellarNetworkPassphrase`, progression from the review step to the
challenge step is blocked with a clear error. This check uses the same
`validateNetworkCompatibility` function as all other signing flows. Silent
fallback is not permitted: any state other than `"compatible"` surfaces an error.

---

## Rollback

Rollback is available at any step **before** `status === "completed"`.

- Rollback moves the record to `"rolled_back"`.
- The old account remains active.
- No checkpoint data is modified.
- Old and new account histories remain completely separate after rollback.
- A new rotation can be started after rollback.
- Once `completed`, rollback is permanently unavailable (the resync is irreversible).

The rollback action requires explicit confirmation via a `ConfirmationDialog` that
states exactly what will happen.

---

## Security invariants

- No input, prop, API request, log, or fixture may accept, hold, or transmit a
  private key, seed phrase, or secret.
- All fields that accept text from the operator are checked for S-address patterns
  (`/^S[A-Z2-7]{55}$/`) before submission.
- Stellar public keys are validated for format (`/^G[A-Z2-7]{55}$/`) before use.
  Full StrKey CRC-16 checksum validation is not performed (requires `@stellar/stellar-base`,
  which is not a declared dependency). Addresses that pass format checks but are not
  real accounts will fail at the Horizon / API layer.
- Challenge messages are displayed as pre-formatted text, not rendered as HTML.
  `dangerouslySetInnerHTML` is not used anywhere in the rotation wizard.
- The `verifyRotationChallenge` function does not return or store the `signature`
  parameter after the API call completes.

---

## Authorization

Only users with `role === "ADMIN"` may access the rotation workflow. All other roles
see a clear "Access Restricted" message. No rotation data or account addresses are
rendered for unauthorized users.

---

## Accessibility

- All form inputs have explicit `<label>` associations.
- `aria-invalid` + `aria-describedby` on inputs with errors.
- `role="alert"` on error messages (assertive live region).
- `aria-live="polite" role="status"` on the progress panel for non-urgent updates.
- Focus is moved to the step heading (`tabIndex={-1}`) on every step transition.
- Keyboard operability: all interactive elements are focusable buttons or labelled inputs.
- Destructive actions require confirmation dialogs with focus management.

---

## Compatibility and migration

**No migration is required.**

### Existing single-account organisations

Organisations with no rotation records are in the correct initial state. Their
current monitored account is the `walletAddress` stored in their session
(`lib/session.ts`). The absence of a rotation record in
`localStorage["earnproof.account-rotation.{userId}"]` means "no rotation has
occurred yet", not an error condition.

### Relationship to `lib/wallet-rotation/store.ts` (issue #169)

The existing `earnproof.wallet-rotations` localStorage key managed by
`lib/wallet-rotation/store.ts` tracks **auth-wallet rotation** — changing which
wallet is used to authenticate an existing session. Issue #281 is
**payment-account rotation** — changing which Stellar account's payments are
monitored. These are entirely separate records with separate semantics and must
never be merged.

### In-flight rotations on upgrade

If a user had partially completed a rotation stored under the old
`lib/wallet-rotation/store.ts` format (issue #169), those records are unaffected
because they use a different localStorage key and type. The new
`lib/account-rotation/store.ts` starts with an empty record set for every user.

### When a real backend endpoint is added

Every function in `lib/account-rotation/store.ts` and `lib/api/account-rotation.ts`
is the intended drop-in target. Replace the localStorage write in
`lib/account-rotation/store.ts` with an API call; keep the in-memory state machine
logic unchanged. The `lib/api/account-rotation.ts` functions already use the correct
HTTP verbs and error-handling patterns (`retryMutation`, `apiClient`, `bearer`).
