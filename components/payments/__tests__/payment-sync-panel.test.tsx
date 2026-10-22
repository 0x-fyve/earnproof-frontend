/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentSyncPanel } from "../payment-sync-panel";
import { syncPayments } from "@/lib/api/payments";
import { storeSession } from "@/lib/session";

jest.mock("@/lib/api/payments", () => ({
  ...jest.requireActual("@/lib/api/payments"),
  syncPayments: jest.fn(),
}));

const mockedSyncPayments = syncPayments as jest.MockedFunction<typeof syncPayments>;


function setSession(role = "ADMIN") {
  storeSession({ token: "token-123", user: { id: "u1", role } });
}

describe("PaymentSyncPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedSyncPayments.mockReset();
  });

  it("prompts for authentication when there is no session", () => {
    render(<PaymentSyncPanel />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
    expect(screen.queryByText("Sync payments")).not.toBeInTheDocument();
  });

  it("shows a syncing state while the request is in flight", async () => {
    setSession();
    let resolveSync!: (value: { created: number; updated: number; skipped: number }) => void;
    mockedSyncPayments.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);

    await user.click(screen.getByRole("button", { name: "Sync payments" }));

    expect(screen.getByText("Sync in progress...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing..." })).toBeDisabled();

    resolveSync({ created: 1, updated: 0, skipped: 0 });
    await waitFor(() => {
      expect(screen.queryByText("Sync in progress...")).not.toBeInTheDocument();
    });
  });

  it("distinguishes a no-op result from a completed one", async () => {
    setSession();
    mockedSyncPayments.mockResolvedValue({ created: 0, updated: 0, skipped: 0 });

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);
    await user.click(screen.getByRole("button", { name: "Sync payments" }));

    await waitFor(() => {
      expect(screen.getByText("No new payments to sync")).toBeInTheDocument();
    });
  });

  it("distinguishes a partial result (some payments skipped) from a full completion", async () => {
    setSession();
    mockedSyncPayments.mockResolvedValue({ created: 3, updated: 1, skipped: 2 });

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);
    await user.click(screen.getByRole("button", { name: "Sync payments" }));

    await waitFor(() => {
      expect(screen.getByText("Sync completed with some payments skipped")).toBeInTheDocument();
    });
    expect(screen.getByText("2")).toBeInTheDocument(); // skipped count shown
  });

  it("shows a full-completion result distinctly from partial and no-op", async () => {
    setSession();
    mockedSyncPayments.mockResolvedValue({ created: 5, updated: 0, skipped: 0 });

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);
    await user.click(screen.getByRole("button", { name: "Sync payments" }));

    await waitFor(() => {
      expect(screen.getByText("Sync completed successfully")).toBeInTheDocument();
    });
  });

  it("shows an error and preserves the last successful checkpoint on a later failure", async () => {
    setSession();
    mockedSyncPayments
      .mockResolvedValueOnce({ created: 4, updated: 1, skipped: 0 })
      .mockRejectedValueOnce(new Error("Network timeout"));

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);

    await user.click(screen.getByRole("button", { name: "Sync payments" }));
    await waitFor(() => {
      expect(screen.getByText("Sync completed successfully")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Sync payments" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network timeout");
    });

    expect(
      screen.getByText(/Last successful sync: 4 created, 1 updated, 0 skipped\./),
    ).toBeInTheDocument();
  });

  it("offers a retry affordance after a failure", async () => {
    setSession();
    mockedSyncPayments.mockRejectedValue(new Error("Server error"));

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);
    await user.click(screen.getByRole("button", { name: "Sync payments" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument();
    });
  });

  it("prevents a duplicate concurrent request from rapid repeated clicks", async () => {
    setSession();
    let resolveSync!: (value: { created: number; updated: number; skipped: number }) => void;
    mockedSyncPayments.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );

    render(<PaymentSyncPanel />);
    const button = screen.getByRole("button", { name: "Sync payments" });

    // Fire multiple rapid clicks via fireEvent (synchronous, unlike
    // userEvent which serializes and would let React re-render between
    // clicks) to simulate a user double/triple-clicking before the first
    // click's disabled state has painted.
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedSyncPayments).toHaveBeenCalledTimes(1);

    resolveSync({ created: 1, updated: 0, skipped: 0 });
    await waitFor(() => {
      expect(screen.getByText("Sync completed successfully")).toBeInTheDocument();
    });
  });

  it("announces progress and results via an aria-live region without an alert role while syncing", async () => {
    setSession();
    let resolveSync!: (value: { created: number; updated: number; skipped: number }) => void;
    mockedSyncPayments.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<PaymentSyncPanel />);
    await user.click(screen.getByRole("button", { name: "Sync payments" }));

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("Sync in progress...");
    // A status region does not steal focus; nothing in this component
    // moves focus programmatically during syncing.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Syncing..." }));

    resolveSync({ created: 1, updated: 0, skipped: 0 });
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent("Sync completed successfully");
    });
  });
});
