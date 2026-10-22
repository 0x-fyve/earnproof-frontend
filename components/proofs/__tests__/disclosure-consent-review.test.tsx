/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { DisclosureConsentReview } from "../disclosure-consent-review";
import type { DisclosureRequest } from "@/lib/credentials/consent-receipts";

jest.mock("../artifact-export", () => ({
  ArtifactExport: ({ title }: { title: string }) => <div data-testid="artifact-export">{title}</div>,
}));

function makeRequest(overrides: Partial<DisclosureRequest> = {}): DisclosureRequest {
  return {
    requestId: "req-1",
    verifier: { commitment: "commit-abc123", displayName: "Acme Lending" },
    purpose: "Income verification for loan application",
    requestExpiresAt: "2099-01-01T00:00:00.000Z",
    requestedFields: ["claim.thresholdAmount", "claim.assetCode"],
    proofId: "proof-1",
    ...overrides,
  };
}

const WALLET = "wallet-hash-a";

beforeEach(() => {
  window.localStorage.clear();
});

describe("DisclosureConsentReview — review", () => {
  it("shows verifier identity commitment, purpose, expiry, and requested fields", () => {
    render(<DisclosureConsentReview request={makeRequest()} walletHash={WALLET} />);
    expect(screen.getByText("Acme Lending")).toBeInTheDocument();
    expect(screen.getByText("commit-abc123")).toBeInTheDocument();
    expect(screen.getByText("Income verification for loan application")).toBeInTheDocument();
    expect(screen.getByText("claim.thresholdAmount")).toBeInTheDocument();
    expect(screen.getByText("claim.assetCode")).toBeInTheDocument();
  });

  it("pre-selects every requested field by default", () => {
    render(<DisclosureConsentReview request={makeRequest()} walletHash={WALLET} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.every((cb) => (cb as HTMLInputElement).checked)).toBe(true);
  });
});

describe("DisclosureConsentReview — approval", () => {
  it("approving with all requested fields generates a receipt and offers download", () => {
    const onDecided = jest.fn();
    render(<DisclosureConsentReview request={makeRequest()} walletHash={WALLET} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve disclosure" }));

    expect(screen.getByText("Disclosure approved")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-export")).toBeInTheDocument();
    expect(onDecided).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "approved", receipt: expect.any(Object) }),
    );
  });

  it("approving with a changed (narrowed) field selection generates a receipt matching only those fields", () => {
    const onDecided = jest.fn();
    render(<DisclosureConsentReview request={makeRequest()} walletHash={WALLET} onDecided={onDecided} />);

    // Uncheck "claim.assetCode", leaving only "claim.thresholdAmount" approved.
    fireEvent.click(screen.getByLabelText("claim.assetCode"));
    fireEvent.click(screen.getByRole("button", { name: "Approve disclosure" }));

    expect(onDecided).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approved",
        receipt: expect.objectContaining({ approvedFields: ["claim.thresholdAmount"] }),
      }),
    );
  });

  it("disables approval once every field is unchecked", () => {
    render(<DisclosureConsentReview request={makeRequest()} walletHash={WALLET} />);
    fireEvent.click(screen.getByLabelText("claim.thresholdAmount"));
    fireEvent.click(screen.getByLabelText("claim.assetCode"));
    expect(screen.getByRole("button", { name: "Approve disclosure" })).toBeDisabled();
  });
});

describe("DisclosureConsentReview — decline", () => {
  it("declining shows a confirmation and produces no receipt", () => {
    const onDecided = jest.fn();
    render(<DisclosureConsentReview request={makeRequest()} walletHash={WALLET} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(screen.getByText("Request declined")).toBeInTheDocument();
    expect(screen.queryByTestId("artifact-export")).not.toBeInTheDocument();
    expect(onDecided).toHaveBeenCalledWith({ decision: "declined" });
  });
});

describe("DisclosureConsentReview — expiry", () => {
  it("disables approval for an already-expired request but still allows decline", () => {
    render(
      <DisclosureConsentReview
        request={makeRequest({ requestExpiresAt: "2020-01-01T00:00:00.000Z" })}
        walletHash={WALLET}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/expired/);
    expect(screen.getByRole("button", { name: "Approve disclosure" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("declining an expired request still works and creates no receipt", () => {
    const onDecided = jest.fn();
    render(
      <DisclosureConsentReview
        request={makeRequest({ requestExpiresAt: "2020-01-01T00:00:00.000Z" })}
        walletHash={WALLET}
        onDecided={onDecided}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecided).toHaveBeenCalledWith({ decision: "declined" });
  });
});
