/**
 * General-purpose idempotent-operation tracking and recovery (#254).
 *
 * Long-running mutations (proof issuance, payment sync, and — once #251
 * ships — bulk admin actions) can time out client-side after the server
 * has already accepted the request, leaving the user unsure whether a
 * retry would duplicate work. This module is the reusable mechanism for
 * that: it persists an idempotency key per logical operation intent,
 * classifies what happened to an interrupted attempt, and exposes bounded
 * polling against lib/api/operation-status.ts so the UI can offer a safe
 * recovery action (resume / retry / contact support) instead of a blind
 * "try again" button.
 *
 * STRUCTURAL TEMPLATE: lib/wallet-rotation/store.ts. That module is the
 * closest existing precedent — a client-local, localStorage-backed record
 * store with a typed runtime guard (`isWalletRotationRecord`), pure
 * query/mutation functions, a dedicated error class for an invalid
 * transition, and a time-window validity check (`areBothChallengesValid`)
 * — which maps directly onto what #254 needs: a typed record, a guard, a
 * terminal-state/expiry check, and an error type for the conflict case.
 * lib/organization-archival/store.ts was the second closest candidate, but
 * its per-user keying and "immediately mark READY" simplification don't
 * carry over — #254 needs multi-tenant scoping and a genuine pending
 * state, both of which wallet-rotation's shape already anticipates even
 * though it doesn't need tenant scoping itself.
 *
 * HOW #251 (bulk admin action review, not yet implemented) SHOULD CONSUME
 * THIS: once a bulk-action mutation exists, it should call
 * `resolveOperationKey(previous, intent)` to get its idempotency key (the
 * same function proof issuance and payment sync use below), persist the
 * resulting record with `recordOperationStart`, and on a timeout/lost
 * response, render `<OperationRecoveryPanel>` (components/common) wired to
 * `pollUntilTerminal` for that key — exactly the pattern
 * components/proofs/create-proof-flow.tsx and
 * components/payments/payment-sync-panel.tsx follow in this pass. It
 * should NOT invent its own key-generation or status-polling logic.
 */
import {
  fetchOperationStatus,
  OperationStatusConflictError,
  type OperationStatusResponse,
  type OperationTerminalState,
} from "@/lib/api/operation-status";

const STORAGE_KEY = "earnproof.idempotent-operations";

/** How long a client-local operation record may be resumed against before
 * it's treated as expired. Chosen to comfortably exceed this client's
 * request timeout (lib/api/client.ts's DEFAULT_TIMEOUT_MS = 10s) and any
 * realistic human "did it go through?" hesitation window, while still
 * bounding how long a stale record can mislead a later session. */
export const OPERATION_RECORD_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type OperationKind = "proof-issuance" | "payment-sync" | "bulk-action" | "import";

export interface OperationRecord {
  idempotencyKey: string;
  /** A stable signature of the logical intent (see `intentSignature`). A
   * retry of the *same* intent reuses this record's key; a different
   * intent always mints a new record. */
  signature: string;
  kind: OperationKind;
  tenantId: string;
  createdAt: string;
  /** Last known terminal state this client has observed, or "pending" if
   * the initiating request's response was never observed (the timeout/lost
   * response case this issue targets). */
  lastKnownState: OperationTerminalState;
  updatedAt: string;
}

function isOperationRecord(value: unknown): value is OperationRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.idempotencyKey === "string" &&
    typeof r.signature === "string" &&
    typeof r.kind === "string" &&
    typeof r.tenantId === "string" &&
    typeof r.createdAt === "string" &&
    typeof r.lastKnownState === "string" &&
    typeof r.updatedAt === "string"
  );
}

function readAll(): OperationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOperationRecord);
  } catch {
    return [];
  }
}

function writeAll(records: OperationRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function generateKey(): string {
  const cryptoObj: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoObj && "randomUUID" in cryptoObj) {
    return cryptoObj.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Same ordering-insensitive-array normalization as lib/proofs/idempotency.ts,
 * generalized to any intent shape (bulk-action intents will carry a
 * `targetIds` array; proof/sync intents carry theirs under other names). */
const ORDER_INSENSITIVE_ARRAY_FIELDS = ["selectedPaymentIds", "sourceIds", "targetIds"];

export type OperationIntent = Record<string, unknown>;

export function intentSignature(intent: OperationIntent): string {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(intent).sort()) {
    const value = intent[key];
    normalized[key] =
      ORDER_INSENSITIVE_ARRAY_FIELDS.includes(key) && Array.isArray(value)
        ? [...value].sort()
        : value ?? null;
  }
  return JSON.stringify(normalized);
}

/**
 * Finds a still-resumable (non-expired) record for this exact tenant +
 * kind + intent signature. Cross-tenant isolation: a record is matched
 * strictly by `tenantId`, so a key minted under tenant A is never returned
 * — let alone resolved — for tenant B, even if the intent signature is
 * byte-identical.
 */
export function findResumableRecord(
  tenantId: string,
  kind: OperationKind,
  signature: string,
  now: number = Date.now(),
): OperationRecord | null {
  const match = readAll().find(
    (record) =>
      record.tenantId === tenantId &&
      record.kind === kind &&
      record.signature === signature &&
      !isExpired(record, now),
  );
  return match ?? null;
}

export function isExpired(record: OperationRecord, now: number = Date.now()): boolean {
  return now - Date.parse(record.createdAt) > OPERATION_RECORD_TTL_MS;
}

/**
 * Decides the idempotency key for an operation attempt, mirroring
 * lib/proofs/idempotency.ts's resolveIdempotencyKey but persisted (so it
 * survives a page reload after a timeout, not just a component's lifetime)
 * and tenant-scoped.
 *
 * - No existing resumable record for this tenant+kind+intent: mint a new
 *   key and persist a fresh "pending" record. This is the only place a new
 *   key is ever generated.
 * - A resumable (non-expired) record already exists for the identical
 *   intent: reuse its key and DO NOT mint a new one — this is the
 *   never-duplicate-an-in-flight-retry guarantee the issue requires. The
 *   existing record's lastKnownState is left untouched; call
 *   `markOperationState` separately once the retry's outcome is known.
 * - An expired record exists for the identical intent: treated as if no
 *   record existed — a new key is minted, since resuming against an
 *   expired record would be the "expired records must fail safely" case,
 *   not a legitimate resume target.
 */
export function resolveOperationKey(
  tenantId: string,
  kind: OperationKind,
  intent: OperationIntent,
  now: number = Date.now(),
): OperationRecord {
  const signature = intentSignature(intent);
  const existing = findResumableRecord(tenantId, kind, signature, now);
  if (existing) {
    return existing;
  }

  const nowIso = new Date(now).toISOString();
  const record: OperationRecord = {
    idempotencyKey: generateKey(),
    signature,
    kind,
    tenantId,
    createdAt: nowIso,
    lastKnownState: "pending",
    updatedAt: nowIso,
  };
  const records = readAll();
  records.push(record);
  writeAll(records);
  return record;
}

/** Updates a record's last-known terminal state (e.g. after the mutation's
 * own response resolves, or after a status poll). No-ops if the key isn't
 * found (e.g. it already expired and was pruned). */
export function markOperationState(
  idempotencyKey: string,
  state: OperationTerminalState,
  now: number = Date.now(),
): void {
  const records = readAll();
  const index = records.findIndex((record) => record.idempotencyKey === idempotencyKey);
  if (index === -1) return;
  records[index] = { ...records[index], lastKnownState: state, updatedAt: new Date(now).toISOString() };
  writeAll(records);
}

/** Removes a record entirely — called once an operation reaches a state
 * from which no further resume/retry makes sense (succeeded, or a fresh
 * attempt the caller intends to treat as a brand-new intent). */
export function clearOperationRecord(idempotencyKey: string): void {
  writeAll(readAll().filter((record) => record.idempotencyKey !== idempotencyKey));
}

export function listOperationRecords(tenantId: string): OperationRecord[] {
  return readAll().filter((record) => record.tenantId === tenantId);
}

/**
 * Resolves what a record's state means for recovery UI purposes,
 * collapsing "expired" and "poll came back unknown" into the same safe
 * "unknown" bucket — the #254 acceptance criterion that an expired or
 * unresolvable record must never be reported as a definite success or
 * failure.
 */
export function resolveOperationOutcome(
  record: OperationRecord,
  now: number = Date.now(),
): OperationTerminalState {
  if (isExpired(record, now)) {
    return "unknown";
  }
  return record.lastKnownState;
}

/**
 * Bounded polling against lib/api/operation-status.ts's status endpoint.
 * Stops as soon as a terminal (non-"pending") state is observed, or after
 * `maxAttempts` polls, whichever comes first — this is a *bounded* status
 * check per the issue text, never an unbounded poll loop. A 409-shaped
 * conflict (the server's record changed in a way this client didn't
 * expect — someone else resumed or cancelled it) is surfaced by throwing
 * `OperationStatusConflictError` rather than being silently absorbed into
 * "unknown", since a conflict is actionable information a resumed/caller
 * should see, not an ordinary unknown-state case.
 */
export async function pollUntilTerminal(
  record: OperationRecord,
  token: string,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    signal?: AbortSignal;
    now?: () => number;
  } = {},
): Promise<OperationStatusResponse> {
  const { maxAttempts = 5, delayMs = 1000, signal, now = Date.now } = options;

  if (isExpired(record, now())) {
    markOperationState(record.idempotencyKey, "unknown", now());
    return { idempotencyKey: record.idempotencyKey, state: "unknown" };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      return { idempotencyKey: record.idempotencyKey, state: "unknown" };
    }

    const status = await fetchOperationStatus(record.idempotencyKey, token, signal);

    if (status.updatedAt && Date.parse(status.updatedAt) < Date.parse(record.updatedAt)) {
      // The server reports a record state older than what this client last
      // observed — a conflicting view of the same key. Surfaced, not
      // swallowed: the caller must decide how to reconcile it, rather than
      // this client silently trusting a stale read.
      throw new OperationStatusConflictError(status);
    }

    markOperationState(record.idempotencyKey, status.state, now());

    if (status.state !== "pending") {
      return status;
    }

    const isLast = attempt === maxAttempts - 1;
    if (isLast) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { idempotencyKey: record.idempotencyKey, state: "pending" };
}

export { OperationStatusConflictError };
export type { OperationStatusResponse, OperationTerminalState };
