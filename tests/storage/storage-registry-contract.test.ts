/**
 * Issue #304: the real repository must satisfy its own storage contract, and
 * the versioned envelope keys in lib/storage must match registry.json
 * (keys, versions, migration chains and cleanup).
 *
 * Also guards issue #305: no code may persist a bearer token or read the
 * retired `earnproof.session` entry.
 */

import {
  STORAGE_KEYS,
  CURRENT_VERSIONS,
  migrations,
  clearAllStorage,
  setStorageValue,
  getStorageValue,
  type StorageDriver,
  type StorageKey,
} from "@/lib/storage";
import { STORAGE_REGISTRY, findStorageEntry, isRetiredStorageKey } from "@/lib/storage/registry";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditStorage } = require("../../scripts/storage-schema-audit.js") as {
  auditStorage: () => { success: boolean; errors: string[]; warnings: string[]; stats: { entries: number } };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateStorageSchemas } = require("../../scripts/validate-production-readiness.js") as {
  validateStorageSchemas: () => { success: boolean; errors: string[]; warnings: string[] };
};

const envelopeEntries = STORAGE_REGISTRY.entries.filter((e) => e.format === "envelope");

function memoryDriver(): StorageDriver & { dump: () => Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    getItem: (key: StorageKey) => store[STORAGE_KEYS[key]] ?? null,
    setItem: (key: StorageKey, value: string) => {
      store[STORAGE_KEYS[key]] = value;
    },
    removeItem: (key: StorageKey) => {
      delete store[STORAGE_KEYS[key]];
    },
    dump: () => ({ ...store }),
  };
}

describe("repository storage audit", () => {
  it("has no undeclared, unregistered, retired or unsafe persistence", () => {
    const result = auditStorage();
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.stats.entries).toBe(STORAGE_REGISTRY.entries.length);
  });

  it("is what npm run validate:production runs, with the same verdict", () => {
    const result = validateStorageSchemas();
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports every unversioned store as an explicit warning", () => {
    const legacy = STORAGE_REGISTRY.entries.filter((e) => e.format === "legacy-unversioned");
    const warnings = auditStorage().warnings;
    expect(warnings).toHaveLength(legacy.length);
    for (const entry of legacy) {
      expect(warnings.some((w) => w.includes(`${entry.id} (`))).toBe(true);
    }
  });
});

describe("registry content rules", () => {
  it("never classifies or names anything as a secret", () => {
    for (const entry of STORAGE_REGISTRY.entries) {
      expect(["preference", "draft", "cache", "user-record", "ui-state"]).toContain(entry.classification);
      expect(entry.key).not.toMatch(/token|secret|password|mnemonic|signature|bearer|jwt/i);
    }
  });

  it("retires the legacy bearer session key and does not register it", () => {
    expect(isRetiredStorageKey("earnproof.session")).toBe(true);
    expect(findStorageEntry("earnproof.session")).toBeNull();
    expect(STORAGE_REGISTRY.retired[0]?.removedBy).toEqual(["lib/session.ts"]);
  });

  it("requires user-scoped records to be keyed by a prefix", () => {
    for (const entry of STORAGE_REGISTRY.entries.filter((e) => e.scope !== "browser")) {
      expect(entry.match).toBe("prefix");
    }
  });

  it("resolves exact and prefixed keys to one owner, and unknown keys to none", () => {
    expect(findStorageEntry("earnproof.display-preferences")?.id).toBe("DISPLAY_PREFERENCES");
    expect(findStorageEntry("earnproof.trusted-sources.user-1")?.id).toBe("TRUSTED_SOURCES");
    expect(findStorageEntry("earnproof:approvals:u:o")?.id).toBe("APPROVAL_STORE");
    expect(findStorageEntry("earnproof.display-preferences-extra")).toBeNull();
    expect(findStorageEntry("other.key")).toBeNull();
  });
});

describe("versioned envelope keys match the registry", () => {
  it("registers exactly the keys lib/storage exposes", () => {
    const fromRegistry = envelopeEntries.map((e) => e.key).sort();
    const fromCode = Object.values(STORAGE_KEYS).sort();
    expect(fromRegistry).toEqual(fromCode);
  });

  it.each(Object.keys(STORAGE_KEYS) as StorageKey[])("%s: schema version and migration chain", (id) => {
    const entry = envelopeEntries.find((e) => e.key === STORAGE_KEYS[id]);
    expect(entry).toBeDefined();
    expect(entry?.schemaVersion).toBe(CURRENT_VERSIONS[id]);
    for (let version = 1; version <= CURRENT_VERSIONS[id]; version += 1) {
      expect(typeof migrations[id][version]).toBe("function");
    }
    expect(migrations[id][CURRENT_VERSIONS[id] + 1]).toBeUndefined();
  });

  it("clearAllStorage removes every envelope key (logout / account change cleanup)", () => {
    const driver = memoryDriver();
    for (const id of Object.keys(STORAGE_KEYS) as StorageKey[]) {
      setStorageValue(id, { data: {} } as never, driver);
    }
    expect(Object.keys(driver.dump())).toHaveLength(envelopeEntries.length);

    clearAllStorage(driver);

    expect(driver.dump()).toEqual({});
  });

  it("round-trips each envelope key with its registered version and drops other versions", () => {
    for (const id of Object.keys(STORAGE_KEYS) as StorageKey[]) {
      const driver = memoryDriver();
      setStorageValue(id, { data: {} } as never, driver);
      expect(getStorageValue(id, driver)?.version).toBe(CURRENT_VERSIONS[id]);

      driver.setItem(id, JSON.stringify({ version: CURRENT_VERSIONS[id] + 1, data: {} }));
      expect(getStorageValue(id, driver)).toBeNull();
      expect(driver.getItem(id)).toBeNull();
    }
  });
});
