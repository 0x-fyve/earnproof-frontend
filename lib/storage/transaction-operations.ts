/**
 * Bounded-expiry persistence for non-sensitive Stellar/contract transaction
 * operation references (#253).
 *
 * Security and privacy guarantees:
 * - Only non-sensitive operation references (operation ID, transaction hash,
 *   canonical network, status, resource reference, ledger/confirmation counts,
 *   and redacted diagnostics) are persisted.
 * - Signed XDR envelopes, wallet signatures, secret seeds, bearer tokens, and
 *   raw credential payloads are NEVER persisted.
 * - Every record carries a bounded `expiresAt` timestamp (capped at 7 days,
 *   24 hours default) and expired records are automatically pruned.
 */

import { redactMessage } from "@/lib/telemetry/redact";
import {
  getStorageValue,
  localStorageDriver,
  removeStorageValue,
  setStorageValue,
  type PersistedTransactionOperationRef,
  type StorageDriver,
} from "./index";

export const DEFAULT_OPERATION_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_OPERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "included",
  "finalized",
  "failed",
  "replaced",
  "timed-out",
]);

const TX_HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isValidTransactionHash(value: unknown): value is string {
  return typeof value === "string" && TX_HASH_PATTERN.test(value.trim().toLowerCase());
}

function isPersistedOperationRef(
  value: unknown,
): value is PersistedTransactionOperationRef {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.operationId === "string" &&
    r.operationId.length > 0 &&
    isValidTransactionHash(r.transactionHash) &&
    (r.network === "testnet" || r.network === "public") &&
    typeof r.status === "string" &&
    VALID_STATUSES.has(r.status) &&
    typeof r.resourceType === "string" &&
    typeof r.resourceId === "string" &&
    (r.resourceHref === null || typeof r.resourceHref === "string") &&
    (r.ledger === null || typeof r.ledger === "number") &&
    typeof r.confirmations === "number" &&
    typeof r.requiredConfirmations === "number" &&
    (r.replacedByHash === null || isValidTransactionHash(r.replacedByHash)) &&
    (r.diagnosticMessage === null || typeof r.diagnosticMessage === "string") &&
    typeof r.reorgCount === "number" &&
    typeof r.submittedAt === "string" &&
    typeof r.updatedAt === "string" &&
    typeof r.timeoutAt === "string" &&
    typeof r.expiresAt === "string"
  );
}

/**
 * Strips any sensitive fields and redacts diagnostic text before persisting.
 */
export function sanitizeOperationForStorage(
  record: PersistedTransactionOperationRef,
  nowMs = Date.now(),
): PersistedTransactionOperationRef {
  const maxExpiresAtMs = nowMs + MAX_OPERATION_RETENTION_MS;
  const parsedExpiry = new Date(record.expiresAt).getTime();
  const boundedExpiryMs = Number.isFinite(parsedExpiry)
    ? Math.min(parsedExpiry, maxExpiresAtMs)
    : nowMs + DEFAULT_OPERATION_RETENTION_MS;

  return {
    operationId: record.operationId.trim(),
    transactionHash: record.transactionHash.trim().toLowerCase(),
    network: record.network,
    status: record.status,
    resourceType: record.resourceType.trim(),
    resourceId: redactMessage(record.resourceId) || record.resourceId.trim(),
    resourceHref: record.resourceHref,
    ledger: record.ledger,
    confirmations: Math.max(0, Math.floor(record.confirmations)),
    requiredConfirmations: Math.max(1, Math.floor(record.requiredConfirmations)),
    replacedByHash: record.replacedByHash
      ? record.replacedByHash.trim().toLowerCase()
      : null,
    diagnosticMessage: record.diagnosticMessage
      ? redactMessage(record.diagnosticMessage)
      : null,
    reorgCount: Math.max(0, Math.floor(record.reorgCount)),
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    timeoutAt: record.timeoutAt,
    expiresAt: new Date(boundedExpiryMs).toISOString(),
  };
}

/**
 * Loads all non-expired, valid persisted transaction operations, pruning any
 * expired or corrupted entries automatically.
 */
export function loadPersistedTransactionOperations(
  driver: StorageDriver = localStorageDriver,
  nowMs = Date.now(),
): Record<string, PersistedTransactionOperationRef> {
  const stored = getStorageValue("TRANSACTION_OPERATIONS", driver);
  if (!stored?.data || typeof stored.data !== "object") {
    return {};
  }

  const active: Record<string, PersistedTransactionOperationRef> = {};
  let prunedAny = false;

  for (const [key, candidate] of Object.entries(stored.data)) {
    if (!isPersistedOperationRef(candidate)) {
      prunedAny = true;
      continue;
    }

    const expiryMs = new Date(candidate.expiresAt).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) {
      prunedAny = true;
      continue;
    }

    active[key] = sanitizeOperationForStorage(candidate, nowMs);
  }

  if (prunedAny) {
    if (Object.keys(active).length === 0) {
      removeStorageValue("TRANSACTION_OPERATIONS", driver);
    } else {
      setStorageValue("TRANSACTION_OPERATIONS", { data: active }, driver);
    }
  }

  return active;
}

/**
 * Persists a single sanitized transaction operation reference with bounded expiry.
 */
export function savePersistedTransactionOperation(
  record: PersistedTransactionOperationRef,
  driver: StorageDriver = localStorageDriver,
  nowMs = Date.now(),
): PersistedTransactionOperationRef {
  const active = loadPersistedTransactionOperations(driver, nowMs);
  const sanitized = sanitizeOperationForStorage(record, nowMs);
  active[sanitized.operationId] = sanitized;
  setStorageValue("TRANSACTION_OPERATIONS", { data: active }, driver);
  return sanitized;
}

/**
 * Removes a single transaction operation reference from storage.
 */
export function removePersistedTransactionOperation(
  operationId: string,
  driver: StorageDriver = localStorageDriver,
  nowMs = Date.now(),
): void {
  const active = loadPersistedTransactionOperations(driver, nowMs);
  if (!(operationId in active)) return;
  delete active[operationId];
  if (Object.keys(active).length === 0) {
    removeStorageValue("TRANSACTION_OPERATIONS", driver);
  } else {
    setStorageValue("TRANSACTION_OPERATIONS", { data: active }, driver);
  }
}

/**
 * Clears all persisted transaction operation references.
 */
export function clearPersistedTransactionOperations(
  driver: StorageDriver = localStorageDriver,
): void {
  removeStorageValue("TRANSACTION_OPERATIONS", driver);
}
