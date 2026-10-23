/**
 * @jest-environment jsdom
 */

/**
 * MultiTabSync is now a deprecated compatibility adapter over the tab-sync
 * coordinator (#274). These tests pin the documented legacy mapping:
 * downgrades only, nothing that could signal a session became valid.
 */

import { MultiTabSync, type SyncMessage } from "../multi-tab-sync";
import { createTabSyncCoordinator, resetTabSyncCoordinatorForTests, type TabSyncEvent } from "../tab-sync-coordinator";
import { TAB_B, installFakeBroadcastChannel, uninstallBroadcastChannel } from "@/tests/fixtures/tab-sync-fixtures";

function otherTab() {
  const coordinator = createTabSyncCoordinator({ tabId: TAB_B });
  const received: TabSyncEvent[] = [];
  coordinator.subscribe((event) => received.push(event));
  return { coordinator, received };
}

describe("MultiTabSync (compatibility adapter)", () => {
  beforeEach(() => {
    installFakeBroadcastChannel();
    MultiTabSync.reset();
    resetTabSyncCoordinatorForTests();
  });

  afterEach(() => {
    MultiTabSync.reset();
    resetTabSyncCoordinatorForTests();
    uninstallBroadcastChannel();
  });

  it("keeps the singleton API", () => {
    const first = MultiTabSync.getInstance();
    expect(MultiTabSync.getInstance()).toBe(first);
    MultiTabSync.reset();
    expect(MultiTabSync.getInstance()).not.toBe(first);
  });

  it("exposes the shared coordinator's tab id", () => {
    expect(MultiTabSync.getInstance().getTabId()).toMatch(/^[a-f0-9]{32}$/);
  });

  it.each([
    ["logout", "wallet_logout"],
    ["wallet_changed", "wallet_logout"],
    ["session_expired", "session_revoked"],
  ] as const)("maps broadcast(%s) to the %s downgrade", (legacy, expected) => {
    const { coordinator, received } = otherTab();
    MultiTabSync.getInstance().broadcast(legacy);
    expect(received.map((event) => event.type)).toEqual([expected]);
    coordinator.close();
  });

  it.each(["token_rotated", "session_recovered"] as const)(
    "authorization: no longer transmits %s (it could imply a session became valid)",
    (legacy) => {
      const { coordinator, received } = otherTab();
      MultiTabSync.getInstance().broadcast(legacy);
      expect(received).toEqual([]);
      coordinator.close();
    },
  );

  it("delivers downgrades from other tabs to legacy listeners in the legacy shape", () => {
    const { coordinator } = otherTab();
    const messages: SyncMessage[] = [];
    MultiTabSync.getInstance().onSync((message) => messages.push(message));

    coordinator.publish("wallet_logout");
    coordinator.publish("session_revoked");

    expect(messages.map((message) => message.type)).toEqual(["logout", "session_expired"]);
    expect(Object.keys(messages[0]).sort()).toEqual(["sourceTabId", "timestamp", "type"]);
    expect(messages[0].sourceTabId).toBe(TAB_B);
    coordinator.close();
  });

  it("does not forward tenant or recent-auth events to legacy listeners", () => {
    const { coordinator } = otherTab();
    const listener = jest.fn();
    MultiTabSync.getInstance().onSync(listener);

    coordinator.publish("tenant_switched");
    coordinator.publish("recent_auth_expired");

    expect(listener).not.toHaveBeenCalled();
    coordinator.close();
  });

  it("never delivers this tab's own broadcasts back to it", () => {
    const listener = jest.fn();
    const sync = MultiTabSync.getInstance();
    sync.onSync(listener);
    sync.broadcast("logout");
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe and destroy() stop delivery", () => {
    const { coordinator } = otherTab();
    const sync = MultiTabSync.getInstance();
    const unsubscribed = jest.fn();
    const destroyed = jest.fn();
    sync.onSync(unsubscribed)();
    sync.onSync(destroyed);
    sync.destroy();

    coordinator.publish("wallet_logout");
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(destroyed).not.toHaveBeenCalled();
    coordinator.close();
  });
});
