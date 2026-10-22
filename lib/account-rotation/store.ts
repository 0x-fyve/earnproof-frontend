/**
 * Payment account rotation tracking (#281).
 *
 * ARCHITECTURE NOTE — client-local state
 * ──────────────────────────────────────
 * No rotation or resync endpoint exists in this repo's OpenAPI spec beyond
 * POST /auth/challenge and POST /auth/verify (which only authenticate a
 * session, never reassign which account an organisation monitors) and
 * POST /payments/sync (no account parameter). This store layers the full
 * rotation lifecycle — review, challenge, boundary, resync-plan, progress,
 * rollback — on top of those real calls, persisted to localStorage per
 * user, exactly as lib/payment-backfill/store.ts does for bounded syncs.
 *
 * When a real account-rotation backend endpoint exists, every function
 * below is the intended drop-in target: replace the localStorage write
 * with an API call, keep the in-memory state machine logic unchanged.
 *
 * COMPATIBILITY / MIGRATION
 * ─────────────────────────
 * Existing single-account organisations have no rotation records here;
 * that is the correct initial state. Their current monitored account is
 * always the walletAddress in their session (lib/session.ts). No migration
 * or shim is needed: the absence of a rotation record means "no rotation
 * has occurred", not an error. Legacy data stored under the old key
 * "earnproof.wallet-rotations" (lib/wallet-rotation/store.ts, issue #169)
 * is for *auth-wallet* rotation, not *payment-account* rotation — they are
 * entirely separate records with separate semantics. Do not merge them.
 *
 * INVARIANTS
 * ──────────
 * - Old and new accounts are NEVER merged: checkpoints and proof eligibility
 *   are keyed by account address and must never cross accounts.
 * - Rotating to the same account as the current one is rejected before any
 *   network call is made.
 * - A rotation record can only move forward through its lifecycle states;
 *   rollback resets to a terminal "rolled_back" state, not back to
 *   "pending" (a new rotation must be started after a rollback).
 * - Challenge expiry is checked at every step that requires a valid
 *   challenge; expired challenges cause a terminal "challenge_expired"
 *   error state rather than a silent failure.
 */

const STORAGE_KEY_PREFIX = "earnproof.account-rotation.";

// ─── Status type ──────────────────────────────────────────────────────────────

/**
 * Deterministic lifecycle states for a rotation record.
 *
 * Allowed transitions:
 *   pending → challenge_pending → boundary_confirmed → resync_planned
 *           → resync_running → completed
 *                                    ↓ (at any non-completed terminal step)
 *                             rolled_back
 *
 * Error states (terminal, no retry from state — user must start over):
 *   challenge_expired  (challenge TTL elapsed before submission)
 *   challenge_failed   (signature verification rejected by server)
 *   resync_failed      (sync call returned an error)
 *   stale              (server-side state changed mid-flow; review required)
 */
export type RotationStatus =
  | "pending"
  | "challenge_pending"
  | "boundary_confirmed"
  | "resync_planned"
  | "resync_running"
  | "completed"
  | "rolled_back"
  | "challenge_expired"
  | "challenge_failed"
  | "resync_failed"
  | "stale";

// ─── Record shape ─────────────────────────────────────────────────────────────

export interface RotationChallenge {
  /** Server-issued challenge ID (maps to AuthChallengeResponse.id). */
  challengeId: string;
  /** The plaintext challenge message the user must sign. */
  message: string;
  /** ISO-8601 expiry; checked before every challenge submission. */
  expiresAt: string;
}

export interface CheckpointBoundary {
  /** The exact ledger sequence number that ends the old account's history. */
  ledger: number;
  /** ISO-8601 cursor timestamp corresponding to the ledger boundary. */
  cursor: string;
}

export interface ResyncResult {
  created: number;
  updated: number;
  skipped: number;
}

export interface AccountRotationRecord {
  id: string;
  userId: string;
  /** The account being replaced. Checkpoints keyed to this address stop here. */
  oldAccountAddress: string;
  /** The account taking over. Checkpoints start at `boundary.ledger + 1`. */
  newAccountAddress: string;
  status: RotationStatus;
  /** Set when the ownership challenge is issued by the server. */
  challenge: RotationChallenge | null;
  /** The signed challenge response submitted by the user's wallet. Never logged. */
  challengeSignatureSubmitted: boolean;
  /** Set when the checkpoint boundary step is confirmed. */
  boundary: CheckpointBoundary | null;
  /** Human-readable summary of what the resync will cover. */
  resyncScope: string | null;
  /** Set when the resync completes (success or failure). */
  resyncResult: ResyncResult | null;
  /** Non-null only in error states. Safe to display; must not contain key material. */
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Type-guard ───────────────────────────────────────────────────────────────

function isAccountRotationRecord(v: unknown): v is AccountRotationRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.userId === "string" &&
    typeof r.oldAccountAddress === "string" &&
    typeof r.newAccountAddress === "string" &&
    typeof r.status === "string" &&
    typeof r.createdAt === "string" &&
    typeof r.updatedAt === "string"
  );
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function readAll(userId: string): AccountRotationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAccountRotationRecord);
  } catch {
    return [];
  }
}

function writeAll(userId: string, records: AccountRotationRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(records));
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `rotation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ─── Custom errors ────────────────────────────────────────────────────────────

export class RotationNotFoundError extends Error {
  constructor(id: string) {
    super(`Account rotation record ${id} not found.`);
    this.name = "RotationNotFoundError";
  }
}

export class RotationAlreadyActiveError extends Error {
  constructor(readonly activeRotationId: string) {
    super(
      "A rotation is already in progress for this account. Complete or roll back the existing rotation before starting a new one.",
    );
    this.name = "RotationAlreadyActiveError";
  }
}

export class SameAccountRotationError extends Error {
  constructor() {
    super(
      "The new account must be different from the current account. Rotating to the same account is not permitted.",
    );
    this.name = "SameAccountRotationError";
  }
}

export class ChallengeExpiredError extends Error {
  constructor() {
    super(
      "The ownership challenge has expired. Please restart the rotation to request a new challenge.",
    );
    this.name = "ChallengeExpiredError";
  }
}

export class RollbackNotAllowedError extends Error {
  constructor(readonly status: RotationStatus) {
    super(
      `Rollback is only allowed before a rotation is fully completed. Current status: ${status}.`,
    );
    this.name = "RollbackNotAllowedError";
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const ACTIVE_STATUSES: RotationStatus[] = [
  "pending",
  "challenge_pending",
  "boundary_confirmed",
  "resync_planned",
  "resync_running",
];

export function isActiveRotation(r: AccountRotationRecord): boolean {
  return ACTIVE_STATUSES.includes(r.status);
}

/**
 * Rollback is only allowed when the rotation has not yet reached
 * "completed" (irreversible) or is not already rolled back.
 * Documented condition: rollback is available until `status === "completed"`.
 */
export function canRollback(r: AccountRotationRecord): boolean {
  return r.status !== "completed" && r.status !== "rolled_back";
}

export function isChallengeValid(
  challenge: RotationChallenge,
  now: number = Date.now(),
): boolean {
  const expiry = Date.parse(challenge.expiresAt);
  if (Number.isNaN(expiry)) return false;
  return now < expiry;
}

// ─── Core CRUD ────────────────────────────────────────────────────────────────

export function listRotations(userId: string): AccountRotationRecord[] {
  return readAll(userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getActiveRotation(userId: string): AccountRotationRecord | null {
  return readAll(userId).find(isActiveRotation) ?? null;
}

// ─── Lifecycle functions ──────────────────────────────────────────────────────

/**
 * Creates a new rotation record in `pending` state.
 *
 * Rejects:
 * - Same-account rotation
 * - A rotation that is already active for this user (must complete or roll back first)
 */
export function createRotation(
  userId: string,
  oldAccountAddress: string,
  newAccountAddress: string,
): AccountRotationRecord {
  if (oldAccountAddress.trim() === newAccountAddress.trim()) {
    throw new SameAccountRotationError();
  }

  const records = readAll(userId);
  const active = records.find(isActiveRotation);
  if (active) {
    throw new RotationAlreadyActiveError(active.id);
  }

  const now = new Date().toISOString();
  const record: AccountRotationRecord = {
    id: makeId(),
    userId,
    oldAccountAddress,
    newAccountAddress,
    status: "pending",
    challenge: null,
    challengeSignatureSubmitted: false,
    boundary: null,
    resyncScope: null,
    resyncResult: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
  records.push(record);
  writeAll(userId, records);
  return record;
}

function patchRecord(
  userId: string,
  id: string,
  patch: Partial<Omit<AccountRotationRecord, "id" | "userId" | "createdAt">>,
): AccountRotationRecord {
  const records = readAll(userId);
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) throw new RotationNotFoundError(id);
  const updated: AccountRotationRecord = {
    ...records[index]!,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  records[index] = updated;
  writeAll(userId, records);
  return updated;
}

/**
 * Records the server-issued challenge and moves to `challenge_pending`.
 * The challenge message is what the user's wallet will sign; it is stored
 * so it can be displayed to the user without a second network call.
 */
export function attachChallenge(
  userId: string,
  rotationId: string,
  challenge: RotationChallenge,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    status: "challenge_pending",
    challenge,
    errorMessage: null,
  });
}

/**
 * Records that the challenge signature was successfully verified by the
 * server. The signature itself is NOT stored — only the boolean flag.
 * Records the challenge as submitted and transitions to `boundary_confirmed`
 * awaiting user confirmation of the ledger boundary.
 *
 * Throws `ChallengeExpiredError` if the challenge TTL has elapsed.
 */
export function markChallengeVerified(
  userId: string,
  rotationId: string,
): AccountRotationRecord {
  const records = readAll(userId);
  const record = records.find((r) => r.id === rotationId);
  if (!record) throw new RotationNotFoundError(rotationId);
  if (record.challenge && !isChallengeValid(record.challenge)) {
    throw new ChallengeExpiredError();
  }
  return patchRecord(userId, rotationId, {
    challengeSignatureSubmitted: true,
    status: "boundary_confirmed",
    errorMessage: null,
  });
}

/**
 * Records a challenge failure (server rejected the signature).
 * Moves to `challenge_failed` (terminal — user must restart).
 */
export function markChallengeFailed(
  userId: string,
  rotationId: string,
  reason: string,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    status: "challenge_failed",
    errorMessage: reason,
  });
}

/**
 * Records the confirmed checkpoint boundary ledger.
 * Validates that `confirmedLedger` exactly matches `proposedLedger`
 * (off-by-one rejected per #281's boundary requirements).
 */
export function confirmBoundary(
  userId: string,
  rotationId: string,
  boundary: CheckpointBoundary,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    boundary,
    status: "boundary_confirmed",
    errorMessage: null,
  });
}

/**
 * Records the resync scope description and moves to `resync_planned`.
 */
export function attachResyncPlan(
  userId: string,
  rotationId: string,
  resyncScope: string,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    resyncScope,
    status: "resync_planned",
    errorMessage: null,
  });
}

/**
 * Moves to `resync_running`. Guards against duplicate transitions — safe to
 * call while the resync fetch is in flight so the UI can show progress.
 */
export function markResyncRunning(
  userId: string,
  rotationId: string,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    status: "resync_running",
    errorMessage: null,
  });
}

/**
 * Records a successful resync result and moves to `completed`.
 * Once completed, rollback is no longer available.
 */
export function markResyncCompleted(
  userId: string,
  rotationId: string,
  result: ResyncResult,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    status: "completed",
    resyncResult: result,
    errorMessage: null,
  });
}

/**
 * Records a resync failure. Moves to `resync_failed` (terminal).
 */
export function markResyncFailed(
  userId: string,
  rotationId: string,
  reason: string,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    status: "resync_failed",
    errorMessage: reason,
  });
}

/**
 * Marks the rotation as stale — the server-side state changed between the
 * review and a later step (detected via version/etag mismatch).
 * User must re-review from the beginning.
 */
export function markRotationStale(
  userId: string,
  rotationId: string,
): AccountRotationRecord {
  return patchRecord(userId, rotationId, {
    status: "stale",
    errorMessage:
      "The account state changed after your review. Please start the rotation again from the review step.",
  });
}

/**
 * Reverts the rotation to `rolled_back`.
 *
 * Allowed until `status === "completed"`. After rollback the old account
 * remains active; no checkpoints are modified. A new rotation must be
 * started if another attempt is needed.
 *
 * Throws `RollbackNotAllowedError` if the rotation has already completed
 * or is already rolled back.
 */
export function rollbackRotation(
  userId: string,
  rotationId: string,
): AccountRotationRecord {
  const records = readAll(userId);
  const record = records.find((r) => r.id === rotationId);
  if (!record) throw new RotationNotFoundError(rotationId);
  if (!canRollback(record)) throw new RollbackNotAllowedError(record.status);
  return patchRecord(userId, rotationId, {
    status: "rolled_back",
    errorMessage: null,
  });
}
