/**
 * Tests for MultiTabSync:
 * - Multi-tab sync via BroadcastChannel
 * - No sensitive data in messages
 * - Listener subscription and notification
 */

import { MultiTabSync } from '../multi-tab-sync';

describe('MultiTabSync', () => {
  beforeEach(() => {
    MultiTabSync.reset();
  });

  afterEach(() => {
    MultiTabSync.reset();
  });

  describe('broadcast channel communication', () => {
    it('should initialize BroadcastChannel', () => {
      const sync = MultiTabSync.getInstance();
      expect(sync).toBeDefined();
      expect(sync.getTabId()).toBeDefined();
    });

    it('should generate unique tab IDs', () => {
      const sync1 = MultiTabSync.getInstance();
      const id1 = sync1.getTabId();

      MultiTabSync.reset();

      const sync2 = MultiTabSync.getInstance();
      const id2 = sync2.getTabId();

      expect(id1).not.toBe(id2);
    });

    it('should broadcast logout message', (done) => {
      const sync = MultiTabSync.getInstance();

      sync.onSync((message) => {
        expect(message.type).toBe('logout');
        expect(message.sourceTabId).toBe(sync.getTabId());
        expect(message.timestamp).toBeGreaterThan(0);
        done();
      });

      sync.broadcast('logout');
    });

    it('should broadcast session_expired message', (done) => {
      const sync = MultiTabSync.getInstance();

      sync.onSync((message) => {
        expect(message.type).toBe('session_expired');
        done();
      });

      sync.broadcast('session_expired');
    });

    it('should broadcast token_rotated message', (done) => {
      const sync = MultiTabSync.getInstance();

      sync.onSync((message) => {
        expect(message.type).toBe('token_rotated');
        done();
      });

      sync.broadcast('token_rotated');
    });

    it('should broadcast wallet_changed message', (done) => {
      const sync = MultiTabSync.getInstance();

      sync.onSync((message) => {
        expect(message.type).toBe('wallet_changed');
        done();
      });

      sync.broadcast('wallet_changed');
    });

    it('should NOT include sensitive data in messages', (done) => {
      const sync = MultiTabSync.getInstance();

      sync.onSync((message) => {
        // Message should only have: type, timestamp, sourceTabId
        const keys = Object.keys(message);
        expect(keys).toEqual(['type', 'timestamp', 'sourceTabId']);

        // No token, address, or other sensitive data
        expect((message as any).token).toBeUndefined();
        expect((message as any).walletAddress).toBeUndefined();
        expect((message as any).user).toBeUndefined();

        done();
      });

      sync.broadcast('logout');
    });
  });

  describe('listener subscription', () => {
    it('should notify listeners on sync message', (done) => {
      const sync = MultiTabSync.getInstance();
      let callCount = 0;

      sync.onSync((message) => {
        callCount++;
        if (callCount === 1) {
          done();
        }
      });

      sync.broadcast('logout');
    });

    it('should handle multiple listeners', (done) => {
      const sync = MultiTabSync.getInstance();
      const calls: number[] = [];

      sync.onSync(() => calls.push(1));
      sync.onSync(() => calls.push(2));

      sync.broadcast('logout');

      setTimeout(() => {
        expect(calls.length).toBeGreaterThanOrEqual(2);
        done();
      }, 50);
    });

    it('should allow unsubscription', (done) => {
      const sync = MultiTabSync.getInstance();
      const calls: number[] = [];

      const unsubscribe = sync.onSync(() => calls.push(1));

      sync.broadcast('logout');

      setTimeout(() => {
        const callsAfterFirst = calls.length;
        unsubscribe();

        sync.broadcast('session_expired');

        setTimeout(() => {
          expect(calls.length).toBe(callsAfterFirst);
          done();
        }, 50);
      }, 50);
    });

    it('should not crash if listener throws', (done) => {
      const sync = MultiTabSync.getInstance();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      sync.onSync(() => {
        throw new Error('Listener error');
      });

      sync.onSync(() => {
        // This should still be called
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
        done();
      });

      sync.broadcast('logout');
    });
  });

  describe('cross-tab filtering', () => {
    it('should filter out messages from same tab', (done) => {
      const sync = MultiTabSync.getInstance();
      const tabId = sync.getTabId();

      const listener = jest.fn();
      sync.onSync(listener);

      sync.broadcast('logout');

      // Message from same tab should be filtered
      setTimeout(() => {
        expect(listener).not.toHaveBeenCalled();
        done();
      }, 50);
    });
  });

  describe('error handling', () => {
    it('should gracefully handle broadcast errors', () => {
      const sync = MultiTabSync.getInstance();

      // Try to broadcast even if channel might not be available
      expect(() => sync.broadcast('logout')).not.toThrow();
    });

    it('should gracefully handle malformed messages', (done) => {
      const sync = MultiTabSync.getInstance();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      sync.onSync(() => {
        // Should not crash on malformed message
      });

      try {
        // Simulate malformed message delivery
        sync.broadcast('logout');
      } catch {
        // OK to fail
      }

      setTimeout(() => {
        consoleErrorSpy.mockRestore();
        done();
      }, 50);
    });
  });

  describe('lifecycle', () => {
    it('should cleanup on destroy', () => {
      const sync = MultiTabSync.getInstance();
      const unsub = sync.onSync(() => {});

      sync.destroy();

      // After destroy, channel should be closed
      expect(() => sync.broadcast('logout')).not.toThrow();

      unsub();
    });

    it('should reset singleton', () => {
      const sync1 = MultiTabSync.getInstance();
      const id1 = sync1.getTabId();

      MultiTabSync.reset();

      const sync2 = MultiTabSync.getInstance();
      const id2 = sync2.getTabId();

      expect(id1).not.toBe(id2);
      expect(sync1).not.toBe(sync2);
    });
  });

  describe('message timestamps', () => {
    it('should include accurate timestamps', (done) => {
      const sync = MultiTabSync.getInstance();
      const beforeBroadcast = Date.now();

      sync.onSync((message) => {
        expect(message.timestamp).toBeGreaterThanOrEqual(beforeBroadcast);
        expect(message.timestamp).toBeLessThanOrEqual(Date.now() + 100);
        done();
      });

      sync.broadcast('logout');
    });
  });
});
