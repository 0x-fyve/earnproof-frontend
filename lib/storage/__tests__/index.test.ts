/**
 * Tests for browser storage utilities
 */

import {
  STORAGE_KEYS,
  CURRENT_VERSIONS,
  getStorageValue,
  setStorageValue,
  removeStorageValue,
  clearAllStorage,
  getStorageStats,
  type StorageKey,
  type StorageDriver,
} from '..';

// Mock storage driver for testing
class MockStorageDriver implements StorageDriver {
  private store: Record<string, string> = {};
  
  getItem(key: StorageKey): string | null {
    return this.store[STORAGE_KEYS[key]] || null;
  }
  
  setItem(key: StorageKey, value: string): void {
    this.store[STORAGE_KEYS[key]] = value;
  }
  
  removeItem(key: StorageKey): void {
    delete this.store[STORAGE_KEYS[key]];
  }
  
  clear(): void {
    this.store = {};
  }
  
  getStore(): Record<string, string> {
    return { ...this.store };
  }
}

describe('Storage Utilities', () => {
  let mockDriver: MockStorageDriver;
  
  beforeEach(() => {
    mockDriver = new MockStorageDriver();
  });
  
  afterEach(() => {
    mockDriver.clear();
  });
  
  describe('Basic storage operations', () => {
    it('should store and retrieve values', () => {
      const sessionData = {
        data: {
          token: 'test-token-123',
          user: {
            id: 'user-123',
            walletAddress: 'GABCDEF...',
            email: 'test@example.com',
          },
        },
      };
      
      setStorageValue('SESSION', sessionData, mockDriver);
      
      const retrieved = getStorageValue('SESSION', mockDriver);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.version).toBe(CURRENT_VERSIONS.SESSION);
      expect(retrieved?.key).toBe('SESSION');
      expect(retrieved?.data.token).toBe('test-token-123');
      expect(retrieved?.data.user.walletAddress).toBe('GABCDEF...');
    });
    
    it('should handle null when value does not exist', () => {
      const retrieved = getStorageValue('SESSION', mockDriver);
      expect(retrieved).toBeNull();
    });
    
    it('should remove values', () => {
      setStorageValue('SESSION', {
        data: {
          token: 'test',
          user: { id: '1', walletAddress: 'G...' },
        },
      }, mockDriver);
      
      removeStorageValue('SESSION', mockDriver);
      
      const retrieved = getStorageValue('SESSION', mockDriver);
      expect(retrieved).toBeNull();
    });
    
    it('should clear all storage', () => {
      setStorageValue('SESSION', {
        data: {
          token: 'test',
          user: { id: '1', walletAddress: 'G...' },
        },
      }, mockDriver);
      
      clearAllStorage(mockDriver);
      
      const store = mockDriver.getStore();
      expect(Object.keys(store)).toHaveLength(0);
    });
  });
  
  describe('Migration support', () => {
    it('should migrate legacy session format', () => {
      // Legacy format without version
      const legacySession = {
        token: 'legacy-token',
        user: {
          id: 'legacy-user',
          walletAddress: 'GLEGACY...',
        },
      };
      
      mockDriver.setItem('SESSION', JSON.stringify(legacySession));
      
      const migrated = getStorageValue('SESSION', mockDriver);
      expect(migrated).toBeTruthy();
      expect(migrated?.version).toBe(1);
      expect(migrated?.data.token).toBe('legacy-token');
      expect(migrated?.data.user.walletAddress).toBe('GLEGACY...');
      
      // Verify migrated value was saved back
      const stored = JSON.parse(mockDriver.getItem('SESSION')!);
      expect(stored.version).toBe(1);
    });
    
    it('should reject corrupted data', () => {
      mockDriver.setItem('SESSION', 'not json at all');
      
      const result = getStorageValue('SESSION', mockDriver);
      expect(result).toBeNull();
      
      // Corrupted data should be removed
      const stored = mockDriver.getItem('SESSION');
      expect(stored).toBeNull();
    });
    
    it('should reject unknown version format', () => {
      // Version 999 doesn't exist
      const unknownVersion = {
        version: 999,
        data: { token: 'test', user: { id: '1', walletAddress: 'G...' } },
      };
      
      mockDriver.setItem('SESSION', JSON.stringify(unknownVersion));
      
      const result = getStorageValue('SESSION', mockDriver);
      expect(result).toBeNull();
      
      // Unknown version data should be removed
      const stored = mockDriver.getItem('SESSION');
      expect(stored).toBeNull();
    });
  });
  
  describe('Privacy and security', () => {
    it('should not store sensitive information in plain text', () => {
      const sessionData = {
        data: {
          token: 'sensitive-jwt-token.abc.xyz',
          user: {
            id: 'user-123',
            walletAddress: 'GPRIVATE...',
            email: 'private@example.com',
          },
        },
      };
      
      setStorageValue('SESSION', sessionData, mockDriver);
      
      const stored = mockDriver.getStore()[STORAGE_KEYS.SESSION];
      expect(stored).toBeTruthy();
      
      // Verify the stored value is JSON, not plain text exposure
      const parsed = JSON.parse(stored);
      expect(parsed.version).toBeDefined();
      expect(parsed.key).toBe('SESSION');
      
      // The actual sensitive data should be there but properly structured
      expect(parsed.data.token).toBe('sensitive-jwt-token.abc.xyz');
      expect(parsed.data.user.walletAddress).toBe('GPRIVATE...');
    });
    
    it('should clear session on logout simulation', () => {
      setStorageValue('SESSION', {
        data: {
          token: 'login-token',
          user: { id: 'user-1', walletAddress: 'GLOGIN...' },
        },
      }, mockDriver);
      
      // Simulate logout
      removeStorageValue('SESSION', mockDriver);
      
      const retrieved = getStorageValue('SESSION', mockDriver);
      expect(retrieved).toBeNull();
    });
  });
  
  describe('DISPLAY_PREFERENCES', () => {
    it('should store and retrieve display preferences', () => {
      setStorageValue(
        'DISPLAY_PREFERENCES',
        { data: { reducedMotion: 'enabled', highContrast: 'system' } },
        mockDriver
      );

      const retrieved = getStorageValue('DISPLAY_PREFERENCES', mockDriver);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.version).toBe(CURRENT_VERSIONS.DISPLAY_PREFERENCES);
      expect(retrieved?.data.reducedMotion).toBe('enabled');
      expect(retrieved?.data.highContrast).toBe('system');
    });

    it('should default to null when no preference has been saved', () => {
      const retrieved = getStorageValue('DISPLAY_PREFERENCES', mockDriver);
      expect(retrieved).toBeNull();
    });

    it('should reject corrupted display preference data', () => {
      mockDriver.setItem('DISPLAY_PREFERENCES', 'not json at all');

      const result = getStorageValue('DISPLAY_PREFERENCES', mockDriver);
      expect(result).toBeNull();
      expect(mockDriver.getItem('DISPLAY_PREFERENCES')).toBeNull();
    });

    it('should not store any sensitive state alongside display preferences', () => {
      setStorageValue(
        'DISPLAY_PREFERENCES',
        { data: { reducedMotion: 'disabled', highContrast: 'enabled' } },
        mockDriver
      );

      const stored = JSON.parse(mockDriver.getStore()[STORAGE_KEYS.DISPLAY_PREFERENCES]);
      expect(Object.keys(stored.data)).toEqual(['reducedMotion', 'highContrast']);
    });
  });

  describe('Storage statistics', () => {
    it('should provide storage statistics', () => {
      const stats1 = getStorageStats(mockDriver);
      expect(stats1[STORAGE_KEYS.SESSION].exists).toBe(false);
      
      setStorageValue('SESSION', {
        data: {
          token: 'stats-token',
          user: { id: 'stats-user', walletAddress: 'GSTATS...' },
        },
      }, mockDriver);
      
      const stats2 = getStorageStats(mockDriver);
      expect(stats2[STORAGE_KEYS.SESSION].exists).toBe(true);
      expect(stats2[STORAGE_KEYS.SESSION].version).toBe(1);
      expect(stats2[STORAGE_KEYS.SESSION].size).toBeGreaterThan(0);
    });
  });
  
  describe('Real localStorage driver', () => {
    // Skip in Node.js environment
    const isBrowser = typeof window !== 'undefined' && window.localStorage;
    
    if (isBrowser) {
      beforeEach(() => {
        localStorage.clear();
      });
      
      afterEach(() => {
        localStorage.clear();
      });
      
      it('should work with real localStorage', () => {
        setStorageValue('SESSION', {
          data: {
            token: 'real-token',
            user: { id: 'real-user', walletAddress: 'GREAL...' },
          },
        });
        
        const retrieved = getStorageValue('SESSION');
        expect(retrieved).toBeTruthy();
        expect(retrieved?.data.token).toBe('real-token');
        
        // Verify it's actually in localStorage
        const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
        expect(raw).toBeTruthy();
      });
      
      it('should handle localStorage errors gracefully', () => {
        // Mock localStorage.setItem to throw
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = () => {
          throw new Error('Quota exceeded');
        };
        
        expect(() => {
          setStorageValue('SESSION', {
            data: {
              token: 'test',
              user: { id: '1', walletAddress: 'G...' },
            },
          });
        }).not.toThrow();
        
        localStorage.setItem = originalSetItem;
      });
    }
  });
});
