/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { ConsentReceiptLookup } from "../consent-receipt-lookup";
import { createConsentReceipt, type DisclosureRequest } from "@/lib/credentials/consent-receipts";

jest.mock("../artifact-export", () => ({
  ArtifactExport: ({ title }: { title: string }) => <div data-testid="artifact-export">{title}</div>,
}));

const WALLET_A = "wallet-hash-a";
const WALLET_B = "wallet-hash-b";

function makeRequest(): DisclosureRequest {
  return {
    requestId: "req-1",
    verifier: { commitment: "commit-abc123", displayName: "Acme Lending" },
    purpose: "Income verification",
    requestExpiresAt: "2099-01-01T00:00:00.000Z",
    requestedFields: ["claim.thresholdAmount"],
    proofId: "proof-1",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ConsentReceiptLookup", () => {
  it("finds and displays a receipt by its ID", () => {
    const receipt = createConsentReceipt(makeRequest(), ["claim.thresholdAmount"], WALLET_A);
    render(<ConsentReceiptLookup walletHash={WALLET_A} />);

    fireEvent.change(screen.getByLabelText("Receipt ID"), { target: { value: receipt.receiptId } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(screen.getByText("Acme Lending")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-export")).toBeInTheDocument();
  });

  it("shows a not-found message for an unknown receipt ID", () => {
    render(<ConsentReceiptLookup walletHash={WALLET_A} />);
    fireEvent.change(screen.getByLabelText("Receipt ID"), { target: { value: "receipt_unknown" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No receipt with that ID was found");
  });

  it("does not find a receipt belonging to a different wallet (tenant isolation)", () => {
    const receipt = createConsentReceipt(makeRequest(), ["claim.thresholdAmount"], WALLET_A);
    render(<ConsentReceiptLookup walletHash={WALLET_B} />);

    fireEvent.change(screen.getByLabelText("Receipt ID"), { target: { value: receipt.receiptId } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(screen.getByRole("alert")).toHaveTextContent("No receipt with that ID was found");
  });
});
