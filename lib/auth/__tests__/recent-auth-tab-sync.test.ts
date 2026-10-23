/**
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecentAuth, RECENT_AUTH_WINDOW_MS } from "../recent-auth";
import { createTabSyncCoordinator, resetTabSyncCoordinatorForTests, type TabSyncEvent } from "../tab-sync-coordinator";
import { apiClient } from "@/lib/api/client";
import { TAB_B, installFakeBroadcastChannel, uninstallBroadcastChannel } from "@/tests/fixtures/tab-sync-fixtures";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
}));

const mockApiClient = apiClient as jest.MockedFunction<typeof apiClient>;
const WALLET = "GSYNTHETICRECENTAUTH000000000000000000000000000000000000";

function mockSuccessfulReauth() {
  mockApiClient
    .mockResolvedValueOnce({
      id: "challenge-synthetic-1",
      message: "synthetic challenge",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    .mockResolvedValueOnce({ user: {}, session: { token: "synthetic-token-do-not-use", tokenType: "Bearer" } });
}

async function verifyOnce(result: { current: ReturnType<typeof useRecentAuth> }, action: () => void) {
  act(() => {
    result.current.requestRecentAuth(action);
  });
  await waitFor(() => expect(result.current.challenge).not.toBeNull());
  await act(async () => {
    await result.current.confirmRecentAuth();
  });
}

describe("useRecentAuth cross-tab sync (#274)", () => {
  let otherTab: ReturnType<typeof createTabSyncCoordinator>;
  let received: TabSyncEvent[];

  beforeEach(() => {
    jest.clearAllMocks();
    installFakeBroadcastChannel();
    resetTabSyncCoordinatorForTests();
    otherTab = createTabSyncCoordinator({ tabId: TAB_B });
    received = [];
    otherTab.subscribe((event) => received.push(event));
  });

  afterEach(() => {
    otherTab.close();
    resetTabSyncCoordinatorForTests();
    uninstallBroadcastChannel();
    jest.useRealTimers();
  });

  it("boundary: still fresh 1 ms before the window ends; expires and notifies other tabs at exactly the window end", async () => {
    jest.useFakeTimers();
    const signMessage = jest.fn().mockResolvedValue("synthetic-signature");
    mockSuccessfulReauth();
    const { result } = renderHook(() => useRecentAuth({ walletAddress: WALLET, signMessage }));
    await verifyOnce(result, jest.fn());

    act(() => {
      jest.advanceTimersByTime(RECENT_AUTH_WINDOW_MS - 1);
    });
    expect(received).toEqual([]);
    const justBefore = jest.fn();
    act(() => {
      result.current.requestRecentAuth(justBefore);
    });
    expect(justBefore).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(received.map((event) => event.type)).toEqual(["recent_auth_expired"]);

    const atExpiry = jest.fn();
    mockApiClient.mockResolvedValueOnce({ id: "c2", message: "m", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    act(() => {
      result.current.requestRecentAuth(atExpiry);
    });
    expect(atExpiry).not.toHaveBeenCalled();
    expect(result.current.isPromptOpen).toBe(true);
  });

  it("positive: an expiry from another tab makes this tab's fresh auth stale", async () => {
    const signMessage = jest.fn().mockResolvedValue("synthetic-signature");
    mockSuccessfulReauth();
    const { result } = renderHook(() => useRecentAuth({ walletAddress: WALLET, signMessage }));
    await verifyOnce(result, jest.fn());

    act(() => {
      otherTab.publish("recent_auth_expired");
    });

    const next = jest.fn();
    mockApiClient.mockResolvedValueOnce({ id: "c2", message: "m", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    act(() => {
      result.current.requestRecentAuth(next);
    });
    expect(next).not.toHaveBeenCalled();
    expect(result.current.isPromptOpen).toBe(true);
  });

  it("positive: a logout in another tab discards a pending action and closes the prompt", async () => {
    const pending = jest.fn();
    mockApiClient.mockResolvedValueOnce({ id: "c1", message: "m", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const { result } = renderHook(() => useRecentAuth({ walletAddress: WALLET, signMessage: jest.fn() }));

    act(() => {
      result.current.requestRecentAuth(pending);
    });
    await waitFor(() => expect(result.current.challenge).not.toBeNull());

    act(() => {
      otherTab.publish("wallet_logout");
    });
    expect(result.current.isPromptOpen).toBe(false);
    expect(result.current.challenge).toBeNull();

    await act(async () => {
      await result.current.confirmRecentAuth();
    });
    expect(pending).not.toHaveBeenCalled();
  });

  it("authorization: no received event can make auth fresh", () => {
    const { result } = renderHook(() => useRecentAuth({ walletAddress: WALLET, signMessage: jest.fn() }));
    mockApiClient.mockResolvedValue({ id: "c1", message: "m", expiresAt: new Date(Date.now() + 60_000).toISOString() });

    act(() => {
      otherTab.publish("tenant_switched");
    });
    const action = jest.fn();
    act(() => {
      result.current.requestRecentAuth(action);
    });
    expect(action).not.toHaveBeenCalled();
    expect(result.current.isPromptOpen).toBe(true);
  });

  it("regression: a tenant switch elsewhere does not invalidate fresh recent auth", async () => {
    const signMessage = jest.fn().mockResolvedValue("synthetic-signature");
    mockSuccessfulReauth();
    const { result } = renderHook(() => useRecentAuth({ walletAddress: WALLET, signMessage }));
    await verifyOnce(result, jest.fn());

    act(() => {
      otherTab.publish("tenant_switched");
    });
    const next = jest.fn();
    act(() => {
      result.current.requestRecentAuth(next);
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes and clears the expiry timer on unmount", async () => {
    jest.useFakeTimers();
    const signMessage = jest.fn().mockResolvedValue("synthetic-signature");
    mockSuccessfulReauth();
    const { result, unmount } = renderHook(() => useRecentAuth({ walletAddress: WALLET, signMessage }));
    await verifyOnce(result, jest.fn());

    unmount();
    act(() => {
      jest.advanceTimersByTime(RECENT_AUTH_WINDOW_MS);
    });
    expect(received).toEqual([]);
  });
});
