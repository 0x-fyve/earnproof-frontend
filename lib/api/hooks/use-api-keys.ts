"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { buildQueryKey, type QueryKeyScope } from "@/lib/query/key-policy";
import { getApiKeys, createApiKey, type CreateApiKeyRequest } from "@/lib/api/keys";
import type { ApiKey } from "@/lib/api/generated/v1";

/**
 * React Query migration of the API key list/create flow (#326). This is
 * the representative read + mutation flow called for by the issue: every
 * cache entry is partitioned by the full QueryKeyScope (wallet, network,
 * environment, API version), so switching wallets or networks can never
 * surface another identity's cached keys, and a successful create
 * explicitly invalidates the list rather than relying on an implicit
 * refetch-everything behavior.
 *
 * `api-key-management.tsx`'s existing cursor-pagination flow is left as-is
 * in this change: it already has its own tested retry/cancellation/cursor
 * logic, and rewriting it to useQuery's pagination primitives is a
 * separate, larger migration than this PR's scope. This hook is additive -
 * a second, parallel way to read/create API keys for a non-paginated
 * context (e.g. a future compact "my keys" widget) - and establishes the
 * key-partitioning pattern other reads can follow one at a time.
 */

function apiKeysQueryKey(scope: QueryKeyScope) {
  return buildQueryKey("api-keys", scope);
}

export function useApiKeysQuery(token: string, scope: QueryKeyScope) {
  return useQuery<ApiKey[]>({
    queryKey: apiKeysQueryKey(scope),
    queryFn: ({ signal }) => getApiKeys(token, signal),
    enabled: Boolean(token && scope.walletAddress),
  });
}

export function useCreateApiKeyMutation(token: string, scope: QueryKeyScope) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateApiKeyRequest) => {
      const controller = new AbortController();
      return createApiKey(token, request, controller.signal);
    },
    onSuccess: () => {
      // Explicit invalidation (#326's "mutation invalidation must be
      // explicit") - a create never silently relies on staleTime expiring
      // or a refetch-on-focus happening to fire; the list is always
      // refetched right after a successful create.
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(scope) });
    },
  });
}
