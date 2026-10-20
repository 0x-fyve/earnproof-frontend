/**
 * @jest-environment jsdom
 */

import { clearStoredSession, readStoredSession, storeSession } from "../session";
import { createTabSyncCoordinator, resetTabSyncCoordinatorForTests, type TabSyncEvent } from "@/lib/auth/tab-sync-coordinator";
import { TAB_B, installFakeBroadcastChannel, uninstallBroadcastChannel } from "@/tests/fixtures/tab-sync-fixtures";

const SYNTHETIC_SESSION = {
  token: "synthetic-session-token-do-not-use",
  user: {
    id: "user-synthetic-0001",
    walletAddress: "GSYNTHETICSESSIONWALLET00000000000000000000000000000000",
    walletHash: "0".repeat(64),
    role: "WORKER" as const,
  },
};

describe("lib/session wallet logout propagation (#274)", () => {
  let otherTab: ReturnType<typeof createTabSyncCoordinator>;
  let received: TabSyncEvent[];

  beforeEach(() => {
    window.localStorage.clear();
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
  });

  it("clears the session and tells other tabs the wallet logged out, without sending session data", () => {
    storeSession(SYNTHETIC_SESSION);
    clearStoredSession();

    expect(readStoredSession()).toBeNull();
    expect(received.map((event) => event.type)).toEqual(["wallet_logout"]);
    expect(JSON.stringify(received)).not.toContain(SYNTHETIC_SESSION.token);
    expect(JSON.stringify(received)).not.toContain(SYNTHETIC_SESSION.user.walletAddress);
  });

  it("does not re-broadcast when clearing in response to another tab", () => {
    storeSession(SYNTHETIC_SESSION);
    clearStoredSession({ broadcast: false });

    expect(readStoredSession()).toBeNull();
    expect(received).toEqual([]);
  });

  it("regression: clears the session and leaves no sync message at rest on the storage fallback path", () => {
    uninstallBroadcastChannel();
    resetTabSyncCoordinatorForTests();
    storeSession(SYNTHETIC_SESSION);
    clearStoredSession();
    expect(readStoredSession()).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});
