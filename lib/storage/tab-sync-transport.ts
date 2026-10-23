"use client";

/**
 * Same-origin transport for cross-tab auth/tenant sync (#274).
 *
 * Prefers BroadcastChannel; falls back to `storage` events on a dedicated
 * localStorage key when BroadcastChannel is unavailable. Both are
 * same-origin by construction - there is intentionally no postMessage or
 * any other cross-origin path.
 *
 * The transport only moves opaque strings. It never touches the session
 * key (`earnproof.session`) and never parses or trusts what it carries;
 * size, schema and ordering checks belong to lib/auth/tab-sync-protocol.ts
 * and lib/auth/tab-sync-coordinator.ts.
 */

export const TAB_SYNC_CHANNEL_NAME = "earnproof.tab-sync.v1";

/**
 * Fallback key. Holds a single validated, token-free message for an instant:
 * it is written and immediately removed, so nothing persists at rest.
 */
export const TAB_SYNC_STORAGE_KEY = "earnproof.tab-sync.v1";

export type TabSyncTransportKind = "broadcast-channel" | "storage";

export interface TabSyncTransport {
  readonly kind: TabSyncTransportKind;
  /** Returns false if the payload could not be handed to the browser. */
  post(payload: string): boolean;
  close(): void;
}

export interface CreateTabSyncTransportOptions {
  onMessage: (raw: unknown) => void;
  /** Injected for tests; defaults to the global window. */
  win?: Window & typeof globalThis;
}

function createBroadcastChannelTransport(
  win: Window & typeof globalThis,
  onMessage: (raw: unknown) => void,
): TabSyncTransport | null {
  const Channel = win.BroadcastChannel;
  if (typeof Channel !== "function") return null;

  let channel: BroadcastChannel;
  try {
    channel = new Channel(TAB_SYNC_CHANNEL_NAME);
  } catch {
    return null;
  }

  const handler = (event: MessageEvent) => onMessage(event.data);
  channel.addEventListener("message", handler);

  return {
    kind: "broadcast-channel",
    post(payload) {
      try {
        channel.postMessage(payload);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      channel.removeEventListener("message", handler);
      channel.close();
    },
  };
}

function createStorageTransport(
  win: Window & typeof globalThis,
  onMessage: (raw: unknown) => void,
): TabSyncTransport | null {
  let storage: Storage;
  try {
    storage = win.localStorage;
    if (!storage) return null;
  } catch {
    // Access can throw when storage is disabled.
    return null;
  }

  const handler = (event: StorageEvent) => {
    if (event.key !== TAB_SYNC_STORAGE_KEY) return;
    if (event.storageArea !== storage) return;
    // The immediate removeItem produces a second event with newValue null.
    if (event.newValue === null) return;
    onMessage(event.newValue);
  };
  win.addEventListener("storage", handler);

  return {
    kind: "storage",
    post(payload) {
      try {
        storage.setItem(TAB_SYNC_STORAGE_KEY, payload);
        storage.removeItem(TAB_SYNC_STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      win.removeEventListener("storage", handler);
    },
  };
}

/** Returns null outside the browser or when neither mechanism is usable. */
export function createTabSyncTransport({
  onMessage,
  win = typeof window === "undefined" ? undefined : window,
}: CreateTabSyncTransportOptions): TabSyncTransport | null {
  if (!win) return null;
  return createBroadcastChannelTransport(win, onMessage) ?? createStorageTransport(win, onMessage);
}
