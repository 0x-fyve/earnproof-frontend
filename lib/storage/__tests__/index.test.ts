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

  const draft = (name: string) => ({
    data: { [name]: { savedAt: '2026-01-01T00:00:00.000Z', values: { note: 'synthetic' } } },
  });

  beforeEach(() => {
    mockDriver = new MockStorageDriver();
  });

  afterEach(() => {
    mockDriver.clear();
  });

  describe('Registered keys', () => {
    it('does not register a bearer token session key', () => {
      expect(Object.keys(STORAGE_KEYS)).not.toContain('SESSION');
      expect(Object.values(STORAGE_KEYS)).not.toContain('earnproof.session');
    });
  });

  describe('Basic storage operations', () => {
    it('should store and retrieve values', () => {
      setStorageValue('FORM_DRAFTS', draft('create-proof-flow'), mockDriver);

      const retrieved = getStorageValue('FORM_DRAFTS', mockDriver);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.version).toBe(CURRENT_VERSIONS.FORM_DRAFTS);
      expect(retrieved?.key).toBe('FORM_DRAFTS');
      expect(retrieved?.data['create-proof-flow']?.values).toEqual({ note: 'synthetic' });
    });

    it('should handle null when value does not exist', () => {
      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
    });

    it('should remove values', () => {
      setStorageValue('FORM_DRAFTS', draft('a'), mockDriver);

      removeStorageValue('FORM_DRAFTS', mockDriver);

      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
    });

    it('should clear all storage', () => {
      setStorageValue('FORM_DRAFTS', draft('a'), mockDriver);
      setStorageValue(
        'DISPLAY_PREFERENCES',
        { data: { reducedMotion: 'enabled', highContrast: 'system' } },
        mockDriver
      );

      clearAllStorage(mockDriver);

      expect(Object.keys(mockDriver.getStore())).toHaveLength(0);
    });
  });

  describe('Migration support', () => {
    it('should discard unversioned legacy values because no migration path exists', () => {
      mockDriver.setItem('FORM_DRAFTS', JSON.stringify({ a: { savedAt: 'x', values: {} } }));

      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
      expect(mockDriver.getItem('FORM_DRAFTS')).toBeNull();
    });

    it('should never migrate a legacy bearer-token shape into a registered key', () => {
      mockDriver.setItem(
        'FORM_DRAFTS',
        JSON.stringify({ token: 'legacy-token', user: { id: 'u', walletAddress: 'G...' } })
      );

      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
      expect(mockDriver.getItem('FORM_DRAFTS')).toBeNull();
    });

    it('should reject corrupted data', () => {
      mockDriver.setItem('FORM_DRAFTS', 'not json at all');

      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
      expect(mockDriver.getItem('FORM_DRAFTS')).toBeNull();
    });

    it('should reject unknown version format', () => {
      mockDriver.setItem('FORM_DRAFTS', JSON.stringify({ version: 999, data: {} }));

      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
      expect(mockDriver.getItem('FORM_DRAFTS')).toBeNull();
    });

    it('should accept the exact current version and reject one version ahead', () => {
      const current = CURRENT_VERSIONS.FORM_DRAFTS;
      mockDriver.setItem('FORM_DRAFTS', JSON.stringify({ version: current, data: {} }));
      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeTruthy();

      mockDriver.setItem('FORM_DRAFTS', JSON.stringify({ version: current + 1, data: {} }));
      expect(getStorageValue('FORM_DRAFTS', mockDriver)).toBeNull();
      expect(mockDriver.getItem('FORM_DRAFTS')).toBeNull();
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
      expect(stats1[STORAGE_KEYS.FORM_DRAFTS].exists).toBe(false);

      setStorageValue('FORM_DRAFTS', draft('stats'), mockDriver);

      const stats2 = getStorageStats(mockDriver);
      expect(stats2[STORAGE_KEYS.FORM_DRAFTS].exists).toBe(true);
      expect(stats2[STORAGE_KEYS.FORM_DRAFTS].version).toBe(1);
      expect(stats2[STORAGE_KEYS.FORM_DRAFTS].size).toBeGreaterThan(0);
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
        setStorageValue('FORM_DRAFTS', draft('real'));

        const retrieved = getStorageValue('FORM_DRAFTS');
        expect(retrieved).toBeTruthy();
        expect(retrieved?.data.real?.values).toEqual({ note: 'synthetic' });

        // Verify it's actually in localStorage
        expect(localStorage.getItem(STORAGE_KEYS.FORM_DRAFTS)).toBeTruthy();
      });

      it('should handle localStorage errors gracefully', () => {
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new Error('Quota exceeded');
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => setStorageValue('FORM_DRAFTS', draft('x'))).not.toThrow();

        spy.mockRestore();
        errorSpy.mockRestore();
      });
    }
  });
});
