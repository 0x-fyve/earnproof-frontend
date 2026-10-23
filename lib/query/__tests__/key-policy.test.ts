import { buildQueryKey, queryKeyBelongsToWallet, queryKeyBelongsToNetwork } from "../key-policy";

describe("buildQueryKey (#326)", () => {
  const scope = {
    walletAddress: "GAAA000000000000000000000000000000000000000000000000AAAA",
    network: "testnet",
    environment: "test",
    apiVersion: "v1",
  };

  it("places the entity name first and the full scope second", () => {
    const key = buildQueryKey("api-keys", scope);
    expect(key[0]).toBe("api-keys");
    expect(key[1]).toEqual(scope);
  });

  it("appends any extra key segments after the scope", () => {
    const key = buildQueryKey("proof", scope, "proof-123", "details");
    expect(key).toEqual(["proof", scope, "proof-123", "details"]);
  });

  it("produces different keys for the same entity under different wallets", () => {
    const keyA = buildQueryKey("api-keys", scope);
    const keyB = buildQueryKey("api-keys", { ...scope, walletAddress: "GBBB" });
    expect(keyA).not.toEqual(keyB);
  });

  it("produces different keys for the same entity under different networks", () => {
    const keyA = buildQueryKey("api-keys", scope);
    const keyB = buildQueryKey("api-keys", { ...scope, network: "public" });
    expect(keyA).not.toEqual(keyB);
  });

  it("produces different keys for the same entity under different API versions", () => {
    const keyA = buildQueryKey("api-keys", scope);
    const keyB = buildQueryKey("api-keys", { ...scope, apiVersion: "v2" });
    expect(keyA).not.toEqual(keyB);
  });

  it("produces different keys for the same entity under different environments", () => {
    const keyA = buildQueryKey("api-keys", scope);
    const keyB = buildQueryKey("api-keys", { ...scope, environment: "production" });
    expect(keyA).not.toEqual(keyB);
  });
});

describe("queryKeyBelongsToWallet / queryKeyBelongsToNetwork (#326)", () => {
  const scope = {
    walletAddress: "GAAA000000000000000000000000000000000000000000000000AAAA",
    network: "testnet",
    environment: "test",
    apiVersion: "v1",
  };
  const key = buildQueryKey("api-keys", scope);

  it("matches a key built for the given wallet address", () => {
    expect(queryKeyBelongsToWallet(key, scope.walletAddress)).toBe(true);
  });

  it("does not match a key built for a different wallet address", () => {
    expect(queryKeyBelongsToWallet(key, "GOTHERWALLET")).toBe(false);
  });

  it("matches a key built for the given network", () => {
    expect(queryKeyBelongsToNetwork(key, scope.network)).toBe(true);
  });

  it("does not match a key built for a different network", () => {
    expect(queryKeyBelongsToNetwork(key, "public")).toBe(false);
  });

  it("does not throw and returns false for a malformed/unscoped key", () => {
    const malformedKey = ["api-keys"];
    expect(queryKeyBelongsToWallet(malformedKey, scope.walletAddress)).toBe(false);
    expect(queryKeyBelongsToNetwork(malformedKey, scope.network)).toBe(false);
  });
});
