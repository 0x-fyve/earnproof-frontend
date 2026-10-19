import { buildOfflineBundle, OFFLINE_BUNDLE_SCHEMA_VERSION, type OfflineBundleRequest, type OfflineBundleSource } from "../offline-bundle";
import {
  buildManifest,
  canDownloadBundle,
  formatEvidenceState,
  inspectBundle,
  isBlockingEvidenceState,
  unavailableInspectionResult,
} from "../bundle-inspector";

const NOW = new Date("2026-06-01T12:00:00.000Z");

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

function freshBundle(overrides: Partial<OfflineBundleSource> = {}) {
  return buildOfflineBundle({
    request: request(),
    source: source(overrides),
    digestValue: "abc123",
    nonce: "nonce-1",
    now: NOW,
  });
}

describe("buildManifest", () => {
  it("surfaces the public manifest fields without any disclosed claim/amount payload", () => {
    const bundle = freshBundle();
    const manifest = buildManifest(bundle);
    expect(manifest).toEqual({
      bundleId: bundle.bundleId,
      schemaVersion: OFFLINE_BUNDLE_SCHEMA_VERSION,
      createdAt: bundle.createdAt,
      validUntil: bundle.validUntil,
      network: "testnet",
      contractId: bundle.contractId,
      scopes: ["public"],
      digestAlgorithm: "SHA-256",
      digestValue: "abc123",
    });
    expect(JSON.stringify(manifest)).not.toMatch(/100|USDC|GAAA|hash_1/);
  });
});

describe("inspectBundle", () => {
  it("reports verified for a fresh bundle with a matching digest and network", () => {
    const bundle = freshBundle();
    const result = inspectBundle({ bundle, actualDigest: "abc123", expectedNetwork: "testnet", now: NOW });
    expect(result.state).toBe("verified");
  });

  it("reports tampered (integrity-failed) for a digest mismatch, and this blocks download", () => {
    const bundle = freshBundle();
    const result = inspectBundle({ bundle, actualDigest: "WRONG-DIGEST", now: NOW });
    expect(result.state).toBe("tampered");
    expect(canDownloadBundle(result.state)).toBe(false);
    expect(isBlockingEvidenceState(result.state)).toBe(true);
  });

  it("reports expired for a bundle past its validUntil, and this blocks download", () => {
    const bundle = freshBundle();
    const wayLater = new Date(new Date(bundle.validUntil).getTime() + 1000);
    const result = inspectBundle({ bundle, actualDigest: "abc123", now: wayLater });
    expect(result.state).toBe("expired");
    expect(canDownloadBundle(result.state)).toBe(false);
  });

  it("reports unsupported-version for a schema version this build does not recognize, and this blocks download", () => {
    const bundle = { ...freshBundle(), schemaVersion: 999 };
    const result = inspectBundle({ bundle, actualDigest: "abc123", now: NOW });
    expect(result.state).toBe("unsupported-version");
    expect(canDownloadBundle(result.state)).toBe(false);
  });

  it("reports mismatched-network when the bundle's network differs from the expected one, and this blocks download", () => {
    const bundle = freshBundle({ network: "mainnet" });
    const result = inspectBundle({ bundle, actualDigest: "abc123", expectedNetwork: "testnet", now: NOW });
    expect(result.state).toBe("mismatched-network");
    expect(canDownloadBundle(result.state)).toBe(false);
    expect(result.message).toMatch(/mainnet/);
    expect(result.message).toMatch(/testnet/);
  });

  it("does not flag a network mismatch when no expected network is supplied", () => {
    const bundle = freshBundle({ network: "mainnet" });
    const result = inspectBundle({ bundle, actualDigest: "abc123", now: NOW });
    expect(result.state).toBe("verified");
  });

  it("reports stale for an otherwise-verified bundle older than 24 hours, but still allows download", () => {
    const bundle = freshBundle();
    const muchLater = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    // validUntil is createdAt + 24h by default request, so push validity out
    // far enough that the bundle is stale but not expired.
    const longLivedBundle = buildOfflineBundle({
      request: request({ requestedValidityHours: 72 }),
      source: source(),
      digestValue: "abc123",
      nonce: "nonce-1",
      now: NOW,
    });
    const result = inspectBundle({ bundle: longLivedBundle, actualDigest: "abc123", now: muchLater });
    expect(result.state).toBe("stale");
    expect(canDownloadBundle(result.state)).toBe(true);
    expect(isBlockingEvidenceState(result.state)).toBe(false);
    void bundle;
  });

  it("reports partially-verified for a replayed nonce, and still allows download", () => {
    const bundle = freshBundle();
    const result = inspectBundle({
      bundle,
      actualDigest: "abc123",
      now: NOW,
      seenNonces: [bundle.nonce],
    });
    expect(result.state).toBe("partially-verified");
    expect(canDownloadBundle(result.state)).toBe(true);
  });

  it("prioritizes integrity failure over a network mismatch (fail-closed precedence)", () => {
    const bundle = freshBundle({ network: "mainnet" });
    const result = inspectBundle({
      bundle,
      actualDigest: "WRONG",
      expectedNetwork: "testnet",
      now: NOW,
    });
    expect(result.state).toBe("tampered");
  });
});

describe("canDownloadBundle / isBlockingEvidenceState (the download gate - exhaustive over every state)", () => {
  const allowed: Array<Parameters<typeof canDownloadBundle>[0]> = ["verified", "stale", "partially-verified"];
  const blocked: Array<Parameters<typeof canDownloadBundle>[0]> = [
    "unavailable",
    "mismatched-network",
    "tampered",
    "expired",
    "unsupported-version",
  ];

  it.each(allowed)("allows download for %s", (state) => {
    expect(canDownloadBundle(state)).toBe(true);
    expect(isBlockingEvidenceState(state)).toBe(false);
  });

  it.each(blocked)("blocks download for %s", (state) => {
    expect(canDownloadBundle(state)).toBe(false);
    expect(isBlockingEvidenceState(state)).toBe(true);
  });
});

describe("formatEvidenceState", () => {
  it("has a human label for every evidence state", () => {
    const states: Array<Parameters<typeof formatEvidenceState>[0]> = [
      "verified",
      "unavailable",
      "stale",
      "mismatched-network",
      "partially-verified",
      "tampered",
      "expired",
      "unsupported-version",
    ];
    for (const state of states) {
      expect(formatEvidenceState(state)).toEqual(expect.any(String));
      expect(formatEvidenceState(state).length).toBeGreaterThan(0);
    }
  });
});

describe("unavailableInspectionResult", () => {
  it("defaults to a generic unavailable message", () => {
    expect(unavailableInspectionResult()).toEqual({
      state: "unavailable",
      message: "This evidence bundle could not be retrieved.",
    });
  });

  it("accepts a custom message", () => {
    expect(unavailableInspectionResult("Network error.")).toEqual({
      state: "unavailable",
      message: "Network error.",
    });
  });
});
