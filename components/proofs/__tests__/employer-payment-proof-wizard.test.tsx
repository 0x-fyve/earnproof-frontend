/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployerPaymentProofWizard } from "../employer-payment-proof-wizard";
import { apiClient } from "@/lib/api/client";
import type { Payment } from "@/lib/api/employer-payment-proofs";
import { storeSession, clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
  retryRead: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
  retryMutation: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

const SESSION = {
  token: "test-token",
  user: {
    id: "user-1",
    walletAddress: "GABC...TEST",
    walletHash: "wh_test",
    role: "worker",
  },
};

const TRUSTED_PAYMENT: Payment = {
  id: "pay-1",
  stellarTransactionHash: "tx-hash-1",
  sourceAddress: "GTRUSTED0000000000000000000000000000000000000000000000",
  assetCode: "USDC",
  assetIssuer: null,
  occurredAt: "2026-08-05T00:00:00.000Z",
  classification: "INCOME" as const,
  isEligible: true,
};

const UNTRUSTED_PAYMENT: Payment = {
  id: "pay-2",
  stellarTransactionHash: "tx-hash-2",
  sourceAddress: "GUNTRUSTED00000000000000000000000000000000000000000000",
  assetCode: "USDC",
  assetIssuer: null,
  occurredAt: "2026-08-06T00:00:00.000Z",
  classification: "EXCLUDED" as const,
  isEligible: false,
};

function installPaymentsApi(payments: Payment[]) {
  mockedApiClient.mockImplementation((options: { path: string; method?: string }) => {
    if (options.path === "/payments") {
      return Promise.resolve(payments);
    }
    if (options.path === "/proofs/employer-payment" && options.method === "POST") {
      return Promise.resolve({
        proofId: "proof-1",
        status: "issued",
        verificationUrl: "https://example.com/verify/proof-1",
        credential: {
          id: "cred-1",
          type: "EmployerPaymentProof",
          schemaVersion: "1.0",
          subject: { walletHash: "wh_test" },
          claim: {
            sourceAddressHash: "sha256:abc",
            assetCode: "USDC",
            periodStart: "2026-08-01T00:00:00.000Z",
            periodEnd: "2026-11-30T23:59:59.000Z",
            qualifyingPaymentCount: 1,
          },
          privacy: { exactAmountHidden: true, sourceTransactionsHidden: true },
          issuedAt: "2026-08-10T00:00:00.000Z",
          expiresAt: "2026-11-10T00:00:00.000Z",
          proof: { type: "Ed25519Signature2020", credentialHash: "sha256:hash", signature: "sig" },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected request: ${options.method ?? "GET"} ${options.path}`));
  });
}

async function goToSourceStep(user: ReturnType<typeof userEvent.setup>) {
  // Default period (2026-08-01 to 2026-11-30) already covers fixture payment dates.
  await user.click(screen.getByRole("button", { name: "Next" }));
  // Payments are only fetched on an explicit Refresh/Sync, matching the
  // pattern used by the recurring-income and payment-receipt wizards.
  await user.click(await screen.findByRole("button", { name: "Refresh" }));
}

describe("EmployerPaymentProofWizard", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    storeSession(SESSION);
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("no-match: explains when no trusted source is found for the period", async () => {
    const user = userEvent.setup();
    installPaymentsApi([]);

    render(<EmployerPaymentProofWizard />);
    await waitFor(() => expect(screen.getByText("Period")).toBeInTheDocument());

    await goToSourceStep(user);

    expect(await screen.findByText(/no eligible, trusted employer sources were found/i)).toBeInTheDocument();
  });

  it("multiple-match: lists every trusted candidate and requires an explicit choice", async () => {
    const user = userEvent.setup();
    installPaymentsApi([
      TRUSTED_PAYMENT,
      { ...TRUSTED_PAYMENT, id: "pay-3", sourceAddress: "GTRUSTED2000000000000000000000000000000000000000000000" },
    ]);

    render(<EmployerPaymentProofWizard />);
    await waitFor(() => expect(screen.getByText("Period")).toBeInTheDocument());
    await goToSourceStep(user);

    expect(await screen.findByText(/2 eligible employer sources were found/i)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    // Cannot proceed until a specific source is chosen.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("revoked/untrusted: an excluded source cannot be selected", async () => {
    const user = userEvent.setup();
    installPaymentsApi([UNTRUSTED_PAYMENT]);

    render(<EmployerPaymentProofWizard />);
    await waitFor(() => expect(screen.getByText("Period")).toBeInTheDocument());
    await goToSourceStep(user);

    expect(await screen.findByText(/untrusted or ineligible sources/i)).toBeInTheDocument();
    expect(screen.getByRole("radio")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("successful path: selects a trusted source, previews without amounts, and creates the proof", async () => {
    const user = userEvent.setup();
    installPaymentsApi([TRUSTED_PAYMENT]);

    render(<EmployerPaymentProofWizard />);
    await waitFor(() => expect(screen.getByText("Period")).toBeInTheDocument());
    await goToSourceStep(user);

    await user.click(await screen.findByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Confirmation/preview step: no amount field anywhere.
    expect(await screen.findByText("Review & Create")).toBeInTheDocument();
    expect(screen.getByText("Never disclosed")).toBeInTheDocument();
    expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Employer Payment Proof" }));

    expect(await screen.findByText("proof-1")).toBeInTheDocument();
    const createCall = mockedApiClient.mock.calls.find(
      ([opts]) => opts.path === "/proofs/employer-payment"
    );
    expect(createCall?.[0].method).toBe("POST");
    const body = JSON.parse(createCall![0].body as string);
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("discloseAmount");
    expect(body.sourceAddress).toBe(TRUSTED_PAYMENT.sourceAddress);
  });

  it("source-change invalidation: changing the period clears a previously selected source", async () => {
    const user = userEvent.setup();
    installPaymentsApi([TRUSTED_PAYMENT]);

    render(<EmployerPaymentProofWizard />);
    await waitFor(() => expect(screen.getByText("Period")).toBeInTheDocument());
    await goToSourceStep(user);

    await user.click(await screen.findByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Review & Create")).toBeInTheDocument();

    // Go back to period step and change the start date so the fixture
    // payment (2026-08-05) falls outside the new period, while the period
    // itself (2026-09-01 to 2026-11-30) remains internally valid.
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await user.click(screen.getByRole("button", { name: "Previous" }));
    const periodStartInput = screen.getByLabelText("Period Start") as HTMLInputElement;
    await user.clear(periodStartInput);
    await user.type(periodStartInput, "2026-09-01");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/no eligible, trusted employer sources were found/i)).toBeInTheDocument();
  });
});
