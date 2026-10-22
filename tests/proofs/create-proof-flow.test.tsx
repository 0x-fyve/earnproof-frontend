/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateProofFlow } from "@/components/proofs/create-proof-flow";
import { apiClient } from "@/lib/api/client";
import { storeSession } from "@/lib/session";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
}));

const mockedApiClient = apiClient as jest.Mock;


const SESSION = {
  token: "test-token",
  user: {
    id: "user_1",
    walletAddress: "GABCDEF1234567890",
    walletHash: "hash_1",
    role: "worker",
  },
};

const PAYMENTS = [
  {
    id: "pay_1",
    stellarTransactionHash: "tx_1",
    sourceAddress: "GSOURCE1",
    assetCode: "USDC",
    assetIssuer: "GISSUER1",
    occurredAt: "2026-08-05T00:00:00.000Z",
    classification: "INCOME",
    isEligible: true,
  },
  {
    id: "pay_2",
    stellarTransactionHash: "tx_2",
    sourceAddress: "GSOURCE2",
    assetCode: "USDC",
    assetIssuer: "GISSUER1",
    occurredAt: "2026-08-10T00:00:00.000Z",
    classification: "INCOME",
    isEligible: true,
  },
];

const PROOF_RESPONSE = {
  proofId: "EP-TEST-0001",
  status: "active",
  verificationUrl: "https://app.earnproof.example/verify?proof=EP-TEST-0001",
  credential: {
    proof: {
      credentialHash: "hash_credential",
      signature: "sig",
    },
  },
};

function seedSession() {
  storeSession(SESSION);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Wires the mocked apiClient to the routes CreateProofFlow actually calls,
 * with a controllable resolver for POST /proofs/minimum-income. */
function installApiClient(overrides: { createProof?: () => Promise<unknown> } = {}) {
  mockedApiClient.mockImplementation(({ path, method }: { path: string; method?: string }) => {
    if (path === "/payments" && (!method || method === "GET")) {
      return Promise.resolve(PAYMENTS);
    }
    if (path === "/proofs/minimum-income" && method === "POST") {
      return overrides.createProof
        ? overrides.createProof()
        : Promise.resolve(PROOF_RESPONSE);
    }
    return Promise.reject(new Error(`unmocked path in test: ${method ?? "GET"} ${path}`));
  });
}

async function renderWithEligiblePayments() {
  render(<CreateProofFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => {
    expect(screen.getAllByLabelText("Select payment")).toHaveLength(2);
  });
  fireEvent.click(screen.getAllByLabelText("Select payment")[0]);
  fireEvent.click(screen.getAllByLabelText("Select payment")[1]);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Review before creating" })).toBeEnabled();
  });
}

/** Opens the review step and confirms it, leaving the form ready for a
 * "Create proof" click — mirrors the two-step flow #193 introduced
 * (review, then an explicit confirm, then submit). */
async function reviewAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Review before creating" }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "I have reviewed this and confirm" }),
    ).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: "I have reviewed this and confirm" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create proof" })).toBeInTheDocument();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockedApiClient.mockReset();
  seedSession();
});

describe("CreateProofFlow submission locking", () => {
  it("disables the button and shows a submitting label while a request is in flight", async () => {
    const pending = deferred<typeof PROOF_RESPONSE>();
    installApiClient({ createProof: () => pending.promise });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Creating proof..." })).toBeDisabled();
    });

    await act(async () => {
      pending.resolve(PROOF_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });
  });

  it("a rapid double click only sends one mutation", async () => {
    const pending = deferred<typeof PROOF_RESPONSE>();
    let createCalls = 0;
    installApiClient({
      createProof: () => {
        createCalls += 1;
        return pending.promise;
      },
    });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    const button = screen.getByRole("button", { name: "Create proof" });

    // Two rapid, unawaited clicks before React can re-render the disabled
    // state — the in-handler submission guard, not just the disabled
    // attribute, must be what prevents the second mutation.
    fireEvent.click(button);
    fireEvent.click(button);

    await act(async () => {
      pending.resolve(PROOF_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });

    expect(createCalls).toBe(1);
    expect(mockedApiClient).toHaveBeenCalledTimes(
      // 1 GET /payments (from Refresh) + 1 POST /proofs/minimum-income
      2,
    );
  });

  it("many rapid clicks while submitting still only send one mutation", async () => {
    const pending = deferred<typeof PROOF_RESPONSE>();
    let createCalls = 0;
    installApiClient({
      createProof: () => {
        createCalls += 1;
        return pending.promise;
      },
    });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    const button = screen.getByRole("button", { name: "Create proof" });

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(button);
    }

    await act(async () => {
      pending.resolve(PROOF_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });

    expect(createCalls).toBe(1);
  });

  it("re-enables the button after a failure, and a retry sends a new request", async () => {
    installApiClient({ createProof: () => Promise.reject(new Error("boom")) });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));

    await waitFor(() => {
      expect(screen.getByText(/Proof creation failed/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Create proof" })).toBeEnabled();

    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));

    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });
  });
});

describe("CreateProofFlow idempotency key", () => {
  it("sends an Idempotency-Key header on the mutation", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));

    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });

    const createCall = mockedApiClient.mock.calls.find(
      ([options]) => options.path === "/proofs/minimum-income",
    );
    expect(createCall[0].headers["Idempotency-Key"]).toEqual(expect.any(String));
  });

  it("reuses the same idempotency key when retrying the same intent after a failure", async () => {
    installApiClient({ createProof: () => Promise.reject(new Error("boom")) });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));
    await waitFor(() => {
      expect(screen.getByText(/Proof creation failed/)).toBeInTheDocument();
    });

    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));
    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });

    const createCalls = mockedApiClient.mock.calls.filter(
      ([options]) => options.path === "/proofs/minimum-income",
    );
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0][0].headers["Idempotency-Key"]).toBe(
      createCalls[1][0].headers["Idempotency-Key"],
    );
  });

  it("mints a new key for a new submission after a success", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));
    await waitFor(() => {
      expect(screen.getByText("Proof created.")).toBeInTheDocument();
    });

    const firstKey = mockedApiClient.mock.calls.find(
      ([options]) => options.path === "/proofs/minimum-income",
    )[0].headers["Idempotency-Key"];

    // A successful submission resets the review gate — a second submission
    // is a genuinely new intent and must be reviewed again.
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));
    await waitFor(() => {
      const createCalls = mockedApiClient.mock.calls.filter(
        ([options]) => options.path === "/proofs/minimum-income",
      );
      expect(createCalls).toHaveLength(2);
    });

    const secondKey = mockedApiClient.mock.calls
      .filter(([options]) => options.path === "/proofs/minimum-income")[1][0]
      .headers["Idempotency-Key"];

    expect(secondKey).not.toBe(firstKey);
  });
});

describe("CreateProofFlow late-response ordering", () => {
  it("does not resurrect proof/error state after a disconnect while a submission was in flight", async () => {
    const pending = deferred<typeof PROOF_RESPONSE>();
    installApiClient({ createProof: () => pending.promise });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));

    await waitFor(() => {
      expect(screen.getByText("Creating signed minimum-income proof...")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("button", { name: "Connect Freighter" })).toBeInTheDocument();

    // The superseded request now resolves.
    await act(async () => {
      pending.resolve(PROOF_RESPONSE);
    });

    expect(screen.queryByText("Proof created.")).not.toBeInTheDocument();
    expect(screen.queryByText("Proof ID:")).not.toBeInTheDocument();
  });

  it("does not resurrect an error banner from a superseded request after disconnect", async () => {
    const pending = deferred<typeof PROOF_RESPONSE>();
    installApiClient({ createProof: () => pending.promise });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));
    await waitFor(() => {
      expect(screen.getByText("Creating signed minimum-income proof...")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await act(async () => {
      pending.reject(new Error("network error"));
    });

    expect(screen.queryByText(/Proof creation failed/)).not.toBeInTheDocument();
  });
});

describe("CreateProofFlow review gate (#193)", () => {
  it("shows a review step before submitting, with fields matching the exact payload that gets sent", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });

    await renderWithEligiblePayments();
    fireEvent.click(screen.getByRole("button", { name: "Review before creating" }));

    await waitFor(() => {
      expect(screen.getByText("Review before submitting")).toBeInTheDocument();
    });
    // Nothing is sent to the API merely by opening the review step.
    expect(
      mockedApiClient.mock.calls.some(([o]) => o.path === "/proofs/minimum-income"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "I have reviewed this and confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Create proof" }));

    await waitFor(() => expect(screen.getByText("Proof created.")).toBeInTheDocument());

    const sentBody = JSON.parse(
      mockedApiClient.mock.calls.find(([o]) => o.path === "/proofs/minimum-income")[0].body,
    );
    expect(sentBody).toEqual({
      selectedPaymentIds: ["pay_1", "pay_2"],
      thresholdAmount: "100",
      assetCode: "USDC",
      assetIssuer: "GISSUER1",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T23:59:59.000Z",
      expiresInDays: 30,
    });
  });

  it("editing the threshold after confirming review invalidates the confirmation", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });
    await renderWithEligiblePayments();
    await reviewAndConfirm();

    expect(screen.getByRole("button", { name: "Create proof" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "250" } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "I have reviewed this and confirm" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Create proof" })).not.toBeInTheDocument();
  });

  it("changing the period after confirming review invalidates the confirmation", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });
    await renderWithEligiblePayments();
    await reviewAndConfirm();

    fireEvent.change(screen.getByLabelText("Period end"), { target: { value: "2026-09-15" } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "I have reviewed this and confirm" }),
      ).toBeInTheDocument();
    });
  });

  it("does not invalidate confirmation when nothing actually changed (re-render noise)", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });
    await renderWithEligiblePayments();
    await reviewAndConfirm();

    // Trigger a re-render without changing any tracked field.
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "100" } });

    expect(screen.getByRole("button", { name: "Create proof" })).toBeInTheDocument();
  });

  it("Back to edit cancels the review without submitting", async () => {
    installApiClient({ createProof: () => Promise.resolve(PROOF_RESPONSE) });
    await renderWithEligiblePayments();
    fireEvent.click(screen.getByRole("button", { name: "Review before creating" }));
    await waitFor(() => {
      expect(screen.getByText("Review before submitting")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));

    expect(screen.queryByText("Review before submitting")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review before creating" })).toBeInTheDocument();
    expect(
      mockedApiClient.mock.calls.some(([o]) => o.path === "/proofs/minimum-income"),
    ).toBe(false);
  });

  it("a double click on the confirmed Create proof button still sends only one mutation", async () => {
    const pending = deferred<typeof PROOF_RESPONSE>();
    let createCalls = 0;
    installApiClient({
      createProof: () => {
        createCalls += 1;
        return pending.promise;
      },
    });

    await renderWithEligiblePayments();
    await reviewAndConfirm();
    const button = screen.getByRole("button", { name: "Create proof" });
    fireEvent.click(button);
    fireEvent.click(button);

    await act(async () => {
      pending.resolve(PROOF_RESPONSE);
    });

    await waitFor(() => expect(screen.getByText("Proof created.")).toBeInTheDocument());
    expect(createCalls).toBe(1);
  });
});
