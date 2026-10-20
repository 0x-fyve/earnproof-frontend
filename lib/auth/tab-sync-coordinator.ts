"use client";

/**
 * Bounded cross-tab coordinator for auth and tenant downgrades (#274).
 *
 * One publish/subscribe API over lib/storage/tab-sync-transport.ts:
 * - publish(type) stamps a hybrid-logical-clock epoch and sends a
 *   validated, token-free message to other same-origin tabs. Publishing is
 *   deduplicated (same type/tenant within TAB_SYNC_DEDUPE_WINDOW_MS) and
 *   rate limited (TAB_SYNC_PUBLISH_LIMIT).
 * - subscribe(listener) receives only messages that passed schema
 *   validation, the inbound rate limit and decideTabSyncMessage's
 *   replay/conflict rules. Messages are never echoed back to the tab that
 *   sent them, so a publisher performs its own local effect.
 *
 * Every event a subscriber can receive is a downgrade. Subscribers must only
 * ever log out, lock, drop tenant-scoped data or require re-auth in
 * response; authorization is always re-fetched from the server, never taken
 * from a message.
 *
 * The transport is closed on `pagehide` and reopened on a bfcache
 * `pageshow`, so a frozen page neither holds a channel open nor applies
 * stale messages; close() tears everything down permanently.
 */

import {
  TAB_SYNC_PROTOCOL_VERSION,
  TAB_SYNC_RESTRICTIVENESS,
  decideTabSyncMessage,
  decodeTabSyncPayload,
  encodeTabSyncMessage,
  validateTabSyncMessage,
  type TabSyncAppliedMarker,
  type TabSyncEventType,
  type TabSyncMessage,
  type TabSyncRejectReason,
} from "./tab-sync-protocol";
import {
  createTabSyncTransport,
  type TabSyncTransport,
  type TabSyncTransportKind,
} from "@/lib/storage/tab-sync-transport";

export interface RateLimit {
  max: number;
  windowMs: number;
}

/** At most 5 publishes per rolling second per tab. */
export const TAB_SYNC_PUBLISH_LIMIT: RateLimit = { max: 5, windowMs: 1_000 };
/** At most 20 inbound messages processed per rolling second; the rest are dropped. */
export const TAB_SYNC_INBOUND_LIMIT: RateLimit = { max: 20, windowMs: 1_000 };
/** A repeat publish of the same type (and tenant) within this window is dropped. */
export const TAB_SYNC_DEDUPE_WINDOW_MS = 500;

export interface TabSyncEvent {
  type: TabSyncEventType;
  /** TAB_SYNC_RESTRICTIVENESS of `type`; effects are cumulative for every lower level. */
  level: number;
  epoch: number;
  sourceTabId: string;
  /** Informational only. Never use it to select or authorize a tenant. */
  tenantId?: string;
  receivedAt: number;
}

export type TabSyncListener = (event: TabSyncEvent) => void;

export type TabSyncPublishResult =
  | "sent"
  | "deduplicated"
  | "rate_limited"
  | "invalid"
  | "unavailable"
  | "closed";

export type TabSyncDropReason =
  | TabSyncRejectReason
  | "own_message"
  | "replay"
  | "superseded"
  | "rate_limited";

export interface TabSyncCoordinator {
  readonly tabId: string;
  publish(type: TabSyncEventType, options?: { tenantId?: string }): TabSyncPublishResult;
  subscribe(listener: TabSyncListener): () => void;
  getEpoch(): number;
  getLastApplied(): TabSyncAppliedMarker | null;
  getTransportKind(): TabSyncTransportKind | null;
  isClosed(): boolean;
  close(): void;
}

export interface TabSyncCoordinatorOptions {
  now?: () => number;
  tabId?: string;
  win?: Window & typeof globalThis;
  createTransport?: (onMessage: (raw: unknown) => void) => TabSyncTransport | null;
  /** Diagnostics hook for dropped inbound messages; never receives the payload. */
  onDrop?: (reason: TabSyncDropReason) => void;
  publishLimit?: RateLimit;
  inboundLimit?: RateLimit;
  dedupeWindowMs?: number;
}

function generateTabId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Rolling-window limiter. A timestamp stops counting once `windowMs` has
 * fully elapsed, so a call at exactly `first + windowMs` is allowed again.
 */
function createLimiter({ max, windowMs }: RateLimit) {
  let timestamps: number[] = [];
  return (now: number): boolean => {
    timestamps = timestamps.filter((at) => now - at < windowMs);
    if (timestamps.length >= max) return false;
    timestamps.push(now);
    return true;
  };
}

export function createTabSyncCoordinator(options: TabSyncCoordinatorOptions = {}): TabSyncCoordinator {
  const now = options.now ?? (() => Date.now());
  const tabId = options.tabId ?? generateTabId();
  const win = options.win ?? (typeof window === "undefined" ? undefined : window);
  const dedupeWindowMs = options.dedupeWindowMs ?? TAB_SYNC_DEDUPE_WINDOW_MS;
  const allowPublish = createLimiter(options.publishLimit ?? TAB_SYNC_PUBLISH_LIMIT);
  const allowInbound = createLimiter(options.inboundLimit ?? TAB_SYNC_INBOUND_LIMIT);
  const openTransport =
    options.createTransport ?? ((onMessage) => createTabSyncTransport({ onMessage, win }));

  const listeners = new Set<TabSyncListener>();
  let epoch = 0;
  let lastApplied: TabSyncAppliedMarker | null = null;
  let lastPublished: { type: TabSyncEventType; tenantId?: string; at: number } | null = null;
  let closed = false;
  let transport: TabSyncTransport | null = null;

  const drop = (reason: TabSyncDropReason) => options.onDrop?.(reason);

  function handleRaw(raw: unknown) {
    if (closed || !transport) return;
    const receivedAt = now();
    if (!allowInbound(receivedAt)) {
      drop("rate_limited");
      return;
    }

    const decoded = decodeTabSyncPayload(raw, receivedAt);
    if (!decoded.ok) {
      drop(decoded.reason);
      return;
    }
    const message = decoded.message;

    const decision = decideTabSyncMessage(lastApplied, message, tabId);
    if (message.tabId !== tabId) {
      epoch = Math.max(epoch, message.epoch);
    }
    if (!decision.apply) {
      drop(decision.reason);
      return;
    }

    lastApplied = { epoch: message.epoch, tabId: message.tabId, type: message.type };
    const event: TabSyncEvent = {
      type: message.type,
      level: TAB_SYNC_RESTRICTIVENESS[message.type],
      epoch: message.epoch,
      sourceTabId: message.tabId,
      receivedAt,
    };
    if (message.tenantId !== undefined) event.tenantId = message.tenantId;

    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (error) {
        console.error("Tab sync listener error:", error);
      }
    }
  }

  const onPageHide = () => {
    transport?.close();
    transport = null;
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!closed && event.persisted && !transport) {
      transport = openTransport(handleRaw);
    }
  };

  transport = openTransport(handleRaw);
  win?.addEventListener("pagehide", onPageHide);
  win?.addEventListener("pageshow", onPageShow);

  return {
    tabId,

    publish(type, publishOptions = {}) {
      if (closed) return "closed";
      if (!transport) return "unavailable";

      const at = now();
      const tenantId = publishOptions.tenantId;
      if (
        lastPublished &&
        lastPublished.type === type &&
        lastPublished.tenantId === tenantId &&
        at - lastPublished.at < dedupeWindowMs
      ) {
        return "deduplicated";
      }
      if (!allowPublish(at)) return "rate_limited";

      const nextEpoch = Math.max(epoch + 1, at);
      const message: TabSyncMessage = {
        v: TAB_SYNC_PROTOCOL_VERSION,
        type,
        epoch: nextEpoch,
        tabId,
        ts: at,
      };
      if (tenantId !== undefined) message.tenantId = tenantId;

      // Outbound messages pass the same validator as inbound ones, so this
      // tab can never emit something a receiver would reject.
      const validated = validateTabSyncMessage(message, at);
      const payload = validated.ok ? encodeTabSyncMessage(validated.message) : null;
      if (!payload) return "invalid";
      if (!transport.post(payload)) return "unavailable";

      epoch = nextEpoch;
      lastApplied = { epoch: nextEpoch, tabId, type };
      lastPublished = { type, tenantId, at };
      return "sent";
    },

    subscribe(listener) {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getEpoch: () => epoch,
    getLastApplied: () => lastApplied,
    getTransportKind: () => transport?.kind ?? null,
    isClosed: () => closed,

    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      transport?.close();
      transport = null;
      win?.removeEventListener("pagehide", onPageHide);
      win?.removeEventListener("pageshow", onPageShow);
    },
  };
}

let sharedCoordinator: TabSyncCoordinator | null = null;

/** The tab-wide coordinator, created lazily; null during server rendering. */
export function getTabSyncCoordinator(): TabSyncCoordinator | null {
  if (typeof window === "undefined") return null;
  if (!sharedCoordinator || sharedCoordinator.isClosed()) {
    sharedCoordinator = createTabSyncCoordinator();
  }
  return sharedCoordinator;
}

export function resetTabSyncCoordinatorForTests(): void {
  sharedCoordinator?.close();
  sharedCoordinator = null;
}
