/**
 * Typed view of `registry.json`, the declared list of everything this app is
 * allowed to persist in the browser. The audit script reads the same JSON, so
 * a key cannot be added in code without being declared here (and the other
 * way round).
 */

import registryJson from "./registry.json";

export type StorageArea = "local" | "session";
export type StorageClassification = "preference" | "draft" | "cache" | "user-record" | "ui-state";
export type StorageScope = "browser" | "user" | "user-organization";
export type StorageFormat = "envelope" | "legacy-unversioned";

export interface StorageRegistryEntry {
  id: string;
  key: string;
  match: "exact" | "prefix";
  area: StorageArea;
  scope: StorageScope;
  classification: StorageClassification;
  format: StorageFormat;
  schemaVersion: number;
  owner: string;
  accessors: string[];
  retention: string;
  cleanup: string;
  description: string;
  viaDriver?: boolean;
  allowedFields?: { name: string; reason: string }[];
}

export interface RetiredStorageKey {
  key: string;
  reason: string;
  removedBy: string[];
  since: string;
}

export const STORAGE_REGISTRY = registryJson as unknown as {
  registryVersion: number;
  entries: StorageRegistryEntry[];
  retired: RetiredStorageKey[];
  otherMechanisms: { mechanism: string; files: string[] }[];
};

/** Find the registered entry that owns `key` (an exact key or a prefixed one). */
export function findStorageEntry(key: string): StorageRegistryEntry | null {
  for (const entry of STORAGE_REGISTRY.entries) {
    if (entry.match === "exact" ? key === entry.key : key.startsWith(entry.key)) {
      return entry;
    }
  }
  return null;
}

export function isRetiredStorageKey(key: string): boolean {
  return STORAGE_REGISTRY.retired.some((retired) => retired.key === key);
}
