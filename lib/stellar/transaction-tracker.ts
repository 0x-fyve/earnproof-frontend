/**
 * Network-aware Stellar and contract transaction confirmation tracker (#253).
 *
 * Tracks durable progress across:
 *   - submission (`submitted`)
 *   - ledger inclusion (`included`)
 *   - finality (`finalized`)
 *   - failure (`failed`)
 *   - replacement / fee-bump (`replaced`)
 *   - timeout (`timed-out`)
 *   - ledger reorganization recovery (`included` -> `submitted` on reorg)
 *
 * Key safety invariants:
 * 1. Network isolation: an operation is permanently bound to the canonical
 *    Stellar network (`testnet` or `public`) on which it was submitted. A
 *    network switch can NEVER attach or migrate an operation to the wrong
 *    network, nor apply an update from a mismatched network.
 * 2. Monotonic terminal guarantees: a `replaced` or `failed` transaction can
 *    NEVER transition to `finalized` or appear finalized.
 * 3. Explorer & resource links: finalized operations resolve a validated
 *    network explorer link (`buildTransactionExplorerLink`) ONLY when the
 *    viewer's active network matches the operation's network.
 */

import { buildTransactionExplorerLink } from "./explorer";
import {
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  DEFAULT_OPERATION_RETENTION_MS,
  isValidTransactionHash,
  loadPersistedTransactionOperations,
  savePersistedTransactionOperation,
} from "@/lib/storage/transaction-operations";
import {
  localStorageDriver,
  type PersistedTransactionOperationRef,
  type StorageDriver,
} from "@/lib/storage";

export type CanonicalStellarNetwork = "testnet" | "public";

export type TransactionConfirmationStatus =
  PersistedTransactionOperationRef["status"];

export type TrackedOperationRecord = PersistedTransactionOperationRef;

const SAFE_RESOURCE_PATHS: ReadonlySet<string> = new Set([
  "/proofs",
  "/proofs/history",
  "/proofs/anchoring",
  "/proofs/minimum-income",
  "/proofs/payment-receipt",
  "/proofs/recurring-income",
  "/proofs/employer-payment",
  "/proofs/employment-continuity",
  "/proofs/invoice-settlement",
  "/proofs/aggregate-earnings",
  "/proofs/income-range",
  "/settings/security",
  "/settings/governance",
  "/settings/organizations",
  "/settings/issuers",
  "/verify",
]);

export class TransactionNetworkMismatchError extends Error {
  constructor(
    public readonly expectedNetwork: string,
    public readonly actualNetwork: string,
    message = `Network mismatch: operation is bound to "${expectedNetwork}" and cannot be attached to or updated from "${actualNetwork}".`,
  ) {
    super(message);
    this.name = "TransactionNetworkMismatchError";
  }
}

export class InvalidTransactionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransactionTransitionError";
  }
}

/**
 * Resolves a network string ("Stellar Testnet", "testnet", "PUBLIC", "mainnet")
 * into a canonical network identifier, or returns null if unsupported.
 */
export function resolveCanonicalNetwork(
  network: string | null | undefined,
): CanonicalStellarNetwork | null {
  if (typeof network !== "string") return null;
  const lower = network.trim().toLowerCase();
  if (lower === "testnet" || lower === "stellar testnet") return "testnet";
  if (
    lower === "public" ||
    lower === "mainnet" ||
    lower === "stellar public" ||
    lower === "stellar mainnet"
  ) {
    return "public";
  }
  return null;
}

export function sanitizeRelatedResourceHref(
  href: string | null | undefined,
): string | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) {
    return null;
  }
  const basePath = href.split("?")[0]?.split("#")[0] ?? "";
  return SAFE_RESOURCE_PATHS.has(basePath) ? basePath : null;
}

export interface SubmitTrackedOperationInput {
  operationId: string;
  transactionHash: string;
  network: string;
  resourceType: string;
  resourceId: string;
  resourceHref?: string | null;
  requiredConfirmations?: number;
  timeoutMs?: number;
  retentionMs?: number;
  nowMs?: number;
  /** Optional raw fields that might accidentally be passed by callers — never persisted. */
  signedEnvelopeXdr?: unknown;
  secretSeed?: unknown;
  signature?: unknown;
}

export interface SubmitTrackedOperationResult {
  record: TrackedOperationRecord;
  isDuplicate: boolean;
}

/**
 * Submits or recovers a tracked Stellar/contract operation.
 *
 * - Rejects unsupported networks or malformed transaction hashes.
 * - Duplicate submissions with the same `operationId` or `transactionHash` on
 *   the SAME network are idempotent and return the existing record without
 *   resetting confirmation state.
 * - Attempting to submit an existing `operationId` or `transactionHash` on a
 *   DIFFERENT network throws `TransactionNetworkMismatchError`.
 */
export function trackSubmittedTransaction(
  input: SubmitTrackedOperationInput,
  driver: StorageDriver = localStorageDriver,
): SubmitTrackedOperationResult {
  const canonicalNetwork = resolveCanonicalNetwork(input.network);
  if (!canonicalNetwork) {
    throw new InvalidTransactionTransitionError(
      `Unsupported Stellar network "${input.network}".`,
    );
  }

  if (!isValidTransactionHash(input.transactionHash)) {
    throw new InvalidTransactionTransitionError(
      "Transaction hash must be a 64-character lowercase hexadecimal string.",
    );
  }

  const normalizedHash = input.transactionHash.trim().toLowerCase();
  const nowMs = input.nowMs ?? Date.now();
  const existingMap = loadPersistedTransactionOperations(driver, nowMs);

  const existingById = existingMap[input.operationId];
  if (existingById) {
    if (existingById.network !== canonicalNetwork) {
      throw new TransactionNetworkMismatchError(
        existingById.network,
        canonicalNetwork,
      );
    }
    if (existingById.transactionHash !== normalizedHash) {
      throw new InvalidTransactionTransitionError(
        `Operation "${input.operationId}" is already bound to a different transaction hash.`,
      );
    }
    return { record: existingById, isDuplicate: true };
  }

  // Also check if the same transaction hash was already registered under another operation
  const existingByHash = Object.values(existingMap).find(
    (op) => op.transactionHash === normalizedHash,
  );
  if (existingByHash) {
    if (existingByHash.network !== canonicalNetwork) {
      throw new TransactionNetworkMismatchError(
        existingByHash.network,
        canonicalNetwork,
      );
    }
    return { record: existingByHash, isDuplicate: true };
  }

  const nowIso = new Date(nowMs).toISOString();
  const timeoutMs = input.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  const retentionMs = input.retentionMs ?? DEFAULT_OPERATION_RETENTION_MS;

  const created: TrackedOperationRecord = {
    operationId: input.operationId.trim(),
    transactionHash: normalizedHash,
    network: canonicalNetwork,
    status: "submitted",
    resourceType: input.resourceType.trim() || "contract-mutation",
    resourceId: input.resourceId.trim(),
    resourceHref: sanitizeRelatedResourceHref(input.resourceHref),
    ledger: null,
    confirmations: 0,
    requiredConfirmations: Math.max(1, input.requiredConfirmations ?? 3),
    replacedByHash: null,
    diagnosticMessage: null,
    reorgCount: 0,
    submittedAt: nowIso,
    updatedAt: nowIso,
    timeoutAt: new Date(nowMs + timeoutMs).toISOString(),
    expiresAt: new Date(nowMs + retentionMs).toISOString(),
  };

  const saved = savePersistedTransactionOperation(created, driver, nowMs);
  return { record: saved, isDuplicate: false };
}

export interface TransactionProgressUpdate {
  operationId: string;
  observedNetwork: string;
  type:
    | "included"
    | "finalized"
    | "failed"
    | "replaced"
    | "reorg"
    | "check-timeout";
  ledger?: number;
  confirmations?: number;
  replacementHash?: string;
  replacementOperationId?: string;
  diagnosticMessage?: string;
  nowMs?: number;
}

/**
 * Applies a state transition to a tracked operation while enforcing strict
 * network binding and terminal state invariants:
 *
 * - Network mismatch is always rejected (`TransactionNetworkMismatchError`).
 * - `failed` and `replaced` operations NEVER transition to `finalized` or `included`.
 * - `finalized` operations are terminal and ignore late failure/timeout/reorg updates.
 * - `reorg` on an `included` operation reverts it to `submitted` with 0 confirmations
 *   and increments `reorgCount`.
 */
export function applyTransactionProgressUpdate(
  update: TransactionProgressUpdate,
  driver: StorageDriver = localStorageDriver,
): TrackedOperationRecord {
  const nowMs = update.nowMs ?? Date.now();
  const existingMap = loadPersistedTransactionOperations(driver, nowMs);
  const current = existingMap[update.operationId];

  if (!current) {
    throw new InvalidTransactionTransitionError(
      `Tracked operation "${update.operationId}" not found or has expired.`,
    );
  }

  const observedNetwork = resolveCanonicalNetwork(update.observedNetwork);
  if (!observedNetwork || observedNetwork !== current.network) {
    throw new TransactionNetworkMismatchError(
      current.network,
      update.observedNetwork,
    );
  }

  // Terminal states: failed and replaced can NEVER become finalized or included
  if (current.status === "failed" || current.status === "replaced") {
    if (
      update.type === "finalized" ||
      update.type === "included" ||
      update.type === "reorg" ||
      update.type === "check-timeout"
    ) {
      throw new InvalidTransactionTransitionError(
        `Cannot transition operation "${current.operationId}" from terminal state "${current.status}" to "${update.type}".`,
      );
    }
    return current;
  }

  if (current.status === "finalized") {
    return current;
  }

  const nowIso = new Date(nowMs).toISOString();

  switch (update.type) {
    case "included": {
      const confirmations = Math.max(1, update.confirmations ?? 1);
      const nextStatus: TransactionConfirmationStatus =
        confirmations >= current.requiredConfirmations
          ? "finalized"
          : "included";
      const updated: TrackedOperationRecord = {
        ...current,
        status: nextStatus,
        ledger: update.ledger ?? current.ledger ?? 1,
        confirmations,
        diagnosticMessage:
          update.diagnosticMessage ??
          (nextStatus === "finalized"
            ? "Transaction finalized on network."
            : "Transaction included in ledger; awaiting finality threshold."),
        updatedAt: nowIso,
      };
      return savePersistedTransactionOperation(updated, driver, nowMs);
    }

    case "finalized": {
      const updated: TrackedOperationRecord = {
        ...current,
        status: "finalized",
        ledger: update.ledger ?? current.ledger ?? 1,
        confirmations: Math.max(
          current.requiredConfirmations,
          update.confirmations ?? current.requiredConfirmations,
        ),
        diagnosticMessage:
          update.diagnosticMessage ?? "Transaction finalized on network.",
        updatedAt: nowIso,
      };
      return savePersistedTransactionOperation(updated, driver, nowMs);
    }

    case "reorg": {
      // Ledger reorganization or horizon drop before finality reverts inclusion to submitted
      const updated: TrackedOperationRecord = {
        ...current,
        status: "submitted",
        ledger: null,
        confirmations: 0,
        reorgCount: current.reorgCount + 1,
        diagnosticMessage:
          update.diagnosticMessage ??
          "Ledger reorganization observed before finality; awaiting re-inclusion.",
        updatedAt: nowIso,
      };
      return savePersistedTransactionOperation(updated, driver, nowMs);
    }

    case "failed": {
      const updated: TrackedOperationRecord = {
        ...current,
        status: "failed",
        confirmations: 0,
        diagnosticMessage:
          update.diagnosticMessage ??
          "Transaction execution failed on the network.",
        updatedAt: nowIso,
      };
      return savePersistedTransactionOperation(updated, driver, nowMs);
    }

    case "replaced": {
      if (!isValidTransactionHash(update.replacementHash)) {
        throw new InvalidTransactionTransitionError(
          "Replacement transaction hash must be a valid 64-character lowercase hex string.",
        );
      }
      const normalizedReplacement = update.replacementHash.trim().toLowerCase();
      if (normalizedReplacement === current.transactionHash) {
        throw new InvalidTransactionTransitionError(
          "Replacement transaction hash must differ from the original hash.",
        );
      }

      const updated: TrackedOperationRecord = {
        ...current,
        status: "replaced",
        confirmations: 0,
        replacedByHash: normalizedReplacement,
        diagnosticMessage:
          update.diagnosticMessage ??
          "Superseded by fee-bump or replacement transaction.",
        updatedAt: nowIso,
      };
      const savedOriginal = savePersistedTransactionOperation(
        updated,
        driver,
        nowMs,
      );

      if (update.replacementOperationId) {
        trackSubmittedTransaction(
          {
            operationId: update.replacementOperationId,
            transactionHash: normalizedReplacement,
            network: current.network,
            resourceType: current.resourceType,
            resourceId: current.resourceId,
            resourceHref: current.resourceHref,
            requiredConfirmations: current.requiredConfirmations,
            nowMs,
          },
          driver,
        );
      }

      return savedOriginal;
    }

    case "check-timeout": {
      const timeoutMs = new Date(current.timeoutAt).getTime();
      if (nowMs >= timeoutMs) {
        const updated: TrackedOperationRecord = {
          ...current,
          status: "timed-out",
          diagnosticMessage:
            update.diagnosticMessage ??
            "Confirmation window timed out before finality was reached.",
          updatedAt: nowIso,
        };
        return savePersistedTransactionOperation(updated, driver, nowMs);
      }
      return current;
    }
  }
}

export interface OperationPresentationView {
  operation: TrackedOperationRecord;
  isNetworkMatch: boolean;
  networkMismatchReason: string | null;
  /** Non-null ONLY when status === "finalized" AND activeNetwork matches operation.network. */
  explorerHref: string | null;
  /** Non-null ONLY when status === "finalized" AND activeNetwork matches operation.network. */
  relatedResourceHref: string | null;
}

/**
 * Resolves how a tracked operation should be presented for the viewer's
 * current active network.
 *
 * Ensures:
 * - A network switch never attaches an operation to the wrong network or
 *   generates an explorer link for the wrong network.
 * - Replaced or failed transactions never appear finalized or expose finalized
 *   explorer/resource links.
 */
export function resolveOperationPresentation(
  operation: TrackedOperationRecord,
  activeViewerNetwork: string,
): OperationPresentationView {
  const viewerCanonical = resolveCanonicalNetwork(activeViewerNetwork);
  const isNetworkMatch = viewerCanonical === operation.network;

  if (!isNetworkMatch) {
    return {
      operation,
      isNetworkMatch: false,
      networkMismatchReason: `This operation was submitted on Stellar ${operation.network}, while your active network is "${activeViewerNetwork}". Switch back to ${operation.network} to verify or inspect its explorer record.`,
      explorerHref: null,
      relatedResourceHref: null,
    };
  }

  if (operation.status !== "finalized") {
    return {
      operation,
      isNetworkMatch: true,
      networkMismatchReason: null,
      explorerHref: null,
      relatedResourceHref: null,
    };
  }

  const explorerResult = buildTransactionExplorerLink(
    operation.network,
    operation.transactionHash,
  );

  return {
    operation,
    isNetworkMatch: true,
    networkMismatchReason: null,
    explorerHref: explorerResult.ok ? explorerResult.href : null,
    relatedResourceHref: sanitizeRelatedResourceHref(operation.resourceHref),
  };
}

/**
 * Recovers all non-expired tracked operations across browser refresh,
 * evaluating any pending timeouts and resolving presentation for the active
 * network.
 */
export function recoverTrackedOperationsForNetwork(
  activeViewerNetwork: string,
  driver: StorageDriver = localStorageDriver,
  nowMs = Date.now(),
): OperationPresentationView[] {
  const stored = loadPersistedTransactionOperations(driver, nowMs);
  const views: OperationPresentationView[] = [];

  for (const op of Object.values(stored)) {
    let latest = op;
    if (
      (op.status === "submitted" || op.status === "included") &&
      new Date(op.timeoutAt).getTime() <= nowMs
    ) {
      latest = applyTransactionProgressUpdate(
        {
          operationId: op.operationId,
          observedNetwork: op.network,
          type: "check-timeout",
          nowMs,
        },
        driver,
      );
    }
    views.push(resolveOperationPresentation(latest, activeViewerNetwork));
  }

  return views.sort(
    (a, b) =>
      new Date(b.operation.submittedAt).getTime() -
      new Date(a.operation.submittedAt).getTime(),
  );
}
