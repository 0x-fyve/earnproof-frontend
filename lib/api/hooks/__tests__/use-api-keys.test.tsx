/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApiKeysQuery, useCreateApiKeyMutation } from "../use-api-keys";
import { buildQueryKey } from "@/lib/query/key-policy";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  apiClient: jest.fn(),
}));

import { apiClient } from "@/lib/api/client";
const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

const scope = {
  walletAddress: "GWALLET_A",
  network: "testnet",
  environment: "test",
  apiVersion: "v1",
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe("useApiKeysQuery (#326)", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it("fetches and returns the API key list, keyed by the full scope", async () => {
    const apiKeys = [{ id: "k1", name: "Key One", prefix: "ep_1", scopes: ["proofs:read"] }];
    mockedApiClient.mockResolvedValue(apiKeys);

    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useApiKeysQuery("token", scope), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(apiKeys));
    expect(queryClient.getQueryData(buildQueryKey("api-keys", scope))).toEqual(apiKeys);
  });

  it("does not fetch when the wallet address is empty (no unscoped read)", () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useApiKeysQuery("token", { ...scope, walletAddress: "" }), {
      wrapper: Wrapper,
    });

    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it("keeps two different wallets' cached results separate", async () => {
    mockedApiClient.mockResolvedValueOnce([{ id: "a", name: "A", prefix: "ep_a", scopes: [] }]);
    mockedApiClient.mockResolvedValueOnce([{ id: "b", name: "B", prefix: "ep_b", scopes: [] }]);

    const { Wrapper, queryClient } = createWrapper();
    const scopeB = { ...scope, walletAddress: "GWALLET_B" };

    const hookA = renderHook(() => useApiKeysQuery("token", scope), { wrapper: Wrapper });
    await waitFor(() => expect(hookA.result.current.data).toBeDefined());

    const hookB = renderHook(() => useApiKeysQuery("token", scopeB), { wrapper: Wrapper });
    await waitFor(() => expect(hookB.result.current.data).toBeDefined());

    expect(queryClient.getQueryData(buildQueryKey("api-keys", scope))).toEqual([
      { id: "a", name: "A", prefix: "ep_a", scopes: [] },
    ]);
    expect(queryClient.getQueryData(buildQueryKey("api-keys", scopeB))).toEqual([
      { id: "b", name: "B", prefix: "ep_b", scopes: [] },
    ]);
  });
});

describe("useCreateApiKeyMutation (#326)", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it("invalidates the api-keys query for the same scope after a successful create", async () => {
    const createdResponse = {
      apiKey: { id: "new", name: "New Key", prefix: "ep_new", scopes: ["proofs:read"] },
      secret: "secret-value",
    };
    mockedApiClient.mockResolvedValueOnce([]); // initial list fetch
    mockedApiClient.mockResolvedValueOnce(createdResponse); // create

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const listHook = renderHook(() => useApiKeysQuery("token", scope), { wrapper: Wrapper });
    await waitFor(() => expect(listHook.result.current.data).toEqual([]));

    const mutationHook = renderHook(() => useCreateApiKeyMutation("token", scope), {
      wrapper: Wrapper,
    });

    mutationHook.result.current.mutate({ name: "New Key", scopes: ["proofs:read"] });

    await waitFor(() => expect(mutationHook.result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: buildQueryKey("api-keys", scope) });
  });
});
