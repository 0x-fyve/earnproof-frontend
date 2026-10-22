import {
  applyTransactionProgressUpdate,
  InvalidTransactionTransitionError,
  recoverTrackedOperationsForNetwork,
  resolveOperationPresentation,
  trackSubmittedTransaction,
  TransactionNetworkMismatchError,
} from "../transaction-tracker";
import { type StorageDriver, type StorageKey, STORAGE_KEYS } from "@/lib/storage";

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

const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_REPLACEMENT =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

describe("Network-aware transaction confirmation tracker (#253)", () => {
  let driver: MemoryStorageDriver;
  const baseNow = 1_700_000_000_000;

  beforeEach(() => {
    driver = new MemoryStorageDriver();
  });

  describe("submission and duplicate submission handling", () => {
    it("submits a new transaction operation bound to its canonical network", () => {
      const result = trackSubmittedTransaction(
        {
          operationId: "op-anchoring-1",
          transactionHash: HASH_A,
          network: "Stellar Testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-8A42-91DC",
          resourceHref: "/proofs/anchoring",
          requiredConfirmations: 3,
          nowMs: baseNow,
        },
        driver,
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.record.network).toBe("testnet");
      expect(result.record.status).toBe("submitted");
      expect(result.record.confirmations).toBe(0);
    });

    it("duplicate submission on the same network is idempotent without resetting progress", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-anchoring-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-8A42-91DC",
          nowMs: baseNow,
        },
        driver,
      );

      // Advance confirmation
      applyTransactionProgressUpdate(
        {
          operationId: "op-anchoring-1",
          observedNetwork: "testnet",
          type: "included",
          ledger: 500,
          confirmations: 2,
          nowMs: baseNow + 5000,
        },
        driver,
      );

      // Duplicate submission attempt with same operationId & hash
      const duplicateResult = trackSubmittedTransaction(
        {
          operationId: "op-anchoring-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-8A42-91DC",
          nowMs: baseNow + 10_000,
        },
        driver,
      );

      expect(duplicateResult.isDuplicate).toBe(true);
      expect(duplicateResult.record.status).toBe("included");
      expect(duplicateResult.record.confirmations).toBe(2);
    });

    it("rejects duplicate submission across mismatched networks", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-anchoring-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-8A42-91DC",
          nowMs: baseNow,
        },
        driver,
      );

      expect(() =>
        trackSubmittedTransaction(
          {
            operationId: "op-anchoring-1",
            transactionHash: HASH_A,
            network: "public", // mismatched network!
            resourceType: "proof-anchor",
            resourceId: "EP-8A42-91DC",
            nowMs: baseNow,
          },
          driver,
        ),
      ).toThrow(TransactionNetworkMismatchError);
    });
  });

  describe("network mismatch protection on updates", () => {
    it("rejects an update observation coming from a different network", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-testnet-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-8A42-91DC",
          nowMs: baseNow,
        },
        driver,
      );

      expect(() =>
        applyTransactionProgressUpdate(
          {
            operationId: "op-testnet-1",
            observedNetwork: "public",
            type: "included",
            ledger: 100,
            nowMs: baseNow + 1000,
          },
          driver,
        ),
      ).toThrow(TransactionNetworkMismatchError);
    });
  });

  describe("lifecycle transitions: inclusion, finality, and reorganization", () => {
    it("transitions from submitted to included and finalized once required confirmations are met", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-flow-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-1111",
          requiredConfirmations: 2,
          nowMs: baseNow,
        },
        driver,
      );

      const included = applyTransactionProgressUpdate(
        {
          operationId: "op-flow-1",
          observedNetwork: "testnet",
          type: "included",
          ledger: 1001,
          confirmations: 1,
          nowMs: baseNow + 2000,
        },
        driver,
      );
      expect(included.status).toBe("included");
      expect(included.confirmations).toBe(1);

      const finalized = applyTransactionProgressUpdate(
        {
          operationId: "op-flow-1",
          observedNetwork: "testnet",
          type: "included",
          ledger: 1002,
          confirmations: 2,
          nowMs: baseNow + 4000,
        },
        driver,
      );
      expect(finalized.status).toBe("finalized");
      expect(finalized.confirmations).toBe(2);
    });

    it("reverts an included transaction to submitted upon ledger reorganization", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-reorg-1",
          transactionHash: HASH_A,
          network: "public",
          resourceType: "contract-mutation",
          resourceId: "policy-1",
          requiredConfirmations: 3,
          nowMs: baseNow,
        },
        driver,
      );

      applyTransactionProgressUpdate(
        {
          operationId: "op-reorg-1",
          observedNetwork: "public",
          type: "included",
          ledger: 200,
          confirmations: 1,
          nowMs: baseNow + 2000,
        },
        driver,
      );

      // Reorganization occurs before finality
      const reorged = applyTransactionProgressUpdate(
        {
          operationId: "op-reorg-1",
          observedNetwork: "public",
          type: "reorg",
          nowMs: baseNow + 4000,
        },
        driver,
      );

      expect(reorged.status).toBe("submitted");
      expect(reorged.confirmations).toBe(0);
      expect(reorged.ledger).toBeNull();
      expect(reorged.reorgCount).toBe(1);
    });
  });

  describe("terminal states: replaced and failed transactions never appear finalized", () => {
    it("replaced transactions never transition to finalized", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-replace-test",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-2222",
          nowMs: baseNow,
        },
        driver,
      );

      const replaced = applyTransactionProgressUpdate(
        {
          operationId: "op-replace-test",
          observedNetwork: "testnet",
          type: "replaced",
          replacementHash: HASH_REPLACEMENT,
          replacementOperationId: "op-replacement-1",
          nowMs: baseNow + 3000,
        },
        driver,
      );

      expect(replaced.status).toBe("replaced");
      expect(replaced.replacedByHash).toBe(HASH_REPLACEMENT);

      // Attempting to finalize a replaced transaction fails closed
      expect(() =>
        applyTransactionProgressUpdate(
          {
            operationId: "op-replace-test",
            observedNetwork: "testnet",
            type: "finalized",
            nowMs: baseNow + 5000,
          },
          driver,
        ),
      ).toThrow(InvalidTransactionTransitionError);
    });

    it("failed transactions never transition to finalized", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-fail-test",
          transactionHash: HASH_B,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-3333",
          nowMs: baseNow,
        },
        driver,
      );

      const failed = applyTransactionProgressUpdate(
        {
          operationId: "op-fail-test",
          observedNetwork: "testnet",
          type: "failed",
          diagnosticMessage: "Transaction malformed on-chain.",
          nowMs: baseNow + 2000,
        },
        driver,
      );

      expect(failed.status).toBe("failed");

      expect(() =>
        applyTransactionProgressUpdate(
          {
            operationId: "op-fail-test",
            observedNetwork: "testnet",
            type: "finalized",
            nowMs: baseNow + 4000,
          },
          driver,
        ),
      ).toThrow(InvalidTransactionTransitionError);
    });
  });

  describe("timeout and refresh recovery across browser sessions", () => {
    it("transitions submitted operations to timed-out once timeout bound expires", () => {
      const shortTimeoutMs = 5000;
      trackSubmittedTransaction(
        {
          operationId: "op-timeout-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-4444",
          timeoutMs: shortTimeoutMs,
          nowMs: baseNow,
        },
        driver,
      );

      const timedOut = applyTransactionProgressUpdate(
        {
          operationId: "op-timeout-1",
          observedNetwork: "testnet",
          type: "check-timeout",
          nowMs: baseNow + shortTimeoutMs + 1000,
        },
        driver,
      );

      expect(timedOut.status).toBe("timed-out");
    });

    it("recovers tracked operations across refresh, automatically evaluating timeouts", () => {
      trackSubmittedTransaction(
        {
          operationId: "op-refresh-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-5555",
          timeoutMs: 10_000,
          nowMs: baseNow,
        },
        driver,
      );

      // Simulate page refresh 15 seconds later
      const recovered = recoverTrackedOperationsForNetwork(
        "testnet",
        driver,
        baseNow + 15_000,
      );

      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.operation.status).toBe("timed-out");
      expect(recovered[0]?.isNetworkMatch).toBe(true);
    });
  });

  describe("explorer and resource link presentation", () => {
    it("exposes explorer and resource links only when finalized on the matching active network", () => {
      const record = trackSubmittedTransaction(
        {
          operationId: "op-link-1",
          transactionHash: HASH_A,
          network: "testnet",
          resourceType: "proof-anchor",
          resourceId: "EP-6666",
          resourceHref: "/proofs/anchoring",
          requiredConfirmations: 1,
          nowMs: baseNow,
        },
        driver,
      ).record;

      // 1. Not finalized yet -> no explorer link
      const submittedView = resolveOperationPresentation(record, "testnet");
      expect(submittedView.explorerHref).toBeNull();
      expect(submittedView.relatedResourceHref).toBeNull();

      // 2. Finalized on testnet -> explorer link generated for testnet
      const finalized = applyTransactionProgressUpdate(
        {
          operationId: "op-link-1",
          observedNetwork: "testnet",
          type: "finalized",
          nowMs: baseNow + 2000,
        },
        driver,
      );

      const finalizedView = resolveOperationPresentation(finalized, "testnet");
      expect(finalizedView.isNetworkMatch).toBe(true);
      expect(finalizedView.explorerHref).toContain("testnet");
      expect(finalizedView.explorerHref).toContain(HASH_A);
      expect(finalizedView.relatedResourceHref).toBe("/proofs/anchoring");

      // 3. Viewer switches to public network -> network mismatch blocks explorer link
      const switchedNetworkView = resolveOperationPresentation(
        finalized,
        "public",
      );
      expect(switchedNetworkView.isNetworkMatch).toBe(false);
      expect(switchedNetworkView.networkMismatchReason).toContain(
        "submitted on Stellar testnet",
      );
      expect(switchedNetworkView.explorerHref).toBeNull();
      expect(switchedNetworkView.relatedResourceHref).toBeNull();
    });
  });
});
