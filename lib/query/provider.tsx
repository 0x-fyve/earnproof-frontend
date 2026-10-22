"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Shared QueryClient provider (#326). One instance per browser tab/session
 * (created once via useState's lazy initializer, not per render), shared by
 * every feature that opts into useQuery/useMutation. staleTime/gcTime are
 * conservative defaults appropriate for wallet-authenticated proof/API-key
 * data: not instantly stale (so navigating between two views of the same
 * data doesn't double-fetch), but never assumed fresh indefinitely either.
 *
 * `retry: false` by default at the client level - lib/api/client.ts's
 * `retryRead`/`retryMutation` already implement this app's retry and
 * backoff policy (429/503/504, exponential backoff with jitter, mutations
 * never retried); layering React Query's own retry on top would double the
 * retry count and drift from that policy's already-reviewed behavior.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
