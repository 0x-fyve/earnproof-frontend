/**
 * React Query key policy (#326).
 *
 * The app has `@tanstack/react-query` as a dependency but, until now, no
 * QueryClient/useQuery/useMutation usage anywhere - every feature component
 * (see lib/api/keys.ts's callers, lib/api/organizations.ts's callers, etc.)
 * implements its own cache and refresh logic independently, which is how a
 * stale cross-wallet or cross-network read becomes possible: nothing forces
 * a cache entry to be scoped to the identity and network it was fetched
 * under.
 *
 * This repo has no multi-tenant SaaS concept (no "tenant" entity in
 * lib/auth or the OpenAPI spec) - the actual scoping boundaries are the
 * connected wallet address (the closest analog to a tenant: it is what
 * determines which API keys/proofs/organizations a request can see),
 * the Stellar network (testnet vs public - the same wallet address means
 * two different accounts on each), the environment, and the API version.
 * A key built without all four risks exactly the failure this issue
 * describes: switching wallets or networks and still seeing the previous
 * one's cached data.
 */

export type QueryKeyScope = {
  /** Connected wallet address. Required: every cache entry here is scoped to *a* wallet, there is no unscoped default. */
  walletAddress: string;
  /** Stellar network the wallet is connected to (e.g. "testnet", "public"). */
  network: string;
  /** Deployment environment, so a staging cache entry can never satisfy a production read or vice versa. */
  environment: string;
  /** API version, so a v2 response is never served from a v1-keyed cache entry after a version bump. */
  apiVersion: string;
};

/**
 * Builds a query key: `[entity, scope, ...rest]`. `scope` is always the
 * second element (after the entity name) and always fully populated - no
 * partial-scope keys - so two reads for the same entity never collide
 * across wallets, networks, environments, or API versions, and
 * `purgeAllQueries` (invalidating by wallet) and `purgeNetworkQueries`
 * (invalidating by network) can reliably predicate-match against a known
 * position instead of guessing where scope fields live in an ad hoc key.
 */
export function buildQueryKey(
  entity: string,
  scope: QueryKeyScope,
  ...rest: ReadonlyArray<string | number | boolean | null | undefined>
): readonly unknown[] {
  return [entity, scope, ...rest];
}

/** True when `key` was built by buildQueryKey for the given wallet address (used to purge on logout/wallet switch). */
export function queryKeyBelongsToWallet(key: readonly unknown[], walletAddress: string): boolean {
  const scope = key[1] as Partial<QueryKeyScope> | undefined;
  return scope?.walletAddress === walletAddress;
}

/** True when `key` was built by buildQueryKey for the given network (used to purge on network switch). */
export function queryKeyBelongsToNetwork(key: readonly unknown[], network: string): boolean {
  const scope = key[1] as Partial<QueryKeyScope> | undefined;
  return scope?.network === network;
}
