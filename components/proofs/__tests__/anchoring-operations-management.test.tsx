/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnchoringOperationsManagement } from "../anchoring-operations-management";
import { getAnchoringOperations, retryAnchoringOperation, type AnchoringOperation } from "@/lib/api/anchoring";
import { storeSession, clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/anchoring", () => {
  const actual = jest.requireActual("@/lib/api/anchoring");
  return {
    ...actual,
    getAnchoringOperations: jest.fn(),
    retryAnchoringOperation: jest.fn(),
    reconcileAnchoringOperation: jest.fn(),
  };
});

const mockedGetOperations = getAnchoringOperations as jest.MockedFunction<typeof getAnchoringOperations>;
const mockedRetry = retryAnchoringOperation as jest.MockedFunction<typeof retryAnchoringOperation>;


const ADMIN_SESSION = {
  token: "test-token",
  user: { id: "user-1", walletAddress: "GADMIN...TEST", walletHash: "wh_admin", role: "ADMIN" },
};

const WORKER_SESSION = {
  token: "test-token",
  user: { id: "user-2", walletAddress: "GWORKER...TEST", walletHash: "wh_worker", role: "WORKER" },
};

const TRANSIENT_OPERATION = {
  id: "op-1",
  proofId: "proof-1",
  status: "FAILED_TRANSIENT" as const,
  attemptCount: 2,
  lastAttemptedAt: "2026-08-01T00:00:00.000Z",
  anchoredAt: null,
  failureReason: "RPC timeout",
  createdAt: "2026-07-31T00:00:00.000Z",
};

const PROCESSING_OPERATION = {
  ...TRANSIENT_OPERATION,
  id: "op-2",
  status: "PROCESSING" as const,
  failureReason: null,
};

describe("AnchoringOperationsManagement authorization", () => {
  afterEach(() => {
    clearStoredSession();
  });

  it("prompts to connect a wallet when there is no session", () => {
    render(<AnchoringOperationsManagement />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("shows an access-restricted message for a non-admin session", () => {
    storeSession(WORKER_SESSION);
    render(<AnchoringOperationsManagement />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
  });
});

describe("AnchoringOperationsManagement for an admin session", () => {
  beforeEach(() => {
    mockedGetOperations.mockReset();
    mockedRetry.mockReset();
    storeSession(ADMIN_SESSION);
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("renders operations with a retry control enabled only for a transient failure", async () => {
    mockedGetOperations.mockResolvedValue([TRANSIENT_OPERATION]);

    render(<AnchoringOperationsManagement />);

    await waitFor(() => {
      expect(screen.getByText("proof-1")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reconcile" })).toBeDisabled();
  });

  it("disables both retry and reconcile while an operation is processing", async () => {
    mockedGetOperations.mockResolvedValue([PROCESSING_OPERATION]);

    render(<AnchoringOperationsManagement />);

    await waitFor(() => {
      expect(screen.getByText("proof-1")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reconcile" })).toBeDisabled();
  });

  it("requires confirmation before retrying, and disables the row while the retry is in flight", async () => {
    mockedGetOperations.mockResolvedValue([TRANSIENT_OPERATION]);
    let resolveRetry!: (value: AnchoringOperation) => void;
    mockedRetry.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<AnchoringOperationsManagement />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Retry" }));

    // Retrying requires going through the confirmation dialog - clicking
    // the row action alone must not call the API yet.
    expect(mockedRetry).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    expect(mockedRetry).toHaveBeenCalledTimes(1);

    // While the mutation is in flight, the dialog locks into its processing
    // state (both buttons disabled) - there is no way to fire a second
    // retry request for the same operation before this one resolves.
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Processing..." })).toBeDisabled();
    });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    resolveRetry({ ...TRANSIENT_OPERATION, status: "ANCHORED", anchoredAt: "2026-08-02T00:00:00.000Z" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockedRetry).toHaveBeenCalledTimes(1);
  });
});
