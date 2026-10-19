/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecurringIncomeProofWizard } from "../recurring-income-proof-wizard";
import { apiClient } from "@/lib/api/client";
import { clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
  retryMutation: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

describe("RecurringIncomeProofWizard - deployment metadata gating (#185)", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    clearStoredSession();
  });

  it("verifies deployment metadata before requesting a wallet signature, and blocks connecting when it's unavailable", async () => {
    mockedApiClient.mockImplementation((options) => {
      if (options.path === "/deployment/metadata") {
        return Promise.reject(new Error("deployment metadata unavailable"));
      }
      return Promise.reject(new Error(`unexpected apiClient call: ${options.path}`));
    });

    const user = userEvent.setup();
    render(<RecurringIncomeProofWizard />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/deployment configuration/i);
    });

    // Only the metadata check should have run - no /auth/challenge or /auth/verify.
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
    expect(mockedApiClient).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/deployment/metadata" }),
    );
  });
});
