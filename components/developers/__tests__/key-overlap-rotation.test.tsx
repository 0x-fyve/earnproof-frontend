/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KeyOverlapRotationDialog, KeyOverlapStatusPanel } from "../key-overlap-rotation";
import {
  startKeyOverlapRotation,
  endKeyOverlapEarly,
  type ApiKeyOverlap,
} from "@/lib/api/keys";
import { useRecentAuth } from "@/lib/auth/recent-auth";
import { apiClient } from "@/lib/api/client";
import type { ApiKey } from "@/lib/api/generated/v1";

jest.mock("../one-time-secret", () => ({
  OneTimeSecret: ({ apiKey, onDismiss }: { apiKey: { name: string }; onDismiss: () => void }) => (
    <div data-testid="one-time-secret">
      <div>{apiKey.name} - Secret shown once</div>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

jest.mock("@/lib/api/keys", () => ({
  ...jest.requireActual("@/lib/api/keys"),
  startKeyOverlapRotation: jest.fn(),
  endKeyOverlapEarly: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
}));

jest.mock("@/lib/wallet/sign-message", () => ({
  signWithFreighter: jest.fn(),
}));

const mockStartOverlap = startKeyOverlapRotation as jest.MockedFunction<
  typeof startKeyOverlapRotation
>;
const mockEndOverlap = endKeyOverlapEarly as jest.MockedFunction<typeof endKeyOverlapEarly>;

const mockApiKey: ApiKey = {
  id: "key_old_123",
  name: "Production webhook key",
  prefix: "ep_old_abc",
  scopes: ["webhooks:manage"],
  expiresAt: null,
};

const mockNewApiKey: ApiKey = {
  id: "key_new_456",
  name: "Production webhook key",
  prefix: "ep_new_xyz",
  scopes: ["webhooks:manage"],
  expiresAt: null,
};

const mockToken = "test_token_123";
const mockWalletAddress = "GAAA000000000000000000000000000000000000000000000000AAAA";

/** Mirrors how ApiKeyList really owns useRecentAuth and passes it down. */
function StartDialogHarness({
  onOverlapStarted,
  onClose,
}: {
  onOverlapStarted: (overlap: ApiKeyOverlap) => void;
  onClose: () => void;
}) {
  const recentAuth = useRecentAuth({
    walletAddress: mockWalletAddress,
    signMessage: async () => "sig-abc",
  });
  return (
    <KeyOverlapRotationDialog
      apiKey={mockApiKey}
      token={mockToken}
      recentAuth={recentAuth}
      onClose={onClose}
      onOverlapStarted={onOverlapStarted}
    />
  );
}

function StatusPanelHarness({
  overlap,
  onOverlapUpdated,
}: {
  overlap: ApiKeyOverlap;
  onOverlapUpdated: (overlap: ApiKeyOverlap) => void;
}) {
  const recentAuth = useRecentAuth({
    walletAddress: mockWalletAddress,
    signMessage: async () => "sig-abc",
  });
  return (
    <KeyOverlapStatusPanel
      overlap={overlap}
      token={mockToken}
      recentAuth={recentAuth}
      onOverlapUpdated={onOverlapUpdated}
    />
  );
}

async function passReauthChallenge() {
  await waitFor(() => expect(screen.getByRole("dialog", { name: /confirm with your wallet/i })).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("KeyOverlapRotationDialog", () => {
  it("shows unambiguous old/new key framing before starting", () => {
    render(<StartDialogHarness onOverlapStarted={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByText(/Start overlap rotation for/)).toBeInTheDocument();
    expect(screen.getByText(/ep_old_abc/)).toBeInTheDocument();
    expect(screen.getByText(/A new key is issued immediately/)).toBeInTheDocument();
  });

  it("reveals the new secret exactly once after starting, gated behind recent auth", async () => {
    const overlap: ApiKeyOverlap = {
      oldKeyId: mockApiKey.id,
      newApiKey: mockNewApiKey,
      overlapDeadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      status: "active",
      oldKeyLastUsedAt: null,
    };
    mockStartOverlap.mockResolvedValue({ overlap, secret: "sk_live_super_secret" });
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jest.mocked(apiClient).mockResolvedValueOnce({
      user: {},
      session: { token: "t", tokenType: "Bearer" },
    });

    const onOverlapStarted = jest.fn();
    render(<StartDialogHarness onOverlapStarted={onOverlapStarted} onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Start overlap rotation/ }));
    await passReauthChallenge();

    await waitFor(() => expect(mockStartOverlap).toHaveBeenCalled());
    expect(mockStartOverlap).toHaveBeenCalledWith(
      mockToken,
      mockApiKey.id,
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(onOverlapStarted).toHaveBeenCalledWith(overlap);

    await waitFor(() =>
      expect(screen.getByTestId("one-time-secret")).toHaveTextContent("Secret shown once"),
    );
  });

  it("shows an error and does not call onOverlapStarted when the start request fails", async () => {
    mockStartOverlap.mockRejectedValue(new Error("network error"));
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jest.mocked(apiClient).mockResolvedValueOnce({
      user: {},
      session: { token: "t", tokenType: "Bearer" },
    });

    const onOverlapStarted = jest.fn();
    render(<StartDialogHarness onOverlapStarted={onOverlapStarted} onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Start overlap rotation/ }));
    await passReauthChallenge();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Failed to start overlap rotation/),
    );
    expect(onOverlapStarted).not.toHaveBeenCalled();
  });

  it("cancelling returns to the idle dialog without calling onOverlapStarted", () => {
    const onClose = jest.fn();
    render(<StartDialogHarness onOverlapStarted={jest.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockStartOverlap).not.toHaveBeenCalled();
  });
});

describe("KeyOverlapStatusPanel", () => {
  const activeOverlap: ApiKeyOverlap = {
    oldKeyId: "key_old_123",
    newApiKey: mockNewApiKey,
    overlapDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    status: "active",
    oldKeyLastUsedAt: "2026-01-01T00:00:00.000Z",
  };

  it("shows 'In progress' and old-key usage for an active overlap", () => {
    render(<StatusPanelHarness overlap={activeOverlap} onOverlapUpdated={jest.fn()} />);

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText(/last used/)).toBeInTheDocument();
  });

  it("does not offer 'end overlap early' once the window has already expired (stale state)", () => {
    const expiredOverlap: ApiKeyOverlap = { ...activeOverlap, status: "expired" };
    render(<StatusPanelHarness overlap={expiredOverlap} onOverlapUpdated={jest.fn()} />);

    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End overlap early" })).not.toBeInTheDocument();
  });

  it("does not offer 'end overlap early' once already ended (stale state)", () => {
    const endedOverlap: ApiKeyOverlap = { ...activeOverlap, status: "ended" };
    render(<StatusPanelHarness overlap={endedOverlap} onOverlapUpdated={jest.fn()} />);

    expect(screen.getByText("Ended early")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End overlap early" })).not.toBeInTheDocument();
  });

  it("ending early requires confirmation and a fresh wallet signature (authorization)", async () => {
    const updatedOverlap: ApiKeyOverlap = { ...activeOverlap, status: "ended" };
    mockEndOverlap.mockResolvedValue(updatedOverlap);
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jest.mocked(apiClient).mockResolvedValueOnce({
      user: {},
      session: { token: "t", tokenType: "Bearer" },
    });

    const onOverlapUpdated = jest.fn();
    render(<StatusPanelHarness overlap={activeOverlap} onOverlapUpdated={onOverlapUpdated} />);

    fireEvent.click(screen.getByRole("button", { name: "End overlap early" }));
    expect(screen.getByText(/stop working immediately/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "End overlap now" }));
    await passReauthChallenge();

    await waitFor(() =>
      expect(mockEndOverlap).toHaveBeenCalledWith(
        mockToken,
        activeOverlap.oldKeyId,
        expect.any(AbortSignal),
      ),
    );
    expect(onOverlapUpdated).toHaveBeenCalledWith(updatedOverlap);
  });

  it("surfaces an error if ending early fails (e.g. window already expired server-side)", async () => {
    mockEndOverlap.mockRejectedValue(new Error("already expired"));
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jest.mocked(apiClient).mockResolvedValueOnce({
      user: {},
      session: { token: "t", tokenType: "Bearer" },
    });

    render(<StatusPanelHarness overlap={activeOverlap} onOverlapUpdated={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "End overlap early" }));
    fireEvent.click(screen.getByRole("button", { name: "End overlap now" }));
    await passReauthChallenge();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Failed to end the overlap window/),
    );
  });

  it("never shows two confirmation surfaces at once when ending early (authorization gate replaces the confirm dialog)", async () => {
    mockEndOverlap.mockResolvedValue({ ...activeOverlap, status: "ended" });
    jest.mocked(apiClient).mockResolvedValueOnce({
      id: "challenge-1",
      message: "sign this",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    render(<StatusPanelHarness overlap={activeOverlap} onOverlapUpdated={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "End overlap early" }));
    fireEvent.click(screen.getByRole("button", { name: "End overlap now" }));

    await waitFor(() => {
      expect(screen.queryByText(/stop working immediately/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("dialog", { name: /confirm with your wallet/i }),
      ).toBeInTheDocument();
    });
  });
});
