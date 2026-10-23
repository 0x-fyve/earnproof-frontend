/**
 * @jest-environment jsdom
 */

import {
  TAB_SYNC_DEDUPE_WINDOW_MS,
  TAB_SYNC_INBOUND_LIMIT,
  TAB_SYNC_PUBLISH_LIMIT,
  createTabSyncCoordinator,
  getTabSyncCoordinator,
  resetTabSyncCoordinatorForTests,
  type TabSyncCoordinator,
  type TabSyncEvent,
} from "../tab-sync-coordinator";
import { TAB_SYNC_EVENT_TYPES, TAB_SYNC_RESTRICTIVENESS, encodeTabSyncMessage } from "../tab-sync-protocol";
import { TAB_SYNC_CHANNEL_NAME, TAB_SYNC_STORAGE_KEY } from "@/lib/storage/tab-sync-transport";
import {
  FAKE_JWT_LIKE,
  FIXED_NOW,
  FakeBroadcastChannel,
  SYNTHETIC_TENANT_ID,
  TAB_A,
  TAB_B,
  TAB_C,
  createManualTransport,
  createStorageOnlyTabs,
  installFakeBroadcastChannel,
  makeTabSyncMessage,
  uninstallBroadcastChannel,
} from "@/tests/fixtures/tab-sync-fixtures";

let clock = FIXED_NOW;
const now = () => clock;
const coordinators: TabSyncCoordinator[] = [];

function tab(options: Parameters<typeof createTabSyncCoordinator>[0] = {}) {
  const coordinator = createTabSyncCoordinator({ now, ...options });
  coordinators.push(coordinator);
  return coordinator;
}

function collect(coordinator: TabSyncCoordinator) {
  const events: TabSyncEvent[] = [];
  coordinator.subscribe((event) => events.push(event));
  return events;
}

beforeEach(() => {
  clock = FIXED_NOW;
  installFakeBroadcastChannel();
});

afterEach(() => {
  coordinators.splice(0).forEach((coordinator) => coordinator.close());
  resetTabSyncCoordinatorForTests();
  uninstallBroadcastChannel();
});

describe("tab sync coordinator: propagation (BroadcastChannel)", () => {
  it.each(TAB_SYNC_EVENT_TYPES)("positive: %s propagates to other tabs but is not echoed back", (type) => {
    const sender = tab({ tabId: TAB_A });
    const receiver = tab({ tabId: TAB_B });
    const sent = collect(sender);
    const received = collect(receiver);

    expect(sender.getTransportKind()).toBe("broadcast-channel");
    expect(sender.publish(type)).toBe("sent");

    expect(sent).toEqual([]);
    expect(received).toEqual([
      {
        type,
        level: TAB_SYNC_RESTRICTIVENESS[type],
        epoch: FIXED_NOW,
        sourceTabId: TAB_A,
        receivedAt: FIXED_NOW,
      },
    ]);
  });

  it("positive: tenant_switched carries the informational tenantId", () => {
    const sender = tab({ tabId: TAB_A });
    const received = collect(tab({ tabId: TAB_B }));
    sender.publish("tenant_switched", { tenantId: SYNTHETIC_TENANT_ID });
    expect(received[0]).toMatchObject({ type: "tenant_switched", tenantId: SYNTHETIC_TENANT_ID });
  });

  it("privacy: the wire payload holds only whitelisted fields, never the stored session", () => {
    window.localStorage.setItem(
      "earnproof.session",
      JSON.stringify({ token: "synthetic-session-token-do-not-use", user: { id: "user-synthetic" } }),
    );
    const spy = jest.spyOn(FakeBroadcastChannel.prototype, "postMessage");
    tab({ tabId: TAB_A }).publish("wallet_logout");

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0] as string;
    expect(typeof payload).toBe("string");
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual(["epoch", "tabId", "ts", "type", "v"]);
    expect(payload).not.toContain("synthetic-session-token");
    spy.mockRestore();
    window.localStorage.clear();
  });
});

describe("tab sync coordinator: storage-event fallback (regression: no BroadcastChannel)", () => {
  it("propagates every event type via localStorage when BroadcastChannel is undefined", () => {
    uninstallBroadcastChannel();
    const [winA, winB] = createStorageOnlyTabs(2);
    const sender = tab({ tabId: TAB_A, win: winA });
    const receiver = tab({ tabId: TAB_B, win: winB });
    const received = collect(receiver);

    expect(sender.getTransportKind()).toBe("storage");
    for (const [index, type] of TAB_SYNC_EVENT_TYPES.entries()) {
      clock = FIXED_NOW + index * TAB_SYNC_DEDUPE_WINDOW_MS;
      expect(sender.publish(type)).toBe("sent");
    }

    expect(received.map((event) => event.type)).toEqual([...TAB_SYNC_EVENT_TYPES]);
    // Nothing is left at rest in storage.
    expect(winA.localStorage.getItem(TAB_SYNC_STORAGE_KEY)).toBeNull();
  });

  it("ignores storage events for other keys (e.g. the session key itself)", () => {
    uninstallBroadcastChannel();
    const [winA, winB] = createStorageOnlyTabs(2);
    tab({ tabId: TAB_A, win: winA });
    const received = collect(tab({ tabId: TAB_B, win: winB }));

    winA.localStorage.setItem("earnproof.session", JSON.stringify(makeTabSyncMessage()));
    expect(received).toEqual([]);
  });

  it("reports unavailable when neither mechanism exists", () => {
    const coordinator = tab({ tabId: TAB_A, createTransport: () => null });
    expect(coordinator.getTransportKind()).toBeNull();
    expect(coordinator.publish("wallet_logout")).toBe("unavailable");
  });
});

describe("tab sync coordinator: rejection of hostile or broken input", () => {
  function receiverWithDrops() {
    const drops: string[] = [];
    const receiver = tab({ tabId: TAB_A, onDrop: (reason) => drops.push(reason) });
    return { receiver, drops, events: collect(receiver) };
  }

  it.each([
    ["malformed JSON", "{nope", "malformed"],
    ["a structured object (not a string)", makeTabSyncMessage(), "malformed"],
    ["an oversized payload", "x".repeat(10_000), "oversized"],
    ["an unknown version", JSON.stringify(makeTabSyncMessage({ v: 2 as unknown as 1 })), "unsupported_version"],
    ["an unknown type", JSON.stringify({ ...makeTabSyncMessage(), type: "login" }), "unknown_type"],
    ["a token-bearing message", JSON.stringify({ ...makeTabSyncMessage(), token: FAKE_JWT_LIKE }), "unexpected_field"],
    ["a stale timestamp", JSON.stringify(makeTabSyncMessage({ ts: FIXED_NOW - 60_000 })), "stale_timestamp"],
  ])("negative: drops %s without notifying subscribers", (_label, raw, reason) => {
    const { drops, events } = receiverWithDrops();
    FakeBroadcastChannel.inject(TAB_SYNC_CHANNEL_NAME, raw);
    expect(events).toEqual([]);
    expect(drops).toEqual([reason]);
  });

  it("authorization: a crafted login/role message cannot authenticate a tab", () => {
    const { events, drops } = receiverWithDrops();
    const crafted = [
      JSON.stringify({ v: 1, type: "login", epoch: FIXED_NOW, tabId: TAB_B, ts: FIXED_NOW, role: "ADMIN" }),
      JSON.stringify({ v: 1, type: "session_recovered", epoch: FIXED_NOW, tabId: TAB_B, ts: FIXED_NOW }),
      JSON.stringify({ ...makeTabSyncMessage({ type: "tenant_switched" }), authenticated: true }),
    ];
    crafted.forEach((raw) => FakeBroadcastChannel.inject(TAB_SYNC_CHANNEL_NAME, raw));
    expect(events).toEqual([]);
    expect(drops).toEqual(["unknown_type", "unknown_type", "unexpected_field"]);
  });

  it("authorization: every event a subscriber can ever receive is a downgrade level", () => {
    const { events } = receiverWithDrops();
    TAB_SYNC_EVENT_TYPES.forEach((type, index) =>
      FakeBroadcastChannel.inject(
        TAB_SYNC_CHANNEL_NAME,
        encodeTabSyncMessage(makeTabSyncMessage({ type, epoch: FIXED_NOW + index })),
      ),
    );
    expect(events.map((event) => event.level).every((level) => level >= 1 && level <= 4)).toBe(true);
  });

  it("refuses to publish an invalid tenantId rather than sending it", () => {
    const sender = tab({ tabId: TAB_A });
    const received = collect(tab({ tabId: TAB_B }));
    expect(sender.publish("tenant_switched", { tenantId: FAKE_JWT_LIKE })).toBe("invalid");
    expect(received).toEqual([]);
  });
});

describe("tab sync coordinator: replay and ordering", () => {
  it("replay: the same payload delivered twice is applied once", () => {
    const manual = createManualTransport();
    const drops: string[] = [];
    const receiver = tab({ tabId: TAB_A, createTransport: manual.create, onDrop: (r) => drops.push(r) });
    const events = collect(receiver);
    const payload = encodeTabSyncMessage(makeTabSyncMessage({ epoch: FIXED_NOW + 5 }));

    manual.deliver(payload);
    manual.deliver(payload);
    expect(events).toHaveLength(1);
    expect(drops).toEqual(["replay"]);
  });

  it("replay: an older epoch is ignored after a newer one, even if more restrictive", () => {
    const manual = createManualTransport();
    const receiver = tab({ tabId: TAB_A, createTransport: manual.create });
    const events = collect(receiver);

    manual.deliver(encodeTabSyncMessage(makeTabSyncMessage({ epoch: FIXED_NOW + 10, type: "tenant_switched" })));
    manual.deliver(encodeTabSyncMessage(makeTabSyncMessage({ epoch: FIXED_NOW + 9, type: "session_revoked", tabId: TAB_C })));
    expect(events.map((event) => event.type)).toEqual(["tenant_switched"]);
  });

  it("concurrency: simultaneous events from two tabs resolve identically in a third tab regardless of arrival order", () => {
    const fromB = encodeTabSyncMessage(makeTabSyncMessage({ tabId: TAB_B, type: "tenant_switched" }));
    const fromC = encodeTabSyncMessage(makeTabSyncMessage({ tabId: TAB_C, type: "session_revoked" }));

    const run = (order: Array<string | null>) => {
      const manual = createManualTransport();
      const receiver = tab({ tabId: TAB_A, createTransport: manual.create });
      const events = collect(receiver);
      order.forEach((payload) => manual.deliver(payload));
      return {
        last: receiver.getLastApplied(),
        maxLevel: Math.max(...events.map((event) => event.level)),
      };
    };

    const first = run([fromB, fromC]);
    const second = run([fromC, fromB]);
    expect(first).toEqual(second);
    expect(first.last).toEqual({ epoch: FIXED_NOW, tabId: TAB_C, type: "session_revoked" });
    expect(first.maxLevel).toBe(TAB_SYNC_RESTRICTIVENESS.session_revoked);
  });

  it("causal order: a tab that already saw an event stamps its next publish strictly later, in the same millisecond", () => {
    const tabA = tab({ tabId: TAB_A });
    const tabB = tab({ tabId: TAB_B });
    const observer = tab({ tabId: TAB_C });
    const eventsA = collect(tabA);
    const eventsB = collect(tabB);
    const observed = collect(observer);

    tabA.publish("wallet_logout");
    tabB.publish("tenant_switched", { tenantId: SYNTHETIC_TENANT_ID });

    expect(observed.map((event) => [event.type, event.epoch])).toEqual([
      ["wallet_logout", FIXED_NOW],
      ["tenant_switched", FIXED_NOW + 1],
    ]);
    expect(eventsB.map((event) => event.type)).toEqual(["wallet_logout"]);
    expect(eventsA.map((event) => event.type)).toEqual(["tenant_switched"]);
  });

  it("uses a hybrid logical clock: a publish after receiving a future epoch stamps a higher one", () => {
    const manual = createManualTransport();
    const coordinator = tab({ tabId: TAB_A, createTransport: manual.create });
    manual.deliver(encodeTabSyncMessage(makeTabSyncMessage({ epoch: FIXED_NOW + 20_000 })));

    coordinator.publish("tenant_switched");
    expect(JSON.parse(manual.posted[0]).epoch).toBe(FIXED_NOW + 20_001);
    expect(coordinator.getEpoch()).toBe(FIXED_NOW + 20_001);
  });
});

describe("tab sync coordinator: bounds", () => {
  it("boundary: deduplicates a repeat publish inside the window and allows it at exactly the window end", () => {
    const coordinator = tab({ tabId: TAB_A, createTransport: createManualTransport().create });
    expect(coordinator.publish("tenant_switched", { tenantId: SYNTHETIC_TENANT_ID })).toBe("sent");
    clock = FIXED_NOW + TAB_SYNC_DEDUPE_WINDOW_MS - 1;
    expect(coordinator.publish("tenant_switched", { tenantId: SYNTHETIC_TENANT_ID })).toBe("deduplicated");
    clock = FIXED_NOW + TAB_SYNC_DEDUPE_WINDOW_MS;
    expect(coordinator.publish("tenant_switched", { tenantId: SYNTHETIC_TENANT_ID })).toBe("sent");
  });

  it("does not deduplicate a tenant switch to a different tenant", () => {
    const coordinator = tab({ tabId: TAB_A, createTransport: createManualTransport().create });
    expect(coordinator.publish("tenant_switched", { tenantId: "org-synthetic-0001" })).toBe("sent");
    expect(coordinator.publish("tenant_switched", { tenantId: "org-synthetic-0002" })).toBe("sent");
  });

  it("boundary: rate limits publishing at exactly the limit and recovers at exactly the window end", () => {
    const manual = createManualTransport();
    const coordinator = tab({ tabId: TAB_A, createTransport: manual.create, dedupeWindowMs: 0 });
    for (let index = 0; index < TAB_SYNC_PUBLISH_LIMIT.max; index += 1) {
      expect(coordinator.publish("tenant_switched")).toBe("sent");
    }
    expect(coordinator.publish("session_revoked")).toBe("rate_limited");
    clock = FIXED_NOW + TAB_SYNC_PUBLISH_LIMIT.windowMs - 1;
    expect(coordinator.publish("session_revoked")).toBe("rate_limited");
    clock = FIXED_NOW + TAB_SYNC_PUBLISH_LIMIT.windowMs;
    expect(coordinator.publish("session_revoked")).toBe("sent");
    expect(manual.posted).toHaveLength(TAB_SYNC_PUBLISH_LIMIT.max + 1);
  });

  it("drops inbound messages beyond the inbound rate limit", () => {
    const manual = createManualTransport();
    const drops: string[] = [];
    const receiver = tab({ tabId: TAB_A, createTransport: manual.create, onDrop: (r) => drops.push(r) });
    const events = collect(receiver);
    for (let index = 0; index <= TAB_SYNC_INBOUND_LIMIT.max; index += 1) {
      manual.deliver(encodeTabSyncMessage(makeTabSyncMessage({ epoch: FIXED_NOW + index + 1, type: "tenant_switched" })));
    }
    expect(events).toHaveLength(TAB_SYNC_INBOUND_LIMIT.max);
    expect(drops).toEqual(["rate_limited"]);
  });
});

describe("tab sync coordinator: lifecycle", () => {
  it("closes the transport on pagehide and reopens it on a bfcache pageshow", () => {
    const manual = createManualTransport();
    const win = new EventTarget() as unknown as Window & typeof globalThis;
    const coordinator = tab({ tabId: TAB_A, win, createTransport: manual.create });
    const events = collect(coordinator);

    win.dispatchEvent(new Event("pagehide"));
    expect(manual.isOpen()).toBe(false);
    expect(coordinator.publish("wallet_logout")).toBe("unavailable");

    const pageshow = new Event("pageshow");
    Object.assign(pageshow, { persisted: true });
    win.dispatchEvent(pageshow);
    expect(manual.isOpen()).toBe(true);
    manual.deliver(encodeTabSyncMessage(makeTabSyncMessage()));
    expect(events).toHaveLength(1);
  });

  it("close() is permanent: no delivery, publish reports closed, unsubscribe is safe", () => {
    const sender = tab({ tabId: TAB_A });
    const receiver = tab({ tabId: TAB_B });
    const events = collect(receiver);
    receiver.close();

    sender.publish("wallet_logout");
    expect(events).toEqual([]);
    expect(receiver.publish("wallet_logout")).toBe("closed");
    expect(() => receiver.subscribe(() => undefined)()).not.toThrow();
  });

  it("unsubscribe stops delivery to that listener only", () => {
    const sender = tab({ tabId: TAB_A });
    const receiver = tab({ tabId: TAB_B });
    const kept = jest.fn();
    const removed = jest.fn();
    receiver.subscribe(kept);
    receiver.subscribe(removed)();

    sender.publish("wallet_logout");
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("a throwing listener does not prevent delivery to the others", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const sender = tab({ tabId: TAB_A });
    const receiver = tab({ tabId: TAB_B });
    const healthy = jest.fn();
    receiver.subscribe(() => {
      throw new Error("listener failure");
    });
    receiver.subscribe(healthy);

    sender.publish("wallet_logout");
    expect(healthy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("getTabSyncCoordinator returns one shared instance per tab and a fresh one after reset", () => {
    const first = getTabSyncCoordinator();
    expect(first).not.toBeNull();
    expect(getTabSyncCoordinator()).toBe(first);
    resetTabSyncCoordinatorForTests();
    expect(getTabSyncCoordinator()).not.toBe(first);
  });
});
