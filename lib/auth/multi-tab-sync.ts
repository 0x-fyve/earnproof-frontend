/**
 * MultiTabSync: legacy session-sync API, kept for compatibility (#274).
 *
 * @deprecated Use getTabSyncCoordinator() from ./tab-sync-coordinator.
 *
 * This is now a thin adapter over the versioned, validated tab-sync
 * coordinator (BroadcastChannel with a storage-event fallback). Migration
 * notes:
 * - The wire protocol changed. The old adapter posted unvalidated objects on
 *   the `earnproof-session-sync` channel; the coordinator uses
 *   `earnproof.tab-sync.v1`. A tab still running the old bundle does not sync
 *   with new tabs until it reloads. That is fail-safe: neither side can gain
 *   authorization from a message.
 * - Only downgrades cross tabs. broadcast('logout' | 'wallet_changed') sends
 *   `wallet_logout` and broadcast('session_expired') sends
 *   `session_revoked`. 'token_rotated' and 'session_recovered' are no
 *   longer transmitted, because a received message must never be able to
 *   signal that a session is (again) valid.
 * - onSync listeners receive `logout` for wallet_logout and
 *   `session_expired` for session_revoked. tenant_switched and
 *   recent_auth_expired are not mapped; subscribe to the coordinator for
 *   those.
 */

import { getTabSyncCoordinator, type TabSyncEvent } from './tab-sync-coordinator';
import type { TabSyncEventType } from './tab-sync-protocol';

export type SyncMessageType =
  | 'session_expired'
  | 'token_rotated'
  | 'logout'
  | 'wallet_changed'
  | 'session_recovered';

export interface SyncMessage {
  type: SyncMessageType;
  timestamp: number;
  sourceTabId: string;
  // No sensitive data (tokens, addresses) in message
}

export type SyncListener = (message: SyncMessage) => void;

const OUTBOUND: Partial<Record<SyncMessageType, TabSyncEventType>> = {
  logout: 'wallet_logout',
  wallet_changed: 'wallet_logout',
  session_expired: 'session_revoked',
};

const INBOUND: Partial<Record<TabSyncEventType, SyncMessageType>> = {
  wallet_logout: 'logout',
  session_revoked: 'session_expired',
};

export class MultiTabSync {
  private static instance: MultiTabSync | null = null;
  private unsubscribers: Set<() => void> = new Set();

  static getInstance(): MultiTabSync {
    if (!MultiTabSync.instance) {
      MultiTabSync.instance = new MultiTabSync();
    }
    return MultiTabSync.instance;
  }

  /**
   * Broadcast a legacy message type to other tabs. Types without a
   * downgrade equivalent are dropped.
   */
  broadcast(type: SyncMessageType): void {
    const mapped = OUTBOUND[type];
    if (!mapped) return;
    getTabSyncCoordinator()?.publish(mapped);
  }

  /**
   * Subscribe to sync messages from other tabs.
   */
  onSync(listener: SyncListener): () => void {
    const coordinator = getTabSyncCoordinator();
    if (!coordinator) return () => undefined;

    const unsubscribe = coordinator.subscribe((event: TabSyncEvent) => {
      const type = INBOUND[event.type];
      if (!type) return;
      listener({ type, timestamp: event.receivedAt, sourceTabId: event.sourceTabId });
    });
    this.unsubscribers.add(unsubscribe);
    return () => {
      unsubscribe();
      this.unsubscribers.delete(unsubscribe);
    };
  }

  /**
   * Get this tab's unique ID (for message filtering).
   */
  getTabId(): string {
    return getTabSyncCoordinator()?.tabId ?? '';
  }

  /**
   * Removes this adapter's listeners. The shared coordinator stays open for
   * its other subscribers; it closes itself on page hide.
   */
  destroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.clear();
  }

  /**
   * Reset for testing.
   */
  static reset(): void {
    MultiTabSync.instance?.destroy();
    MultiTabSync.instance = null;
  }
}
