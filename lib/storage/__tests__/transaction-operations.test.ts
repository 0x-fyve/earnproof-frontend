import {
  clearPersistedTransactionOperations,
  loadPersistedTransactionOperations,
  removePersistedTransactionOperation,
  savePersistedTransactionOperation,
  type PersistedTransactionOperationRef,
} from "../transaction-operations";
import { type StorageDriver, type StorageKey, STORAGE_KEYS } from "../index";

class MemoryStorageDriver implements StorageDriver {
  private store: Record<string, string> = {};

  getItem<K extends StorageKey>(key: K): string | null {
    return this.store[STORAGE_KEYS[key]] ?? null;
  }

  setItem<K extends StorageKey>(key: K, value: string): void {
    this.store[STORAGE_KEYS[key]] = value;
  }

  removeItem<K extends StorageKey>(key: K): void {
    delete this.store[STORAGE_KEYS[key]];
  }
}

const VALID_HASH =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Transaction operations persistence (#253)", () => {
  let driver: MemoryStorageDriver;

  beforeEach(() => {
    driver = new MemoryStorageDriver();
  });

  it("persists non-sensitive operation references and bounds retention expiry", () => {
    const baseNow = 1_700_000_000_000;
    const op: PersistedTransactionOperationRef = {
      operationId: "op-1",
      transactionHash: VALID_HASH,
      network: "testnet",
      status: "submitted",
      resourceType: "proof-anchor",
      resourceId: "EP-8A42-91DC",
      resourceHref: "/proofs/anchoring",
      ledger: null,
      confirmations: 0,
      requiredConfirmations: 3,
      replacedByHash: null,
      diagnosticMessage:
        "Submitting anchor from account GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345",
      reorgCount: 0,
      submittedAt: new Date(baseNow).toISOString(),
      updatedAt: new Date(baseNow).toISOString(),
      timeoutAt: new Date(baseNow + 120_000).toISOString(),
      expiresAt: new Date(baseNow + 30 * 24 * 60 * 60 * 1000).toISOString(), // excessively long expiry requested
    };

    const saved = savePersistedTransactionOperation(op, driver, baseNow);

    // Bounded to MAX_OPERATION_RETENTION_MS (7 days)
    const maxAllowedExpiry = baseNow + 7 * 24 * 60 * 60 * 1000;
    expect(new Date(saved.expiresAt).getTime()).toBeLessThanOrEqual(
      maxAllowedExpiry,
    );

    // Diagnostics are redacted
    expect(saved.diagnosticMessage).not.toContain(
      "GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345",
    );

    const loaded = loadPersistedTransactionOperations(driver, baseNow);
    expect(loaded["op-1"]).toBeDefined();
    expect(loaded["op-1"]?.operationId).toBe("op-1");
  });

  it("prunes expired transaction operations automatically on load", () => {
    const baseNow = 1_700_000_000_000;
    const op: PersistedTransactionOperationRef = {
      operationId: "op-expired",
      transactionHash: VALID_HASH,
      network: "public",
      status: "finalized",
      resourceType: "proof-anchor",
      resourceId: "EP-1111-2222",
      resourceHref: "/proofs/anchoring",
      ledger: 123456,
      confirmations: 3,
      requiredConfirmations: 3,
      replacedByHash: null,
      diagnosticMessage: "Finalized",
      reorgCount: 0,
      submittedAt: new Date(baseNow - 48 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(baseNow - 47 * 60 * 60 * 1000).toISOString(),
      timeoutAt: new Date(baseNow - 47 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(baseNow - 1000).toISOString(), // already expired
    };

    savePersistedTransactionOperation(op, driver, baseNow - 48 * 60 * 60 * 1000);

    const active = loadPersistedTransactionOperations(driver, baseNow);
    expect(active["op-expired"]).toBeUndefined();
  });

  it("removes and clears operations cleanly", () => {
    const baseNow = 1_700_000_000_000;
    const op: PersistedTransactionOperationRef = {
      operationId: "op-remove",
      transactionHash: VALID_HASH,
      network: "testnet",
      status: "submitted",
      resourceType: "proof-anchor",
      resourceId: "EP-1234-5678",
      resourceHref: null,
      ledger: null,
      confirmations: 0,
      requiredConfirmations: 2,
      replacedByHash: null,
      diagnosticMessage: null,
      reorgCount: 0,
      submittedAt: new Date(baseNow).toISOString(),
      updatedAt: new Date(baseNow).toISOString(),
      timeoutAt: new Date(baseNow + 60_000).toISOString(),
      expiresAt: new Date(baseNow + 86_400_000).toISOString(),
    };

    savePersistedTransactionOperation(op, driver, baseNow);
    removePersistedTransactionOperation("op-remove", driver, baseNow);

    expect(loadPersistedTransactionOperations(driver, baseNow)["op-remove"]).toBeUndefined();

    savePersistedTransactionOperation(op, driver, baseNow);
    clearPersistedTransactionOperations(driver);
    expect(Object.keys(loadPersistedTransactionOperations(driver, baseNow))).toHaveLength(0);
  });
});
