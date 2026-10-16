import {
  OFFLINE_BUNDLE_MAX_VALIDITY_HOURS,
  OFFLINE_BUNDLE_SCHEMA_VERSION,
  buildOfflineBundle,
  fetchMockOfflineBundleSource,
  includedFields,
  isOfflineBundleRequestValid,
  refreshOfflineBundle,
  scopedPayload,
  validateOfflineBundleRequest,
  verifyOfflineBundle,
  type OfflineBundleRequest,
  type OfflineBundleSource,
  type OfflineVerificationBundle,
} from "../offline-bundle";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function source(overrides: Partial<OfflineBundleSource> = {}): OfflineBundleSource {
  return {
    proofId: "proof-1",
    network: "testnet",
    contractId: `C${"A".repeat(55)}`,
    public: { type: "income-threshold", issuer: "issuer-1" },
    private: {
      subject: { walletHash: "hash_1" },
      amount: { thresholdAmount: "100", assetCode: "USDC" },
      sender: { sourceAddress: "GAAA" },
    },
    ...overrides,
  };
}

function request(overrides: Partial<OfflineBundleRequest> = {}): OfflineBundleRequest {
  return {
    proofId: "proof-1",
    scopes: ["public"],
    requestedValidityHours: 24,
    ...overrides,
  };
}

function bundle(overrides: Partial<OfflineVerificationBundle> = {}): OfflineVerificationBundle {
  const built = buildOfflineBundle({
    request: request(),
    source: source(),
    digestValue: "abc123",
    nonce: "nonce-1",
    now: NOW,
  });
  return { ...built, ...overrides };
}

describe("offline-bundle: request validation", () => {
  it("accepts a bounded request", () => {
    expect(validateOfflineBundleRequest(request())).toEqual([]);
    expect(isOfflineBundleRequestValid(request())).toBe(true);
  });

  it("requires a proof ID", () => {
    expect(isOfflineBundleRequestValid(request({ proofId: "  " }))).toBe(false);
  });

  it("enforces the validity bounds", () => {
    expect(isOfflineBundleRequestValid(request({ requestedValidityHours: 0 }))).toBe(false);
    expect(isOfflineBundleRequestValid(request({ requestedValidityHours: 1 }))).toBe(true);
    expect(isOfflineBundleRequestValid(request({ requestedValidityHours: 72 }))).toBe(true);
    expect(isOfflineBundleRequestValid(request({ requestedValidityHours: 73 }))).toBe(false);
    expect(OFFLINE_BUNDLE_MAX_VALIDITY_HOURS).toBe(72);
  });

  it("always requires the public scope", () => {
    expect(isOfflineBundleRequestValid(request({ scopes: ["amount"] }))).toBe(false);
  });
});

describe("offline-bundle: scoped disclosure", () => {
  it("includes only the requested private scopes", () => {
    const payload = scopedPayload(source(), ["public", "amount"]);
    expect(payload.public).toBeDefined();
    expect(payload.amount).toEqual({ thresholdAmount: "100", assetCode: "USDC" });
    expect(payload.subject).toBeUndefined();
    expect(payload.sender).toBeUndefined();
  });

  it("never includes a private scope that was not requested", () => {
    const payload = scopedPayload(source(), ["public"]);
    expect(Object.keys(payload)).toEqual(["public"]);
  });

  it("omits a requested scope the source does not carry", () => {
    const payload = scopedPayload(source({ private: undefined }), ["public", "sender"]);
    expect(Object.keys(payload)).toEqual(["public"]);
  });
});

describe("offline-bundle: build", () => {
  it("time-bounds the bundle from the requested validity", () => {
    const built = buildOfflineBundle({
      request: request({ requestedValidityHours: 24 }),
      source: source(),
      digestValue: "abc123",
      nonce: "nonce-1",
      now: NOW,
    });
    expect(built.validUntil).toBe("2026-06-02T00:00:00.000Z");
    expect(built.createdAt).toBe(NOW.toISOString());
    expect(built.schemaVersion).toBe(OFFLINE_BUNDLE_SCHEMA_VERSION);
  });

  it("records that revocation was not checked offline", () => {
    const built = bundle();
    expect(built.revocation.state).toBe("unknown-offline");
  });

  it("lists the included fields from the payload", () => {
    const built = buildOfflineBundle({
      request: request({ scopes: ["public", "subject"] }),
      source: source(),
      digestValue: "abc123",
      nonce: "nonce-1",
      now: NOW,
    });
    const fields = includedFields(built);
    expect(fields).toContain("public.type");
    expect(fields).toContain("subject.walletHash");
    expect(fields).not.toContain("amount.thresholdAmount");
  });
});

describe("offline-bundle: offline verification", () => {
  it("verifies a fresh, intact bundle without claiming revocation", () => {
    const result = verifyOfflineBundle({
      bundle: bundle(),
      actualDigest: "abc123",
      now: NOW,
    });
    expect(result.status).toBe("verified-offline");
    expect(result.fresh).toBe(true);
    expect(result.revocation).toBe("not-checked-offline");
  });

  it("fails closed on a digest mismatch", () => {
    const result = verifyOfflineBundle({
      bundle: bundle(),
      actualDigest: "tampered",
      now: NOW,
    });
    expect(result.status).toBe("integrity-failed");
  });

  it("rejects an expired bundle", () => {
    const result = verifyOfflineBundle({
      bundle: bundle(),
      actualDigest: "abc123",
      now: new Date("2026-06-02T00:00:01.000Z"),
    });
    expect(result.status).toBe("expired");
    expect(result.fresh).toBe(false);
  });

  it("treats the exact expiry boundary as still valid, and one ms later as expired", () => {
    expect(
      verifyOfflineBundle({
        bundle: bundle(),
        actualDigest: "abc123",
        now: new Date("2026-06-02T00:00:00.000Z"),
      }).status,
    ).toBe("verified-offline");
    expect(
      verifyOfflineBundle({
        bundle: bundle(),
        actualDigest: "abc123",
        now: new Date("2026-06-02T00:00:00.001Z"),
      }).status,
    ).toBe("expired");
  });

  it("detects a replay within a session", () => {
    const result = verifyOfflineBundle({
      bundle: bundle(),
      actualDigest: "abc123",
      now: NOW,
      seenNonces: ["nonce-1"],
    });
    expect(result.status).toBe("replayed");
  });

  it("rejects an unsupported schema version", () => {
    const result = verifyOfflineBundle({
      bundle: bundle({ schemaVersion: 999 }),
      actualDigest: "abc123",
      now: NOW,
    });
    expect(result.status).toBe("unsupported-schema");
  });

  it("checks integrity before expiry", () => {
    const result = verifyOfflineBundle({
      bundle: bundle(),
      actualDigest: "tampered",
      now: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(result.status).toBe("integrity-failed");
  });
});

describe("offline-bundle: freshness refresh", () => {
  it("reports offline with an unknown revocation state when it cannot reach the network", () => {
    const result = refreshOfflineBundle({ bundle: bundle(), isOnline: false, now: NOW });
    expect(result.status).toBe("offline");
    expect(result.revocation).toBe("unknown");
  });

  it("reports a current revocation state only when online", () => {
    const refreshed = refreshOfflineBundle({ bundle: bundle(), isOnline: true, now: NOW });
    expect(refreshed.status).toBe("refreshed");
    expect(refreshed.revocation).toBe("current");

    const revoked = refreshOfflineBundle({
      bundle: bundle(),
      isOnline: true,
      revoked: true,
      now: NOW,
    });
    expect(revoked.status).toBe("revoked");
  });

  it("reports an expired bundle on an online refresh", () => {
    const result = refreshOfflineBundle({
      bundle: bundle(),
      isOnline: true,
      now: new Date("2026-06-05T00:00:00.000Z"),
    });
    expect(result.status).toBe("expired");
  });
});

describe("offline-bundle: fixture", () => {
  it("returns a synthetic demo source", async () => {
    const fixture = await fetchMockOfflineBundleSource();
    expect(fixture.proofId).toBeTruthy();
    expect(fixture.public).toBeDefined();
  });

  it("honors overrides", async () => {
    const fixture = await fetchMockOfflineBundleSource({ proofId: "proof-xyz" });
    expect(fixture.proofId).toBe("proof-xyz");
  });
});
