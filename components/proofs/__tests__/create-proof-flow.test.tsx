/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateProofFlow } from "../create-proof-flow";
import { apiClient } from "@/lib/api/client";
import { storeSession, clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
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

const PAYMENT = {
  id: "pay-1",
  stellarTransactionHash: "tx-hash-1",
  sourceAddress: "GSRC...TEST",
  assetCode: "USDC",
  assetIssuer: null,
  occurredAt: "2026-08-01T00:00:00.000Z",
  classification: "INCOME" as const,
  isEligible: true,
};

describe("CreateProofFlow payment loading state", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    storeSession(SESSION);
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("shows the payment list skeleton (not the empty state) while syncing", async () => {
    let resolveSync!: (value: unknown) => void;
    mockedApiClient.mockImplementation((options) => {
      if (options.path === "/payments/sync") {
        return new Promise((resolve) => {
          resolveSync = resolve;
        });
      }
      return Promise.resolve([PAYMENT]);
    });

    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Sync" }));

    const region = await screen.findByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading payments...")).toBeInTheDocument();
    expect(screen.queryByText("No payments loaded yet.")).not.toBeInTheDocument();

    resolveSync(undefined);

    await waitFor(() => {
      expect(screen.queryByText("Loading payments...")).not.toBeInTheDocument();
    });
  });

  it("renders loaded payment rows after sync resolves", async () => {
    mockedApiClient.mockImplementation((options) => {
      if (options.path === "/payments/sync") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve([PAYMENT]);
    });

    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() => {
      expect(screen.getByText("USDC incoming payment")).toBeInTheDocument();
    });

    expect(screen.queryByText("Loading payments...")).not.toBeInTheDocument();
  });

  it("shows the skeleton while refreshing an already-loaded payment list", async () => {
    let resolveRefresh!: (value: unknown) => void;
    mockedApiClient.mockImplementation((options) => {
      if (options.path === "/payments" && options.method === undefined) {
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return Promise.resolve([PAYMENT]);
    });

    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    const region = await screen.findByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");

    resolveRefresh([PAYMENT]);

    await waitFor(() => {
      expect(screen.getByText("USDC incoming payment")).toBeInTheDocument();
    });
  });
});
