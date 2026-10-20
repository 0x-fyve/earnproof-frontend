/**
 * Request deduplication to prevent overlapping requests to the same resource.
 *
 * When a request is already in flight to a resource, subsequent identical
 * requests are coalesced and share the same promise, preventing:
 * - Duplicate API calls
 * - Race conditions from concurrent requests
 * - Out-of-order response issues
 *
 * Keyed by request method + URL to identify logical equivalence.
 */

type RequestKey = string;
type PendingRequest<T> = {
  promise: Promise<T>;
  abort: AbortController;
};

const pendingRequests = new Map<RequestKey, PendingRequest<unknown>>();

/**
 * Generate a deduplication key from method and URL.
 */
function makeKey(method: string, url: string): RequestKey {
  return `${method.toUpperCase()} ${url}`;
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
): Promise<T> {
  const key = makeKey(method, url);

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
export function isPending(method: string, url: string): boolean {
  const key = makeKey(method, url);
  return pendingRequests.has(key);
}
