/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeyList } from "../api-key-list";
import { rotateApiKey, revokeApiKey } from "@/lib/api/keys";
import { apiClient } from "@/lib/api/client";
import { signWithFreighter } from "@/lib/wallet/sign-message";
import type { ApiKey } from "@/lib/api/generated/v1";

// Mock the OneTimeSecret component to simplify testing
jest.mock("../one-time-secret", () => ({
  OneTimeSecret: ({ apiKey, onDismiss }: { apiKey: { name: string }; onDismiss: () => void }) => (
    <div data-testid="one-time-secret">
      <div>{apiKey.name} - Secret shown</div>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

// Mock the ConfirmationDialog component
jest.mock("@/components/common/confirmation-dialog", () => ({
  ConfirmationDialog: ({
    onConfirm,
    onCancel,
    message,
    confirmText,
  }: {
    onConfirm: () => void;
    onCancel: () => void;
    message: string;
    confirmText?: string;
  }) => (
    <div data-testid="confirmation-dialog">
      <p>{message}</p>
      <button onClick={onConfirm}>{confirmText ?? "Confirm"}</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

// rotateApiKey/revokeApiKey are mocked at the module level (rather than via
// jest.spyOn on the namespace import) because this repo's Jest 30 + Next/SWC
// transform throws "Cannot redefine property" the moment spyOn tries to wrap
// a plain `export async function` a second time in the same file.
jest.mock("@/lib/api/keys", () => ({
  ...jest.requireActual("@/lib/api/keys"),
  rotateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
}));

jest.mock("@/lib/wallet/sign-message", () => ({
  signWithFreighter: jest.fn(),
}));

const mockRotateApiKey = rotateApiKey as jest.MockedFunction<typeof rotateApiKey>;
const mockRevokeApiKey = revokeApiKey as jest.MockedFunction<typeof revokeApiKey>;

const mockApiKey: ApiKey = {
  id: "key_123",
  name: "Test API Key",
  prefix: "ep_test_abc123",
  scopes: ["verification:read", "proofs:create"],
  expiresAt: "2026-12-31T12:00:00.000Z",
};

const mockExpiredApiKey: ApiKey = {
  id: "key_expired",
  name: "Expired API Key",
  prefix: "ep_expired_xyz",
  scopes: ["verification:read"],
  expiresAt: "2026-01-01T12:00:00.000Z",
};

const mockExpiringApiKey: ApiKey = {
  id: "key_expiring",
  name: "Expiring API Key",
  prefix: "ep_expiring_123",
  scopes: ["proofs:create"],
  expiresAt: "2026-09-24T12:00:00.000Z", // Tomorrow (1 day from now)
};

const mockToken = "test_token_123";
const mockWalletAddress = "GAAA000000000000000000000000000000000000000000000000AAAA";

const defaultPaginationState = {
  nextCursor: null,
  previousCursor: null,
  isLoading: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ApiKeyList", () => {
  describe("rendering and display", () => {
    it("displays loading state when loading with no keys", () => {
      render(
        <ApiKeyList
          apiKeys={[]}
          loading={true}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.getByText("Loading API keys...")).toBeInTheDocument();
    });

    it("displays empty state when no keys exist", () => {
      render(
        <ApiKeyList
          apiKeys={[]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.getByText("No API keys found. Create your first API key above.")).toBeInTheDocument();
    });

    it("displays valid API keys", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.getByText("Test API Key")).toBeInTheDocument();
      // formatApiKeyPrefix truncates any prefix over 8 characters with "...",
      // so the 14-char mock prefix renders as "ep_test_..." + "***", not the
      // untruncated raw prefix.
      expect(screen.getByText("ep_test_...***")).toBeInTheDocument();
    });

    it("shows the all-expired message when every key is expired", () => {
      // When every key is expired, validApiKeys is empty and the component
      // takes its dedicated "all expired" early return (see the "expired all
      // keys message" describe block below) rather than rendering the main
      // list with an expired-keys subsection - that subsection only appears
      // alongside at least one still-valid key (covered by "displays both
      // valid and expired keys when mixed" above).
      render(
        <ApiKeyList
          apiKeys={[mockExpiredApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(
        screen.getByText(
          "All API keys have expired. Create a new key or rotate an existing key to continue using the API."
        )
      ).toBeInTheDocument();
    });

    it("displays both valid and expired keys when mixed", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey, mockExpiredApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.getByText("Test API Key")).toBeInTheDocument();
      expect(screen.getByText("Expired API Keys")).toBeInTheDocument();
      expect(screen.getByText("Expired API Key")).toBeInTheDocument();
    });

    it("shows expiration warning for keys expiring soon", () => {
      render(
        <ApiKeyList
          apiKeys={[mockExpiringApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.getByText("Expiring very soon")).toBeInTheDocument();
    });

    it("displays exact time and relative time for expiration", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const expirationDisplay = screen.getByText(/Dec 31, 2026 — in/);
      expect(expirationDisplay).toBeInTheDocument();
    });

    it("displays 'Never' for keys with no expiration", () => {
      const noExpiryKey: ApiKey = {
        ...mockApiKey,
        expiresAt: null,
      };

      render(
        <ApiKeyList
          apiKeys={[noExpiryKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });

  describe("rotation functionality", () => {
    it("shows confirmation dialog when rotate button is clicked", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
      expect(
        screen.getByText(/Are you sure you want to rotate "Test API Key"\?/)
      ).toBeInTheDocument();
    });

    it("calls rotateApiKey when confirmed", async () => {
      mockRotateApiKey.mockResolvedValue({
        apiKey: mockApiKey,
        secret: "new_secret_123",
      });

      const onKeyUpdated = jest.fn();

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={onKeyUpdated}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      const confirmButton = screen.getAllByText("Rotate Key")[0];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockRotateApiKey).toHaveBeenCalledWith(mockToken, "key_123", expect.any(AbortSignal));
      });

      expect(onKeyUpdated).toHaveBeenCalledWith(mockApiKey);
    });

    it("displays one-time secret after successful rotation", async () => {
      mockRotateApiKey.mockResolvedValue({
        apiKey: mockApiKey,
        secret: "new_secret_123",
      });

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      const confirmButton = screen.getAllByText("Rotate Key")[0];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByTestId("one-time-secret")).toBeInTheDocument();
        expect(screen.getByText(/Test API Key - Secret shown/)).toBeInTheDocument();
      });
    });

    it("dismisses one-time secret when dismiss button is clicked", async () => {
      mockRotateApiKey.mockResolvedValue({
        apiKey: mockApiKey,
        secret: "new_secret_123",
      });

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      const confirmButton = screen.getAllByText("Rotate Key")[0];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByTestId("one-time-secret")).toBeInTheDocument();
      });

      const dismissButton = screen.getByText("Dismiss");
      fireEvent.click(dismissButton);

      await waitFor(() => {
        expect(screen.queryByTestId("one-time-secret")).not.toBeInTheDocument();
      });
    });

    it("handles rotation error gracefully", async () => {
      const errorMessage = "Failed to rotate API key";
      mockRotateApiKey.mockRejectedValue(new Error(errorMessage));

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      const confirmButton = screen.getAllByText("Rotate Key")[0];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText("Failed to rotate API key. Please try again.")).toBeInTheDocument();
      });
    });

    it("can rotate expired keys", async () => {
      mockRotateApiKey.mockResolvedValue({
        apiKey: mockExpiredApiKey,
        secret: "new_secret_123",
      });

      const onKeyUpdated = jest.fn();

      // Paired with a valid key: an all-expired list takes the dedicated
      // "all expired" early return (no action buttons at all - see "shows
      // the all-expired message when every key is expired" above), so the
      // expired key needs a valid sibling to reach the expired-keys
      // subsection where its own Rotate button actually renders.
      render(
        <ApiKeyList
          apiKeys={[mockApiKey, mockExpiredApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={onKeyUpdated}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButtons = screen.getAllByText("Rotate");
      fireEvent.click(rotateButtons[rotateButtons.length - 1]);

      const confirmButton = screen.getAllByText("Rotate Key")[0];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockRotateApiKey).toHaveBeenCalled();
      });

      expect(onKeyUpdated).toHaveBeenCalledWith(mockExpiredApiKey);
    });
  });

  describe("revoke functionality (recent-auth stubbed fresh)", () => {
    // These tests exercise rendering/wiring around revoke, not the recent-auth
    // gate itself (that flow has its own describe block below). Each test
    // supplies a resolved challenge/signature/verify sequence so the reauth
    // gate completes quickly, matching this suite's pre-existing
    // "confirm -> revoke happens" expectations.
    async function confirmRevokeAndPassReauth() {
      const confirmButton = screen.getAllByText("Revoke Key")[0];
      fireEvent.click(confirmButton);

      const gate = await screen.findByRole("dialog", { name: /confirm with your wallet/i });
      expect(gate).toBeInTheDocument();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }

    it("shows confirmation dialog when revoke button is clicked", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const revokeButton = screen.getAllByText("Revoke")[0];
      fireEvent.click(revokeButton);

      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
      expect(
        screen.getByText(/Are you sure you want to revoke "Test API Key"\?/)
      ).toBeInTheDocument();
    });

    it("calls revokeApiKey once the recent-auth gate is satisfied", async () => {
      mockRevokeApiKey.mockResolvedValue(undefined);
      const onKeyRevoked = jest.fn();
      jest.mocked(apiClient).mockResolvedValueOnce({
        id: "challenge-1",
        message: "sign this",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      jest.mocked(signWithFreighter).mockResolvedValueOnce("sig-abc");
      jest.mocked(apiClient).mockResolvedValueOnce({
        user: {},
        session: { token: "t", tokenType: "Bearer" },
      });

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={onKeyRevoked}
        />
      );

      const revokeButton = screen.getAllByText("Revoke")[0];
      fireEvent.click(revokeButton);
      await confirmRevokeAndPassReauth();

      await waitFor(() => {
        expect(mockRevokeApiKey).toHaveBeenCalledWith(mockToken, "key_123", expect.any(AbortSignal));
      });

      expect(onKeyRevoked).toHaveBeenCalledWith("key_123");
    });

    it("handles revoke error gracefully", async () => {
      mockRevokeApiKey.mockRejectedValue(new Error("Revoke failed"));
      jest.mocked(apiClient).mockResolvedValueOnce({
        id: "challenge-1",
        message: "sign this",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      jest.mocked(signWithFreighter).mockResolvedValueOnce("sig-abc");
      jest.mocked(apiClient).mockResolvedValueOnce({
        user: {},
        session: { token: "t", tokenType: "Bearer" },
      });

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const revokeButton = screen.getAllByText("Revoke")[0];
      fireEvent.click(revokeButton);
      await confirmRevokeAndPassReauth();

      await waitFor(() => {
        expect(screen.getByText("Failed to revoke API key. Please try again.")).toBeInTheDocument();
      });
    });
  });

  describe("cancellation", () => {
    it("closes confirmation dialog when cancel is clicked", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();

      const cancelButton = screen.getAllByText("Cancel")[0];
      fireEvent.click(cancelButton);

      expect(screen.queryByTestId("confirmation-dialog")).not.toBeInTheDocument();
    });
  });

  describe("expiration status with fake timers", () => {
    it("updates expiration warning as time progresses", () => {
      // Paired with an always-valid key so the expiring key's transition
      // lands in the expired-keys subsection (which only renders alongside
      // at least one still-valid key) rather than the "all expired" early
      // return - see "shows the all-expired message when every key is
      // expired" above for that dedicated scenario.
      const { rerender } = render(
        <ApiKeyList
          apiKeys={[mockApiKey, mockExpiringApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      // Initially expires tomorrow (very soon)
      expect(screen.getByText("Expiring very soon")).toBeInTheDocument();

      // Advance time by 1 day (now expired)
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);

      rerender(
        <ApiKeyList
          apiKeys={[mockApiKey, mockExpiringApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      // Should now show expired and move to expired keys section
      expect(screen.getByText("Expired API Keys")).toBeInTheDocument();
    });

    it("shows key as valid when expiration is far in future", () => {
      const futureKey: ApiKey = {
        ...mockApiKey,
        expiresAt: "2027-12-31T12:00:00.000Z",
      };

      render(
        <ApiKeyList
          apiKeys={[futureKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(screen.queryByText("Expiring soon")).not.toBeInTheDocument();
      expect(screen.queryByText("Expiring very soon")).not.toBeInTheDocument();
      expect(screen.queryByText("Expired")).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("includes aria-labels on action buttons", () => {
      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButtons = screen.getAllByLabelText(/Rotate API key/);
      const revokeButtons = screen.getAllByLabelText(/Revoke API key/);

      expect(rotateButtons.length).toBeGreaterThan(0);
      expect(revokeButtons.length).toBeGreaterThan(0);
    });

    it("includes aria-live region for expiration status", () => {
      render(
        <ApiKeyList
          apiKeys={[mockExpiringApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      // formatRelativeTime uses Intl.RelativeTimeFormat with numeric: "auto",
      // which renders an exact one-day delta as "tomorrow" rather than "in 1
      // day" - matching real Intl output, not a generic "in ..." string.
      const expirationDisplay = screen.getByText(/Sep 24, 2026 — tomorrow/);
      expect(expirationDisplay).toHaveAttribute("role", "status");
      expect(expirationDisplay).toHaveAttribute("aria-live", "polite");
    });

    it("includes error alert role for error messages", async () => {
      mockRotateApiKey.mockRejectedValue(new Error("Error"));

      render(
        <ApiKeyList
          apiKeys={[mockApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      const rotateButton = screen.getAllByText("Rotate")[0];
      fireEvent.click(rotateButton);

      const confirmButton = screen.getAllByText("Rotate Key")[0];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toBeInTheDocument();
      });
    });
  });

  describe("expired all keys message", () => {
    it("shows special message when all keys are expired", () => {
      render(
        <ApiKeyList
          apiKeys={[mockExpiredApiKey]}
          loading={false}
          token={mockToken}
          walletAddress={mockWalletAddress}
          paginationState={defaultPaginationState}
          onPreviousPage={jest.fn()}
          onNextPage={jest.fn()}
          focusResults={false}
          onKeyUpdated={jest.fn()}
          onKeyRevoked={jest.fn()}
        />
      );

      expect(
        screen.getByText(
          "All API keys have expired. Create a new key or rotate an existing key to continue using the API."
        )
      ).toBeInTheDocument();
    });
  });
});

describe("ApiKeyList revoke with recent-auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not call revokeApiKey until a fresh wallet signature is confirmed", async () => {
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jest.mocked(signWithFreighter).mockResolvedValueOnce("sig-abc");
    jest.mocked(apiClient).mockResolvedValueOnce({ user: {}, session: { token: "t", tokenType: "Bearer" } });
    mockRevokeApiKey.mockResolvedValue(undefined);

    render(
      <ApiKeyList
        apiKeys={[{ id: "key-1", name: "CI deploys", prefix: "abcd1234", scopes: ["proofs:read"], expiresAt: null }]}
        loading={false}
        token="test-token"
        walletAddress="GAAA000000000000000000000000000000000000000000000000AAAA"
        paginationState={{ nextCursor: null, previousCursor: null, isLoading: false }}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke Key" }));

    // The "are you sure?" confirmation was accepted, but revokeApiKey must
    // not run yet: a fresh wallet signature is required first.
    expect(mockRevokeApiKey).not.toHaveBeenCalled();

    const gate = await screen.findByRole("dialog", { name: /confirm with your wallet/i });
    expect(gate).toHaveTextContent(/revoke the API key "CI deploys"/);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(mockRevokeApiKey).toHaveBeenCalledWith("test-token", "key-1", expect.any(AbortSignal)));
  });

  it("never revokes the key if the reauth signature is cancelled", async () => {
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    mockRevokeApiKey.mockResolvedValue(undefined);

    render(
      <ApiKeyList
        apiKeys={[{ id: "key-1", name: "CI deploys", prefix: "abcd1234", scopes: ["proofs:read"], expiresAt: null }]}
        loading={false}
        token="test-token"
        walletAddress="GAAA000000000000000000000000000000000000000000000000AAAA"
        paginationState={{ nextCursor: null, previousCursor: null, isLoading: false }}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke Key" }));

    await screen.findByRole("dialog", { name: /confirm with your wallet/i });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockRevokeApiKey).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never revokes the key if the wallet declines to sign", async () => {
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jest.mocked(signWithFreighter).mockResolvedValueOnce(null);
    mockRevokeApiKey.mockResolvedValue(undefined);

    render(
      <ApiKeyList
        apiKeys={[{ id: "key-1", name: "CI deploys", prefix: "abcd1234", scopes: ["proofs:read"], expiresAt: null }]}
        loading={false}
        token="test-token"
        walletAddress="GAAA000000000000000000000000000000000000000000000000AAAA"
        paginationState={{ nextCursor: null, previousCursor: null, isLoading: false }}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke Key" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockRevokeApiKey).not.toHaveBeenCalled();
  });
});

describe("ApiKeyList created-at display (#323)", () => {
  it("renders the real creation timestamp, with timezone disclosed, when createdAt is present", () => {
    render(
      <ApiKeyList
        apiKeys={[{ ...mockApiKey, createdAt: "2026-01-15T09:30:00.000Z" }]}
        loading={false}
        token={mockToken}
        walletAddress={mockWalletAddress}
        paginationState={defaultPaginationState}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    // formatDateTimeWithZone appends an explicit zone abbreviation (e.g.
    // "UTC"/"GMT"), so the rendered text is never a bare, ambiguous
    // wall-clock time (#323's "preserve timezone disclosure" criterion).
    // "Recently" (the old placeholder) must never reappear.
    expect(screen.queryByText("Recently")).not.toBeInTheDocument();
    expect(screen.getByText(/Jan 15, 2026/)).toBeInTheDocument();
  });

  it("renders an explicit unavailable state, not a guessed date, when createdAt is null", () => {
    render(
      <ApiKeyList
        apiKeys={[{ ...mockApiKey, createdAt: null }]}
        loading={false}
        token={mockToken}
        walletAddress={mockWalletAddress}
        paginationState={defaultPaginationState}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Recently")).not.toBeInTheDocument();
  });

  it("renders an explicit unavailable state when createdAt is absent entirely (pre-field-existing key)", () => {
    const keyWithoutField = { ...mockApiKey };
    delete (keyWithoutField as Partial<ApiKey>).createdAt;

    render(
      <ApiKeyList
        apiKeys={[keyWithoutField]}
        loading={false}
        token={mockToken}
        walletAddress={mockWalletAddress}
        paginationState={defaultPaginationState}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("renders an explicit unavailable state for a malformed createdAt instead of 'Invalid Date'", () => {
    render(
      <ApiKeyList
        apiKeys={[{ ...mockApiKey, createdAt: "not-a-real-timestamp" }]}
        loading={false}
        token={mockToken}
        walletAddress={mockWalletAddress}
        paginationState={defaultPaginationState}
        onPreviousPage={jest.fn()}
        onNextPage={jest.fn()}
        focusResults={false}
        onKeyUpdated={jest.fn()}
        onKeyRevoked={jest.fn()}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});
