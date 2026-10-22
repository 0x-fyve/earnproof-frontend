import {
  clearOperationRecord,
  findResumableRecord,
  intentSignature,
  isExpired,
  listOperationRecords,
  markOperationState,
  OPERATION_RECORD_TTL_MS,
  pollUntilTerminal,
  resolveOperationKey,
  resolveOperationOutcome,
  type OperationIntent,
} from "../idempotent-operation";
import { OperationStatusConflictError, fetchOperationStatus } from "@/lib/api/operation-status";

jest.mock("@/lib/api/operation-status", () => {
  const actual = jest.requireActual("@/lib/api/operation-status");
  return {
    ...actual,
    fetchOperationStatus: jest.fn(),
  };
});

const mockFetchOperationStatus = fetchOperationStatus as jest.MockedFunction<typeof fetchOperationStatus>;

const intent: OperationIntent = { selectedPaymentIds: ["b", "a"], thresholdAmount: "100" };

describe("idempotent-operation store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockFetchOperationStatus.mockReset();
  });

  describe("intentSignature", () => {
    it("is stable across array field ordering", () => {
      const a = intentSignature({ selectedPaymentIds: ["x", "y"] });
      const b = intentSignature({ selectedPaymentIds: ["y", "x"] });
      expect(a).toBe(b);
    });

    it("differs when a non-array field changes", () => {
      const a = intentSignature({ thresholdAmount: "100" });
      const b = intentSignature({ thresholdAmount: "200" });
      expect(a).not.toBe(b);
    });
  });

  // Acceptance criterion: "The client must never generate a new idempotency
  // key for an in-flight retry of the same logical intent."
  describe("never duplicates a key for an in-flight retry (replay)", () => {
    it("reuses the same key when the identical intent is resolved twice", () => {
      const first = resolveOperationKey("tenant-a", "proof-issuance", intent);
      const second = resolveOperationKey("tenant-a", "proof-issuance", intent);
      expect(second.idempotencyKey).toBe(first.idempotencyKey);
      expect(listOperationRecords("tenant-a")).toHaveLength(1);
    });

    it("mints a new key when the intent actually changes", () => {
      const first = resolveOperationKey("tenant-a", "proof-issuance", intent);
      const second = resolveOperationKey("tenant-a", "proof-issuance", {
        ...intent,
        thresholdAmount: "500",
      });
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    });

    it("exact replay: resending the same request/key is recognized as the same record", () => {
      const first = resolveOperationKey("tenant-a", "payment-sync", {});
      markOperationState(first.idempotencyKey, "pending");
      const replay = findResumableRecord("tenant-a", "payment-sync", intentSignature({}));
      expect(replay?.idempotencyKey).toBe(first.idempotencyKey);
    });
  });

  // Acceptance criterion: timeout-after-accept.
  describe("timeout-after-accept", () => {
    it("keeps the record resumable with a pending state after a client-side timeout", () => {
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent);
      // Simulates: request sent, client times out before a response arrives,
      // but the record was already persisted pre-send.
      expect(record.lastKnownState).toBe("pending");
      expect(resolveOperationOutcome(record)).toBe("pending");
    });

    it("resolves to succeeded once a poll confirms the server accepted it", async () => {
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent);
      mockFetchOperationStatus.mockResolvedValue({
        idempotencyKey: record.idempotencyKey,
        state: "succeeded",
      });
      const result = await pollUntilTerminal(record, "token");
      expect(result.state).toBe("succeeded");
      const stored = findResumableRecord("tenant-a", "proof-issuance", intentSignature(intent));
      expect(stored?.lastKnownState).toBe("succeeded");
    });
  });

  // Acceptance criterion: conflict.
  describe("conflict", () => {
    it("throws OperationStatusConflictError when the server's record is older than what this client last observed", async () => {
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent);
      markOperationState(record.idempotencyKey, "pending");
      const stale = findResumableRecord("tenant-a", "proof-issuance", intentSignature(intent))!;
      // Force updatedAt ahead of the stale server response to simulate
      // another actor (e.g. someone who already cancelled it) advancing the
      // server-side record in a way this client's last poll already saw.
      markOperationState(record.idempotencyKey, "cancelled");
      mockFetchOperationStatus.mockResolvedValue({
        idempotencyKey: record.idempotencyKey,
        state: "pending",
        updatedAt: new Date(Date.parse(stale.updatedAt) - 1000).toISOString(),
      });
      await expect(pollUntilTerminal(stale, "token")).rejects.toBeInstanceOf(OperationStatusConflictError);
    });
  });

  // Acceptance criterion: expiry.
  describe("expiry", () => {
    it("treats a record older than the TTL as expired", () => {
      const now = Date.now();
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent, now - OPERATION_RECORD_TTL_MS - 1);
      expect(isExpired(record, now)).toBe(true);
    });

    it("does not resume against an expired record — mints a new key instead", () => {
      const now = Date.now();
      const old = resolveOperationKey("tenant-a", "proof-issuance", intent, now - OPERATION_RECORD_TTL_MS - 1);
      const fresh = resolveOperationKey("tenant-a", "proof-issuance", intent, now);
      expect(fresh.idempotencyKey).not.toBe(old.idempotencyKey);
    });

    it("resolveOperationOutcome reports 'unknown', never a false success or failure, for an expired record", () => {
      const now = Date.now();
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent, now - OPERATION_RECORD_TTL_MS - 1);
      markOperationState(record.idempotencyKey, "succeeded", now - OPERATION_RECORD_TTL_MS - 1);
      const stored = findResumableRecord("tenant-a", "proof-issuance", intentSignature(intent), now - OPERATION_RECORD_TTL_MS - 1)!;
      expect(resolveOperationOutcome(stored, now)).toBe("unknown");
    });

    it("pollUntilTerminal returns 'unknown' and does not call the status endpoint for an expired record", async () => {
      const now = Date.now();
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent, now - OPERATION_RECORD_TTL_MS - 1);
      const result = await pollUntilTerminal(record, "token", { now: () => now });
      expect(result.state).toBe("unknown");
      expect(mockFetchOperationStatus).not.toHaveBeenCalled();
    });
  });

  // Acceptance criterion: unknown operation records must fail safely.
  describe("unknown records fail safely", () => {
    it("a 404/403-normalized 'unknown' status from the API never gets reported as failed or succeeded", async () => {
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent);
      mockFetchOperationStatus.mockResolvedValue({ idempotencyKey: record.idempotencyKey, state: "unknown" });
      const result = await pollUntilTerminal(record, "token");
      expect(result.state).toBe("unknown");
      expect(result.state).not.toBe("failed");
      expect(result.state).not.toBe("succeeded");
    });
  });

  // Acceptance criterion: cancellation.
  describe("cancellation", () => {
    it("marks a record cancelled and reports it as such, not pending or failed", () => {
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent);
      markOperationState(record.idempotencyKey, "cancelled");
      const stored = findResumableRecord("tenant-a", "proof-issuance", intentSignature(intent))!;
      expect(resolveOperationOutcome(stored)).toBe("cancelled");
    });

    it("clearOperationRecord removes the record so a later identical intent mints a fresh key", () => {
      const record = resolveOperationKey("tenant-a", "proof-issuance", intent);
      clearOperationRecord(record.idempotencyKey);
      const next = resolveOperationKey("tenant-a", "proof-issuance", intent);
      expect(next.idempotencyKey).not.toBe(record.idempotencyKey);
    });
  });

  // Acceptance criterion: cross-tenant isolation.
  describe("cross-tenant isolation", () => {
    it("a record created for tenant A is never returned for tenant B with the identical intent", () => {
      const recordA = resolveOperationKey("tenant-a", "proof-issuance", intent);
      const lookupForB = findResumableRecord("tenant-b", "proof-issuance", intentSignature(intent));
      expect(lookupForB).toBeNull();
      expect(listOperationRecords("tenant-b")).toHaveLength(0);
      expect(listOperationRecords("tenant-a")).toHaveLength(1);
      expect(listOperationRecords("tenant-a")[0].idempotencyKey).toBe(recordA.idempotencyKey);
    });

    it("tenant B resolving the same intent mints its own independent key, not tenant A's", () => {
      const recordA = resolveOperationKey("tenant-a", "proof-issuance", intent);
      const recordB = resolveOperationKey("tenant-b", "proof-issuance", intent);
      expect(recordB.idempotencyKey).not.toBe(recordA.idempotencyKey);
    });
  });
});
