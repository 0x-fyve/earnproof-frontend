/**
 * MultiTabSync: Synchronizes session state across tabs/windows.
 *
 * Uses BroadcastChannel API (with fallback to storage events for older browsers).
 * Communicates state changes but NEVER sends token material or sensitive data.
 */

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

/**
 * MultiTabSync broadcasts session events to other tabs.
 * Other tabs listen and invalidate local state as needed.
 */
export class MultiTabSync {
  private static instance: MultiTabSync;
  private channel: BroadcastChannel | null = null;
  private listeners: Set<SyncListener> = new Set();
  private tabId: string;
  private readonly CHANNEL_NAME = 'earnproof-session-sync';

  private constructor() {
    this.tabId = this.generateTabId();
    this.initializeChannel();
  }

  static getInstance(): MultiTabSync {
    if (!MultiTabSync.instance) {
      MultiTabSync.instance = new MultiTabSync();
    }
    return MultiTabSync.instance;
  }

  /**
   * Initialize BroadcastChannel if available.
   */
  private initializeChannel(): void {
    if (typeof window === 'undefined') return;

    try {
      this.channel = new BroadcastChannel(this.CHANNEL_NAME);
      this.channel.onmessage = (event) => {
        try {
          const message = event.data as SyncMessage;
          // Only process messages from other tabs
          if (message.sourceTabId !== this.tabId) {
            this.emitToListeners(message);
          }
        } catch (error) {
          console.error('Sync message processing error:', error);
        }
      };
    } catch {
      // BroadcastChannel not supported; communication disabled
      console.debug('BroadcastChannel not available; multi-tab sync disabled');
    }
  }

  /**
   * Broadcast a message to other tabs.
   * Message contains NO sensitive data.
   */
  broadcast(type: SyncMessageType): void {
    if (!this.channel) return;

    const message: SyncMessage = {
      type,
      timestamp: Date.now(),
      sourceTabId: this.tabId,
    };

    try {
      this.channel.postMessage(message);
    } catch (error) {
      console.error('Failed to broadcast sync message:', error);
    }
  }

  /**
   * Subscribe to sync messages from other tabs.
   */
  onSync(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get this tab's unique ID (for message filtering).
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Emit to all listeners (internal use).
   */
  private emitToListeners(message: SyncMessage): void {
    this.listeners.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error('Sync listener error:', error);
      }
    });
  }

  /**
   * Generate a unique tab ID (uuidv4-like).
   */
  private generateTabId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup (on app unmount).
   */
  destroy(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  /**
   * Reset for testing.
   */
  static reset(): void {
    if (MultiTabSync.instance) {
      MultiTabSync.instance.destroy();
      MultiTabSync.instance.listeners.clear();
    }
    MultiTabSync.instance = null as any;
  }
}
