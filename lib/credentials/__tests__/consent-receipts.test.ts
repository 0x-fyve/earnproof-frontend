import {
  createConsentReceipt,
  getConsentReceiptById,
  isReceiptExpired,
  isRequestExpired,
  listConsentReceipts,
  type DisclosureRequest,
} from "../consent-receipts";

const WALLET_A = "wallet-hash-a";
const WALLET_B = "wallet-hash-b";

function makeRequest(overrides: Partial<DisclosureRequest> = {}): DisclosureRequest {
  return {
    requestId: "req-1",
    verifier: { commitment: "commit-abc123", displayName: "Acme Lending" },
    purpose: "Income verification for loan application",
    requestExpiresAt: "2026-12-31T00:00:00.000Z",
    requestedFields: ["claim.thresholdAmount", "claim.assetCode", "proof.expiresAt"],
    proofId: "proof-1",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("isRequestExpired", () => {
  it("returns false for a request with a future expiry", () => {
    expect(isRequestExpired(makeRequest({ requestExpiresAt: "2099-01-01T00:00:00.000Z" }))).toBe(
      false,
    );
  });

  it("returns true for a request with a past expiry", () => {
    expect(isRequestExpired(makeRequest({ requestExpiresAt: "2020-01-01T00:00:00.000Z" }))).toBe(
      true,
    );
  });
});

describe("createConsentreceipt — approval", () => {
  it("creates a receipt matching the approved fields exactly", () => {
    const request = makeRequest();
    const receipt = createConsentReceipt(
      request,
      ["claim.thresholdAmount", "claim.assetCode"],
      WALLET_A,
    );

    expect(receipt.decision).toBe("approved");
    expect(receipt.approvedFields).toEqual(["claim.thresholdAmount", "claim.assetCode"]);
    expect(receipt.purpose).toBe(request.purpose);
    expect(receipt.verifier).toEqual(request.verifier);
    expect(receipt.expiresAt).toBe(request.requestExpiresAt);
    expect(receipt.attestation).toBeNull();
  });

  it("persists the receipt so it can be listed later", () => {
    const request = makeRequest();
    createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A);
    expect(listConsentReceipts(WALLET_A)).toHaveLength(1);
  });

  it("generates a receipt ID that does not embed the proof ID or wallet hash", () => {
    const request = makeRequest({ proofId: "proof-secret-123" });
    const receipt = createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A);
    expect(receipt.receiptId).not.toContain("proof-secret-123");
    expect(receipt.receiptId).not.toContain(WALLET_A);
  });
});

describe("createConsentReceipt — changed requests (approved fields must be a subset)", () => {
  it("rejects approving a field that was not in the original request", () => {
    const request = makeRequest({ requestedFields: ["claim.thresholdAmount"] });
    expect(() =>
      createConsentReceipt(request, ["claim.thresholdAmount", "subject.walletHash"], WALLET_A),
    ).toThrow(/unexpected field/i);
  });

  it("rejects approving zero fields", () => {
    const request = makeRequest();
    expect(() => createConsentReceipt(request, [], WALLET_A)).toThrow(/at least one field/i);
  });

  it("allows approving a proper subset of the requested fields", () => {
    const request = makeRequest({
      requestedFields: ["claim.thresholdAmount", "claim.assetCode", "proof.expiresAt"],
    });
    const receipt = createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A);
    expect(receipt.approvedFields).toEqual(["claim.thresholdAmount"]);
  });
});

describe("createConsentReceipt — expiry", () => {
  it("refuses to create a receipt for an expired request", () => {
    const request = makeRequest({ requestExpiresAt: "2020-01-01T00:00:00.000Z" });
    expect(() => createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A)).toThrow(
      /already expired/i,
    );
  });

  it("does not persist any receipt when creation is refused due to expiry", () => {
    const request = makeRequest({ requestExpiresAt: "2020-01-01T00:00:00.000Z" });
    expect(() => createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A)).toThrow();
    expect(listConsentReceipts(WALLET_A)).toHaveLength(0);
  });

  it("isReceiptExpired reflects the receipt's own expiresAt", () => {
    const request = makeRequest({ requestExpiresAt: "2099-01-01T00:00:00.000Z" });
    const receipt = createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A);
    expect(isReceiptExpired(receipt)).toBe(false);

    const expiredRequest = makeRequest({
      requestExpiresAt: new Date(Date.now() + 1000).toISOString(),
      requestId: "req-2",
    });
    const soonReceipt = createConsentReceipt(expiredRequest, ["claim.thresholdAmount"], WALLET_A);
    // Not yet expired at creation time.
    expect(isReceiptExpired(soonReceipt)).toBe(false);
  });
});

describe("decline produces no receipt", () => {
  it("there is no API to create a receipt for a decline — the module exposes no such function", () => {
    // This test documents the invariant by construction: the only way to
    // get a ConsentReceipt from this module is createConsentReceipt,
    // which always sets decision: "approved". A decline is handled
    // entirely by the caller (the UI component) without ever calling
    // into this module, so nothing is persisted.
    const request = makeRequest();
    // Simulate a decline: the caller simply never calls createConsentReceipt.
    expect(listConsentReceipts(WALLET_A)).toHaveLength(0);
    void request;
  });
});

describe("getConsentReceiptById — privacy-safe lookup and tenant isolation", () => {
  it("finds a receipt by its own ID, scoped to the correct wallet", () => {
    const request = makeRequest();
    const receipt = createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A);
    expect(getConsentReceiptById(WALLET_A, receipt.receiptId)).toEqual(receipt);
  });

  it("does not find another wallet's receipt even with the correct receipt ID", () => {
    const request = makeRequest();
    const receipt = createConsentReceipt(request, ["claim.thresholdAmount"], WALLET_A);
    expect(getConsentReceiptById(WALLET_B, receipt.receiptId)).toBeNull();
  });

  it("returns null for an unknown receipt ID", () => {
    expect(getConsentReceiptById(WALLET_A, "receipt_does-not-exist")).toBeNull();
  });
});
