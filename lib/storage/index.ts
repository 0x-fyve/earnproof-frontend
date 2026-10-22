/**
 * Browser storage utilities with versioning and migration support
 *
 * Every key here must also be declared in `registry.json` (checked by
 * scripts/storage-schema-audit.js and tests/storage). Bearer tokens and other
 * secrets are never stored here.
 * 
 * This module provides a structured approach to browser storage with:
 * - Versioned schemas
 * - Migration support
 * - Type safety
 * - Clear ownership and retention policies
 */

export const STORAGE_KEYS = {
  FORM_DRAFTS: 'earnproof.form-drafts' as const,
  DISPLAY_PREFERENCES: 'earnproof.display-preferences' as const,
  PROOF_DRAFTS: 'earnproof.proof-drafts' as const,
  TRANSACTION_OPERATIONS: 'earnproof.transaction-operations' as const,
  QUICKSTART_PROGRESS: 'earnproof.quickstart-progress' as const,
} as const;

export type StorageKey = keyof typeof STORAGE_KEYS;

export type DisplayPreferenceMode = 'system' | 'enabled' | 'disabled';

export interface PersistedTransactionOperationRef {
  operationId: string;
  transactionHash: string;
  network: 'testnet' | 'public';
  status:
    | 'submitted'
    | 'included'
    | 'finalized'
    | 'failed'
    | 'replaced'
    | 'timed-out';
  resourceType: string;
  resourceId: string;
  resourceHref: string | null;
  ledger: number | null;
  confirmations: number;
  requiredConfirmations: number;
  replacedByHash: string | null;
  diagnosticMessage: string | null;
  reorgCount: number;
  submittedAt: string;
  updatedAt: string;
  timeoutAt: string;
  expiresAt: string;
}

export interface StorageSchema {
  FORM_DRAFTS: {
    // Keyed by an application-chosen form id (e.g. "create-proof-flow") so
    // multiple forms can each keep their own draft without colliding.
    data: Record<string, { savedAt: string; values: unknown }>;
  };
  DISPLAY_PREFERENCES: {
    data: {
      reducedMotion: DisplayPreferenceMode;
      highContrast: DisplayPreferenceMode;
    };
  };
  PROOF_DRAFTS: {
    // Keyed by proof type (e.g. "minimum-income", "payment-receipt", "recurring-income")
    // Each draft stores non-secret field values with an explicit retention limit.
    data: Record<string, { savedAt: string; expiresAt: string; values: unknown }>;
  };
  TRANSACTION_OPERATIONS: {
    // Keyed by operationId; stores only non-sensitive operation references with bounded expiry.
    data: Record<string, PersistedTransactionOperationRef>;
  QUICKSTART_PROGRESS: {
    // Checklist step ids only (see lib/developers/quickstart.ts's
    // QUICKSTART_STEPS) - never an API secret, key id, or request payload.
    data: { completedSteps: string[]; updatedAt: string };
  };
}

// Current versions of each storage schema
export const CURRENT_VERSIONS: Record<StorageKey, number> = {
  FORM_DRAFTS: 1,
  DISPLAY_PREFERENCES: 1,
  PROOF_DRAFTS: 1,
  TRANSACTION_OPERATIONS: 1,
  QUICKSTART_PROGRESS: 1,
};

export interface StorageMetadata {
  version: number;
  timestamp: string;
  key: StorageKey;
}

export type StoredValue<K extends StorageKey> = StorageSchema[K] &
  StorageMetadata & {
    key: K;
  };

type StorageMigration = (data: unknown) => unknown;

type StorageStats = Record<
  string,
  {
    exists: boolean;
    version: number | "none";
    size: number;
    age: string;
  }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Base storage interface
 */
export interface StorageDriver {
  getItem<K extends StorageKey>(key: K): string | null;
  setItem<K extends StorageKey>(key: K, value: string): void;
  removeItem<K extends StorageKey>(key: K): void;
}

/**
 * Default storage driver using localStorage
 */
export const localStorageDriver: StorageDriver = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(STORAGE_KEYS[key]);
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS[key], value);
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(STORAGE_KEYS[key]);
  },
};

/**
 * Migration functions for each storage key
 */
export const migrations: Record<StorageKey, Record<number, StorageMigration>> = {
  FORM_DRAFTS: {
    // Version 1 is current - no migration needed
    1: (data) => data,
  },
  DISPLAY_PREFERENCES: {
    // Version 1 is current - no migration needed
    1: (data) => data,
  },
  PROOF_DRAFTS: {
    // Version 1 is current - no migration needed
    1: (data) => data,
  },
  TRANSACTION_OPERATIONS: {
  QUICKSTART_PROGRESS: {
    // Version 1 is current - no migration needed
    1: (data) => data,
  },
};

/**
 * Safely get a value from storage with migration support
 */
export function getStorageValue<K extends StorageKey>(
  key: K,
  driver: StorageDriver = localStorageDriver
): StoredValue<K> | null {
  try {
    const raw = driver.getItem(key);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    
    // Check if it has version metadata
    if (isRecord(parsed) && typeof parsed.version === 'number') {
      const version = parsed.version;
      const currentVersion = CURRENT_VERSIONS[key];
      
      if (version === currentVersion) {
        return parsed as unknown as StoredValue<K>;
      }
      
      // Try to migrate
      const migrated = migrateValue(key, parsed, version, currentVersion);
      if (migrated) {
        // Save migrated value
        setStorageValue(key, migrated, driver);
        return migrated as StoredValue<K>;
      }
      
      // Migration failed - remove corrupted data
      driver.removeItem(key);
      return null;
    }
    
    // Unversioned value under an envelope key. None of these keys ever shipped
    // without a version, so there is no migration path: treat it as unknown
    // data and discard it. The retired bearer-token session entry is not
    // migrated either; lib/session.ts deletes it (see "retired" in registry.json).
    driver.removeItem(key);
    return null;
  } catch (error) {
    // Parse error or other issue - remove corrupted data
    console.error(`Failed to parse storage value for key ${key}:`, error);
    driver.removeItem(key);
    return null;
  }
}

/**
 * Set a value in storage with version metadata
 */
export function setStorageValue<K extends StorageKey>(
  key: K,
  value: Omit<StoredValue<K>, 'version' | 'timestamp' | 'key'>,
  driver: StorageDriver = localStorageDriver
): void {
  try {
    const storedValue: StoredValue<K> = {
      ...value,
      version: CURRENT_VERSIONS[key],
      timestamp: new Date().toISOString(),
      key,
    } as unknown as StoredValue<K>;
    
    driver.setItem(key, JSON.stringify(storedValue));
  } catch (error) {
    console.error(`Failed to set storage value for key ${key}:`, error);
  }
}

/**
 * Remove a value from storage
 */
export function removeStorageValue<K extends StorageKey>(
  key: K,
  driver: StorageDriver = localStorageDriver
): void {
  driver.removeItem(key);
}

/**
 * Clear all application storage
 */
export function clearAllStorage(driver: StorageDriver = localStorageDriver): void {
  Object.keys(STORAGE_KEYS).forEach((key) => {
    driver.removeItem(key as StorageKey);
  });
}

/**
 * Migrate a value from an older version to current version
 */
function migrateValue<K extends StorageKey>(
  key: K,
  value: unknown,
  fromVersion: number,
  toVersion: number
): StoredValue<K> | null {
  try {
    if (fromVersion > toVersion) {
      return null;
    }

    let current: unknown = value;
    
    // Apply migrations in sequence
    for (let v = fromVersion + 1; v <= toVersion; v++) {
      const migration = migrations[key]?.[v];
      if (migration) {
        current = migration(current);
      } else {
        // No migration path - cannot migrate
        return null;
      }
    }
    
    if (!isRecord(current)) {
      return null;
    }

    return {
      ...current,
      version: toVersion,
      timestamp: new Date().toISOString(),
      key,
    } as unknown as StoredValue<K>;
  } catch (error) {
    console.error(`Migration failed for ${key} from v${fromVersion} to v${toVersion}:`, error);
    return null;
  }
}

/**
 * Get storage statistics for debugging
 */
export function getStorageStats(driver: StorageDriver = localStorageDriver): StorageStats {
  if (typeof window === 'undefined') return {};
  
  const stats: StorageStats = {};
  
  Object.entries(STORAGE_KEYS).forEach(([keyName, keyValue]) => {
    const key = keyName as StorageKey;
    const value = getStorageValue(key, driver);
    
    stats[keyValue] = {
      exists: value !== null,
      version: value?.version || 'none',
      size: value ? JSON.stringify(value).length : 0,
      age: value?.timestamp ? 
        Math.floor((Date.now() - new Date(value.timestamp).getTime()) / 1000) + 's' : 
        'unknown',
    };
  });
  
  return stats;
}
