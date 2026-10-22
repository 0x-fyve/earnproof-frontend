/**
 * Request deduplication to prevent overlapping requests to the same resource.
 *
 * When a request is already in flight to a resource, subsequent identical
 * requests are coalesced and share the same promise, preventing:
 * - Duplicate API calls
 * - Race conditions from concurrent requests
 * - Out-of-order response issues
 *
 * Keyed by request method + URL + a discriminator (#330). The discriminator
 * must capture everything that makes two requests to the same URL
 * logically DIFFERENT responses: auth identity, tenant/org scope, network/
 * environment, any header that varies the response (e.g. Accept-Language,
 * If-None-Match), and a freshness marker. Two requests that differ on any
 * of these must never share a coalesced promise — getting this wrong would
 * let one user's cached response leak into another user's/tenant's result.
 */

type RequestKey = string;
type PendingRequest<T> = {
  promise: Promise<T>;
  abort: AbortController;
};

const pendingRequests = new Map<RequestKey, PendingRequest<unknown>>();

/**
 * Headers (case-insensitive) whose value is included in the dedup key
 * because it changes what response is semantically correct for the
 * request: who's asking (auth), what tenant/org/network scope they're
 * asking in, what representation they want, and what freshness they
 * require. Any other header (e.g. a tracing/telemetry header) does not
 * affect the response and is intentionally excluded so it can't
 * accidentally defeat coalescing.
 */
const DISCRIMINATING_HEADERS = [
  "authorization",
  "x-organization-id",
  "x-tenant-id",
  "x-network",
  "x-stellar-network",
  "accept-language",
  "if-none-match",
  "cache-control",
] as const;

export type DedupHeadersInput = HeadersInit | undefined;

function normalizeHeaders(headers: DedupHeadersInput): Headers | undefined {
  if (!headers) return undefined;
  return headers instanceof Headers ? headers : new Headers(headers);
}

/**
 * Build the discriminator segment of the dedup key from the subset of
 * request headers that affect response identity (#330). Two requests
 * with different auth, tenant, network, or freshness headers always
 * produce different discriminators and therefore never coalesce.
 */
function headerDiscriminator(headers: DedupHeadersInput): string {
  const normalized = normalizeHeaders(headers);
  if (!normalized) return "";
  const parts: string[] = [];
  for (const name of DISCRIMINATING_HEADERS) {
    const value = normalized.get(name);
    if (value !== null) parts.push(`${name}=${value}`);
  }
  return parts.join("&");
}

/**
 * Generate a deduplication key from method, URL, and discriminating headers.
 */
function makeKey(method: string, url: string, headers?: DedupHeadersInput): RequestKey {
  const discriminator = headerDiscriminator(headers);
  return discriminator
    ? `${method.toUpperCase()} ${url} :: ${discriminator}`
    : `${method.toUpperCase()} ${url}`;
}

/**
 * Execute a request, deduplicating identical concurrent requests.
 *
 * If a request with the same method+URL is already in flight, the caller
 * receives the same promise instead of making a duplicate request.
 *
 * The AbortController passed in should be merged with the caller's own signal
 * so that cancellation of the shared abort controller doesn't interfere with
 * caller-specific cancellation.
 */
export async function dedupRequest<T>(
  method: string,
  url: string,
  execute: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  headers?: DedupHeadersInput,
): Promise<T> {
  const key = makeKey(method, url, headers);

  // Check if request is already in flight
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing.promise as Promise<T>;
  }

  // Create new abort controller for this dedup group
  const dedupAbort = new AbortController();

  // Merge caller's signal with dedup signal
  let mergedSignal: AbortSignal;
  if (signal) {
    mergedSignal = AbortSignal.any([signal, dedupAbort.signal]);
  } else {
    mergedSignal = dedupAbort.signal;
  }

  // Execute request
  const promise = execute(mergedSignal)
    .then((result) => {
      pendingRequests.delete(key);
      return result;
    })
    .catch((error) => {
      pendingRequests.delete(key);
      throw error;
    });

  // Store pending request so future calls can join
  pendingRequests.set(key, {
    promise,
    abort: dedupAbort,
  });

  return promise;
}

/**
 * Cancel all pending requests matching a method/URL pattern.
 * Used for forced cache invalidation or logout.
 */
export function cancelPendingRequests(methodOrUrl?: string): void {
  if (!methodOrUrl) {
    // Cancel all pending requests
    pendingRequests.forEach(({ abort }) => abort.abort());
    pendingRequests.clear();
  } else {
    // Cancel requests matching the pattern
    const keysToDelete: RequestKey[] = [];
    pendingRequests.forEach((pending, key) => {
      if (key.includes(methodOrUrl)) {
        pending.abort.abort();
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => pendingRequests.delete(key));
  }
}

/**
 * Clear the dedup cache (usually on logout or app state reset).
 */
export function clearPendingRequests(): void {
  cancelPendingRequests();
}

/**
 * Check if a request is currently pending (for testing).
 */
export function isPending(method: string, url: string, headers?: DedupHeadersInput): boolean {
  const key = makeKey(method, url, headers);
  return pendingRequests.has(key);
}
