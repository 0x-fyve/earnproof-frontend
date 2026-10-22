import {
  buildConsentReceiptExport,
  CONSENT_RECEIPT_EXPORT_FILENAME,
  isSafeExportFilename,
} from "../export";
import { createConsentReceipt, type DisclosureRequest } from "../consent-receipts";

const WALLET = "wallet-hash-a";

function makeRequest(): DisclosureRequest {
  return {
    requestId: "req-1",
    verifier: { commitment: "commit-abc123", displayName: "Acme Lending" },
    purpose: "Income verification",
    requestExpiresAt: "2099-01-01T00:00:00.000Z",
    requestedFields: ["claim.thresholdAmount", "claim.assetCode"],
    proofId: "proof-1",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("buildConsentReceiptExport — download integrity", () => {
  it("uses the dedicated consent-receipt filename", () => {
    const receipt = createConsentReceipt(makeRequest(), ["claim.thresholdAmount"], WALLET);
    const plan = buildConsentReceiptExport(receipt);
    expect(plan.filename).toBe(CONSENT_RECEIPT_EXPORT_FILENAME);
    expect(isSafeExportFilename(plan.filename)).toBe(true);
  });

  it("the exported body round-trips to the exact same receipt data", () => {
    const receipt = createConsentReceipt(
      makeRequest(),
      ["claim.thresholdAmount", "claim.assetCode"],
      WALLET,
    );
    const plan = buildConsentReceiptExport(receipt);
    const parsed = JSON.parse(plan.body);

    expect(parsed.receiptId).toBe(receipt.receiptId);
    expect(parsed.approvedFields).toEqual(["claim.thresholdAmount", "claim.assetCode"]);
    expect(parsed.purpose).toBe(receipt.purpose);
    expect(parsed.attestation).toBeNull();
  });

  it("the export never includes a field beyond the receipt's own approvedFields (no raw credential, no hidden claims)", () => {
    const receipt = createConsentReceipt(makeRequest(), ["claim.thresholdAmount"], WALLET);
    const plan = buildConsentReceiptExport(receipt);
    const parsed = JSON.parse(plan.body);

    expect(Object.keys(parsed).sort()).toEqual(
      [
        "receiptId",
        "decision",
        "requestId",
        "verifier",
        "purpose",
        "approvedFields",
        "expiresAt",
        "approvedAt",
        "proofId",
        "attestation",
      ].sort(),
    );
    expect(parsed).not.toHaveProperty("credential");
    expect(parsed).not.toHaveProperty("subject");
  });

  it("produces no warnings (there is nothing in a receipt that needs a disclosure warning)", () => {
    const receipt = createConsentReceipt(makeRequest(), ["claim.thresholdAmount"], WALLET);
    const plan = buildConsentReceiptExport(receipt);
    expect(plan.warnings).toEqual([]);
  });
});
