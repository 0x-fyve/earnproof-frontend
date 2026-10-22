import { QueryClient } from "@tanstack/react-query";
import { buildQueryKey } from "../key-policy";
import { purgeWalletQueries, purgeNetworkQueries, purgeAllQueries } from "../purge";

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const scopeA = {
  walletAddress: "GWALLET_A",
  network: "testnet",
  environment: "test",
  apiVersion: "v1",
};

const scopeB = {
  walletAddress: "GWALLET_B",
  network: "testnet",
  environment: "test",
  apiVersion: "v1",
};

const scopeAPublic = { ...scopeA, network: "public" };

describe("purgeWalletQueries (#326)", () => {
  it("removes only the queries scoped to the given wallet, leaving other wallets' cache intact", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(buildQueryKey("api-keys", scopeA), ["key-a"]);
    queryClient.setQueryData(buildQueryKey("api-keys", scopeB), ["key-b"]);

    purgeWalletQueries(queryClient, scopeA.walletAddress);

    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeA))).toBeUndefined();
    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeB))).toEqual(["key-b"]);
  });

  it("removes every entity type scoped to that wallet, not just one", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(buildQueryKey("api-keys", scopeA), ["key-a"]);
    queryClient.setQueryData(buildQueryKey("proofs", scopeA), ["proof-a"]);

    purgeWalletQueries(queryClient, scopeA.walletAddress);

    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeA))).toBeUndefined();
    expect(queryClient.getQueryData(buildQueryKey("proofs", scopeA))).toBeUndefined();
  });
});

describe("purgeNetworkQueries (#326)", () => {
  it("removes only the queries scoped to the given network for the same wallet", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(buildQueryKey("api-keys", scopeA), ["testnet-keys"]);
    queryClient.setQueryData(buildQueryKey("api-keys", scopeAPublic), ["public-keys"]);

    purgeNetworkQueries(queryClient, "testnet");

    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeA))).toBeUndefined();
    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeAPublic))).toEqual([
      "public-keys",
    ]);
  });
});

describe("purgeAllQueries (#326)", () => {
  it("clears every cached query regardless of scope", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(buildQueryKey("api-keys", scopeA), ["key-a"]);
    queryClient.setQueryData(buildQueryKey("api-keys", scopeB), ["key-b"]);

    purgeAllQueries(queryClient);

    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeA))).toBeUndefined();
    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeB))).toBeUndefined();
  });
});
