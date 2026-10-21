/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CheckpointHealthDashboard } from "../checkpoint-health-dashboard";
import {
  getPaymentCheckpoints,
  retryCheckpoint,
  type PaymentCheckpoint,
} from "@/lib/api/payment-checkpoints";
import { storeSession, clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/payment-checkpoints", () => ({
  ...jest.requireActual("@/lib/api/payment-checkpoints"),
  getPaymentCheckpoints: jest.fn(),
  retryCheckpoint: jest.fn(),
}));

const mockGetCheckpoints = getPaymentCheckpoints as jest.MockedFunction<
  typeof getPaymentCheckpoints
>;
const mockRetry = retryCheckpoint as jest.MockedFunction<typeof retryCheckpoint>;

function setSession(role: "ADMIN" | "WORKER" = "ADMIN") {
  storeSession({
    token: "token-123",
    user: {
      id: "u1",
      walletAddress: "GAAA000000000000000000000000000000000000000000000000AAAA",
      walletHash: "hash1",
      role,
    },
  });
}

function healthyCheckpoint(overrides: Partial<PaymentCheckpoint> = {}): PaymentCheckpoint {
  return {
    accountId: "GACCOUNT1",
    checkpointLedger: 1000,
    latestFinalizedLedger: 1002,
    lagLedgers: 2,
    status: "healthy",
    outageReason: null,
    lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z",
    isStalled: false,
    ...overrides,
  };
}

beforeEach(() => {
  clearStoredSession();
  jest.clearAllMocks();
});

describe("CheckpointHealthDashboard — authentication and authorization", () => {
  it("prompts for authentication when there is no session", () => {
    render(<CheckpointHealthDashboard />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("shows forbidden state for a non-admin session (capability/role guard)", () => {
    setSession("WORKER");
    render(<CheckpointHealthDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Access Restricted");
    expect(mockGetCheckpoints).not.toHaveBeenCalled();
  });

  it("shows forbidden state if the server itself rejects with 403", async () => {
    setSession();
    mockGetCheckpoints.mockRejectedValue(new Error("403 Forbidden"));
    render(<CheckpointHealthDashboard />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Access Restricted"));
  });
});

describe("CheckpointHealthDashboard — loading and error", () => {
  it("shows a loading state", () => {
    setSession();
    mockGetCheckpoints.mockReturnValue(new Promise(() => {}));
    render(<CheckpointHealthDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading checkpoint health");
  });

  it("shows a generic error state on unexpected failure", async () => {
    setSession();
    mockGetCheckpoints.mockRejectedValue(new Error("network down"));
    render(<CheckpointHealthDashboard />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not load checkpoint health"),
    );
  });
});

describe("CheckpointHealthDashboard — healthy state", () => {
  it("shows ledger/lag/last-sync fields with no amount, memo, or counterparty data", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [healthyCheckpoint()],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);

    await waitFor(() => expect(screen.getByText("Healthy")).toBeInTheDocument());
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("1002")).toBeInTheDocument();
    expect(screen.getByText("2 ledgers")).toBeInTheDocument();

    const dashboardText = document.body.textContent ?? "";
    expect(dashboardText).not.toMatch(/amount|memo|counterparty/i);
  });
});

describe("CheckpointHealthDashboard — stalled state", () => {
  it("visibly distinguishes a stalled/stale checkpoint from normal lag", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({
          accountId: "GSTALLED1",
          status: "stalled",
          isStalled: true,
          lagLedgers: 500,
          outageReason: "local_processing_delay",
        }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);

    await waitFor(() => expect(screen.getByText("Stalled")).toBeInTheDocument());
    expect(screen.getByLabelText(/checkpoint is stale/)).toBeInTheDocument();
    expect(screen.getByText(/ingestion worker is behind/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument();
  });
});

describe("CheckpointHealthDashboard — regressed state", () => {
  it("visibly distinguishes a regressed checkpoint from a stalled one", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({
          accountId: "GREGRESSED1",
          status: "regressed",
          checkpointLedger: 900,
          latestFinalizedLedger: 1000,
          lagLedgers: 100,
        }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);

    await waitFor(() => expect(screen.getByText("Regressed")).toBeInTheDocument());
    expect(screen.getByLabelText(/checkpoint regressed/)).toBeInTheDocument();
  });
});

describe("CheckpointHealthDashboard — reorg state", () => {
  it("explains a ledger reorg separately from an outage or rate limit", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({
          accountId: "GREORG1",
          status: "reorg",
          outageReason: "ledger_reorg",
        }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);

    await waitFor(() => expect(screen.getByText("Reorg in progress")).toBeInTheDocument());
    expect(screen.getByText(/ledger reorganization was detected/)).toBeInTheDocument();
  });

  it("explains a Horizon outage distinctly from a rate limit", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({ accountId: "GOUTAGE1", status: "lagging", outageReason: "horizon_outage" }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Horizon is currently unreachable/)).toBeInTheDocument(),
    );
  });

  it("explains a Horizon rate limit distinctly from an outage", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({
          accountId: "GRATELIMIT1",
          status: "lagging",
          outageReason: "horizon_rate_limited",
        }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/rate-limiting our requests/)).toBeInTheDocument(),
    );
  });
});

describe("CheckpointHealthDashboard — retry action", () => {
  it("retries a stalled account's sync and updates its row with the response", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({ accountId: "GSTALLED1", status: "stalled", isStalled: true }),
      ],
      lagWarningThresholdLedgers: 50,
    });
    mockRetry.mockResolvedValue({
      checkpoint: healthyCheckpoint({ accountId: "GSTALLED1", status: "healthy", isStalled: false }),
      accepted: true,
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));

    await waitFor(() =>
      expect(mockRetry).toHaveBeenCalledWith("token-123", "GSTALLED1", expect.any(AbortSignal)),
    );
    await waitFor(() => expect(screen.queryByText("Stalled")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Healthy")).toBeInTheDocument());
  });

  it("surfaces a reason when the server declines the retry (e.g. already in progress)", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({ accountId: "GSTALLED1", status: "stalled", isStalled: true }),
      ],
      lagWarningThresholdLedgers: 50,
    });
    mockRetry.mockResolvedValue({
      checkpoint: healthyCheckpoint({ accountId: "GSTALLED1", status: "stalled", isStalled: true }),
      accepted: false,
      reason: "A retry is already in progress for this account.",
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("already in progress"),
    );
  });

  it("shows a generic error if the retry request itself fails", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({ accountId: "GSTALLED1", status: "stalled", isStalled: true }),
      ],
      lagWarningThresholdLedgers: 50,
    });
    mockRetry.mockRejectedValue(new Error("network error"));

    render(<CheckpointHealthDashboard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to retry"),
    );
  });

  it("does not offer a retry action for a merely lagging (not stalled/regressed) account", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [healthyCheckpoint({ accountId: "GLAG1", status: "lagging", lagLedgers: 60 })],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() => expect(screen.getByText("Lagging")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Retry sync" })).not.toBeInTheDocument();
  });
});

describe("CheckpointHealthDashboard — partial data", () => {
  it("renders correctly when some accounts have never synced successfully", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({ accountId: "GNEVER1", lastSuccessfulSyncAt: null }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() => expect(screen.getByText("Never")).toBeInTheDocument());
  });

  it("renders an empty state when no accounts are tracked", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({ checkpoints: [], lagWarningThresholdLedgers: 50 });

    render(<CheckpointHealthDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/No accounts are currently tracked/)).toBeInTheDocument(),
    );
  });

  it("renders a mixed list of healthy, lagging, and stalled accounts together", async () => {
    setSession();
    mockGetCheckpoints.mockResolvedValue({
      checkpoints: [
        healthyCheckpoint({ accountId: "GA1", status: "healthy" }),
        healthyCheckpoint({ accountId: "GA2", status: "lagging", lagLedgers: 60 }),
        healthyCheckpoint({ accountId: "GA3", status: "stalled", isStalled: true }),
      ],
      lagWarningThresholdLedgers: 50,
    });

    render(<CheckpointHealthDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("checkpoint-row-GA1")).toBeInTheDocument();
      expect(screen.getByTestId("checkpoint-row-GA2")).toBeInTheDocument();
      expect(screen.getByTestId("checkpoint-row-GA3")).toBeInTheDocument();
    });
  });
});
