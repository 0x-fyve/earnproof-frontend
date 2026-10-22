/**
 * Synthetic fixtures for cross-tab sync tests (#274). Tab ids and tenant
 * ids are obviously fake; nothing here is a real token, session id or
 * wallet secret. The "token-like" strings exist only to prove such
 * payloads are rejected.
 */

import type { TabSyncMessage } from "@/lib/auth/tab-sync-protocol";
import type { TabSyncTransport } from "@/lib/storage/tab-sync-transport";

export const TAB_A = "a".repeat(32);
export const TAB_B = "b".repeat(32);
export const TAB_C = "c".repeat(32);
export const SYNTHETIC_TENANT_ID = "org-synthetic-0001";

/** Fixed clock for deterministic epochs/timestamps: 2026-01-01T00:00:00.000Z. */
export const FIXED_NOW = Date.UTC(2026, 0, 1);

/** Looks like a JWT so tests can prove it is rejected. Not a real credential. */
export const FAKE_JWT_LIKE = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj";

export function makeTabSyncMessage(overrides: Partial<TabSyncMessage> = {}): TabSyncMessage {
  return {
    v: 1,
    type: "wallet_logout",
    epoch: FIXED_NOW,
    tabId: TAB_B,
    ts: FIXED_NOW,
    ...overrides,
  };
}

/**
 * In-memory BroadcastChannel: every instance with the same name receives
 * messages posted by the OTHER instances (as the real API does), delivered
 * synchronously so tests are deterministic.
 */
export class FakeBroadcastChannel {
  static registry = new Map<string, Set<FakeBroadcastChannel>>();
  private listeners = new Set<(event: MessageEvent) => void>();
  closed = false;

  constructor(readonly name: string) {
    const peers = FakeBroadcastChannel.registry.get(name) ?? new Set();
    peers.add(this);
    FakeBroadcastChannel.registry.set(name, peers);
  }

  postMessage(data: unknown) {
    if (this.closed) throw new Error("InvalidStateError: channel closed");
    for (const peer of FakeBroadcastChannel.registry.get(this.name) ?? []) {
      if (peer !== this && !peer.closed) peer.deliver(data);
    }
  }

  /** Simulates a message arriving from some other same-origin context. */
  static inject(name: string, data: unknown) {
    for (const peer of FakeBroadcastChannel.registry.get(name) ?? []) {
      if (!peer.closed) peer.deliver(data);
    }
  }

  deliver(data: unknown) {
    const event = { data } as MessageEvent;
    this.listeners.forEach((listener) => listener(event));
  }

  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    FakeBroadcastChannel.registry.get(this.name)?.delete(this);
  }
}

const globalWithChannel = globalThis as unknown as { BroadcastChannel?: unknown };

export function installFakeBroadcastChannel() {
  FakeBroadcastChannel.registry.clear();
  globalWithChannel.BroadcastChannel = FakeBroadcastChannel;
}

export function uninstallBroadcastChannel() {
  FakeBroadcastChannel.registry.clear();
  delete globalWithChannel.BroadcastChannel;
}

type FakeWindow = EventTarget & { localStorage: Storage; BroadcastChannel?: undefined };

/**
 * Several fake "tabs" sharing one localStorage area and NO BroadcastChannel,
 * to exercise the storage-event fallback. Like real browsers, a write fires
 * `storage` in every other tab but not in the writing one.
 */
export function createStorageOnlyTabs(count: number): Array<Window & typeof globalThis> {
  const store = new Map<string, string>();
  const tabs: FakeWindow[] = [];

  const dispatchToOthers = (source: FakeWindow, key: string, newValue: string | null) => {
    for (const tab of tabs) {
      if (tab === source) continue;
      const event = new Event("storage");
      Object.assign(event, { key, newValue, storageArea: tab.localStorage });
      tab.dispatchEvent(event);
    }
  };

  for (let index = 0; index < count; index += 1) {
    const tab = new EventTarget() as FakeWindow;
    const storage = {
      get length() {
        return store.size;
      },
      key: (position: number) => Array.from(store.keys())[position] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
        dispatchToOthers(tab, key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
        dispatchToOthers(tab, key, null);
      },
      clear: () => store.clear(),
    } as Storage;
    // Every tab sees the same logical storage area, so compare by identity
    // of the shared store via a per-tab view: the transport checks
    // event.storageArea === its own tab.localStorage, which holds here.
    Object.defineProperty(tab, "localStorage", { value: storage });
    tabs.push(tab);
  }

  return tabs as unknown as Array<Window & typeof globalThis>;
}

/** Transport whose inbound side the test drives directly, in any order. */
export function createManualTransport() {
  let handler: ((raw: unknown) => void) | null = null;
  const posted: string[] = [];
  const transport: TabSyncTransport = {
    kind: "broadcast-channel",
    post: (payload) => {
      posted.push(payload);
      return true;
    },
    close: () => {
      handler = null;
    },
  };
  return {
    posted,
    create: (onMessage: (raw: unknown) => void) => {
      handler = onMessage;
      return transport;
    },
    deliver: (raw: unknown) => handler?.(raw),
    isOpen: () => handler !== null,
  };
}
