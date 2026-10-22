import type { QueryClient } from "@tanstack/react-query";
import { queryKeyBelongsToNetwork, queryKeyBelongsToWallet } from "./key-policy";

/**
 * Purges every cached query scoped to `walletAddress` (#326's "logout and
 * context switches must purge protected data"). Called from the logout
 * flow and from a wallet-switch handler - not just logout - since switching
 * wallets without clearing the cache would let the newly connected wallet's
 * UI render the previous wallet's cached API keys/proofs for a tick before
 * the next fetch resolves.
 *
 * Uses `removeQueries` (eviction), not `invalidateQueries` (refetch-on-
 * next-use while the stale data stays visible in the meantime) - leaving
 * the previous wallet's data visible even briefly is exactly the protected-
 * data exposure this guards against.
 */
export function purgeWalletQueries(queryClient: QueryClient, walletAddress: string): void {
  queryClient.removeQueries({
    predicate: (query) => queryKeyBelongsToWallet(query.queryKey, walletAddress),
  });
}

/** Purges every cached query scoped to `network` (e.g. on a testnet/public network switch for the same wallet). */
export function purgeNetworkQueries(queryClient: QueryClient, network: string): void {
  queryClient.removeQueries({
    predicate: (query) => queryKeyBelongsToNetwork(query.queryKey, network),
  });
}

/** Purges the entire cache unconditionally. Used as a last-resort fallback (e.g. an unrecoverable auth error) where scoped purging isn't enough. */
export function purgeAllQueries(queryClient: QueryClient): void {
  queryClient.clear();
}
