import {
  checkKeyReference,
  formatKeyReferenceWarning,
  isBlockingKeyReference,
  keysOverlap,
  rotationChain,
  sortKeysForTimeline,
  type IssuerSigningKeyRecord,
} from "../key-lifecycle-timeline";

function key(overrides: Partial<IssuerSigningKeyRecord> = {}): IssuerSigningKeyRecord {
  return {
    keyId: "key-1",
    keyFingerprint: "ab12cd34",
    algorithm: "Ed25519",
    lifecycleState: "ACTIVE",
    activatedAt: "2026-01-01T00:00:00.000Z",
    retiredAt: null,
    supersedes: null,
    supersededBy: null,
    compromisedAt: null,
    ...overrides,
  };
}

describe("IssuerSigningKeyRecord shape (security contract)", () => {
  it("has no field named publicKey/privateKey/secret/keyMaterial anywhere on a record", () => {
    const record = key();
    const fields = Object.keys(record);
    for (const forbidden of ["publicKey", "privateKey", "secret", "keyMaterial", "rawKey"]) {
      expect(fields).not.toContain(forbidden);
    }
  });
});

describe("checkKeyReference", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const registry = [
    key({ keyId: "key-active", lifecycleState: "ACTIVE", activatedAt: "2026-01-01T00:00:00.000Z" }),
    key({
      keyId: "key-retired",
      lifecycleState: "RETIRED",
      activatedAt: "2025-01-01T00:00:00.000Z",
      retiredAt: "2026-01-01T00:00:00.000Z",
    }),
    key({ keyId: "key-future", lifecycleState: "ACTIVE", activatedAt: "2099-01-01T00:00:00.000Z" }),
    key({ keyId: "key-compromised", lifecycleState: "ACTIVE", compromisedAt: "2026-05-01T00:00:00.000Z" }),
  ];

  it("returns null (no warning) for a recognized, active, not-yet-retired, non-compromised key", () => {
    expect(checkKeyReference("key-active", registry, now)).toBeNull();
  });

  it("flags an unrecognized key id", () => {
    const warning = checkKeyReference("key-nonexistent", registry, now);
    expect(warning).toEqual({ kind: "unknown-key", keyId: "key-nonexistent" });
    expect(isBlockingKeyReference(warning)).toBe(true);
  });

  it("flags a retired key", () => {
    const warning = checkKeyReference("key-retired", registry, now);
    expect(warning?.kind).toBe("retired-key");
    expect(isBlockingKeyReference(warning)).toBe(false);
  });

  it("flags a not-yet-active key", () => {
    const warning = checkKeyReference("key-future", registry, now);
    expect(warning?.kind).toBe("not-yet-active");
    expect(isBlockingKeyReference(warning)).toBe(false);
  });

  it("flags a compromised key as blocking, taking precedence over its lifecycle state", () => {
    const warning = checkKeyReference("key-compromised", registry, now);
    expect(warning?.kind).toBe("compromised-key");
    expect(isBlockingKeyReference(warning)).toBe(true);
  });

  it("prioritizes compromised over not-yet-active when both apply", () => {
    const bothRegistry = [
      key({ keyId: "key-both", activatedAt: "2099-01-01T00:00:00.000Z", compromisedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const warning = checkKeyReference("key-both", bothRegistry, now);
    expect(warning?.kind).toBe("compromised-key");
  });

  it("has a non-empty human message for every warning kind, and an empty string for null", () => {
    expect(formatKeyReferenceWarning(null)).toBe("");
    expect(formatKeyReferenceWarning({ kind: "unknown-key", keyId: "x" }).length).toBeGreaterThan(0);
    expect(formatKeyReferenceWarning({ kind: "compromised-key", key: key() }).length).toBeGreaterThan(0);
    expect(formatKeyReferenceWarning({ kind: "not-yet-active", key: key() }).length).toBeGreaterThan(0);
    expect(formatKeyReferenceWarning({ kind: "retired-key", key: key() }).length).toBeGreaterThan(0);
  });
});

describe("keysOverlap (overlapping verification windows)", () => {
  it("detects an overlap when a successor activates before its predecessor retires", () => {
    const predecessor = key({ keyId: "a", activatedAt: "2026-01-01T00:00:00.000Z", retiredAt: "2026-03-01T00:00:00.000Z" });
    const successor = key({ keyId: "b", activatedAt: "2026-02-01T00:00:00.000Z", retiredAt: null });
    expect(keysOverlap(predecessor, successor)).toBe(true);
  });

  it("reports no overlap for two disjoint windows (successor starts after predecessor retires)", () => {
    const a = key({ keyId: "a", activatedAt: "2026-01-01T00:00:00.000Z", retiredAt: "2026-02-01T00:00:00.000Z" });
    const b = key({ keyId: "b", activatedAt: "2026-02-01T00:00:00.000Z", retiredAt: null });
    expect(keysOverlap(a, b)).toBe(false);
  });

  it("treats a still-active key (retiredAt null) as overlapping anything activated while it's live", () => {
    const a = key({ keyId: "a", activatedAt: "2026-01-01T00:00:00.000Z", retiredAt: null });
    const b = key({ keyId: "b", activatedAt: "2026-06-01T00:00:00.000Z", retiredAt: null });
    expect(keysOverlap(a, b)).toBe(true);
  });

  it("is symmetric", () => {
    const a = key({ keyId: "a", activatedAt: "2026-01-01T00:00:00.000Z", retiredAt: "2026-03-01T00:00:00.000Z" });
    const b = key({ keyId: "b", activatedAt: "2026-02-01T00:00:00.000Z", retiredAt: null });
    expect(keysOverlap(a, b)).toBe(keysOverlap(b, a));
  });
});

describe("sortKeysForTimeline", () => {
  it("sorts by activatedAt ascending", () => {
    const keys = [
      key({ keyId: "c", activatedAt: "2026-03-01T00:00:00.000Z" }),
      key({ keyId: "a", activatedAt: "2026-01-01T00:00:00.000Z" }),
      key({ keyId: "b", activatedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(sortKeysForTimeline(keys).map((k) => k.keyId)).toEqual(["a", "b", "c"]);
  });

  it("sorts an invalid activatedAt to the end rather than throwing", () => {
    const keys = [
      key({ keyId: "valid", activatedAt: "2026-01-01T00:00:00.000Z" }),
      key({ keyId: "invalid", activatedAt: "not-a-date" }),
    ];
    expect(() => sortKeysForTimeline(keys)).not.toThrow();
    expect(sortKeysForTimeline(keys).map((k) => k.keyId)).toEqual(["valid", "invalid"]);
  });

  it("does not mutate the input array", () => {
    const keys = [key({ keyId: "b", activatedAt: "2026-02-01T00:00:00.000Z" }), key({ keyId: "a", activatedAt: "2026-01-01T00:00:00.000Z" })];
    const original = [...keys];
    sortKeysForTimeline(keys);
    expect(keys).toEqual(original);
  });
});

describe("rotationChain", () => {
  const registry = [
    key({ keyId: "key-3", supersedes: "key-2" }),
    key({ keyId: "key-2", supersedes: "key-1" }),
    key({ keyId: "key-1", supersedes: null }),
  ];

  it("traces the full provenance chain back to the original key", () => {
    expect(rotationChain("key-3", registry).map((k) => k.keyId)).toEqual(["key-3", "key-2", "key-1"]);
  });

  it("returns a single-element chain for a key with no predecessor", () => {
    expect(rotationChain("key-1", registry).map((k) => k.keyId)).toEqual(["key-1"]);
  });

  it("returns an empty chain for an unknown key id rather than throwing", () => {
    expect(() => rotationChain("key-nonexistent", registry)).not.toThrow();
    expect(rotationChain("key-nonexistent", registry)).toEqual([]);
  });

  it("stops rather than looping forever on a cyclic supersedes reference", () => {
    const cyclic = [key({ keyId: "x", supersedes: "y" }), key({ keyId: "y", supersedes: "x" })];
    expect(() => rotationChain("x", cyclic)).not.toThrow();
    expect(rotationChain("x", cyclic).map((k) => k.keyId)).toEqual(["x", "y"]);
  });

  it("stops at a dangling supersedes reference (points at a keyId not in the registry)", () => {
    const dangling = [key({ keyId: "x", supersedes: "ghost" })];
    expect(rotationChain("x", dangling).map((k) => k.keyId)).toEqual(["x"]);
  });
});
