/**
 * Safe retry orchestration for network failures.
 *
 * Respects idempotency contracts:
 * - GET/HEAD: always retryable (safe, idempotent by nature)
 * - POST/PUT/PATCH/DELETE without idempotency: NO automatic retry
 * - POST/PUT/PATCH/DELETE with idempotency key: retryable with same key
 *
 * Never exposes one-click retry for operations that could cause duplicates.
 */

import { ApiNetworkError } from "./api-error";
import { resolveRetryDelay } from "./retry-after";

export type RetryConfig = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export interface RetryableRequest {
  /**
   * HTTP method (GET, POST, etc.)
   */
  method: string;

  /**
   * Whether this request has an idempotency contract.
   * Set to true if request includes Idempotency-Key header or similar dedup mechanism.
   */
  hasIdempotencyContract: boolean;

  /**
   * Execute the request with the given signal.
   * Should throw ApiNetworkError or related error.
   */
  execute: (signal: AbortSignal) => Promise<unknown>;
}

/**
 * Classify a mutation as safe to retry.
 * Only mutations WITH idempotency contracts or GETs/safe methods are retryable.
 */
export function isMutationSafeToRetry(request: RetryableRequest): boolean {
  const method = request.method.toUpperCase();

  // GET/HEAD are naturally idempotent
  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    return true;
  }

  // Mutations (POST/PUT/PATCH) are only retryable if they have a contract
  return request.hasIdempotencyContract;
}

/**
 * Execute a request with automatic retry for safe failures.
 *
 * Retries on:
 * - offline/timeout failures for idempotent operations
 * - server errors (5xx)
 *
 * Never retries:
 * - auth failures (caller must re-authenticate)
 * - validation errors (user must fix input)
 * - non-idempotent mutations (risk of duplicates)
 */
export async function executeWithRetry<T>(
  request: RetryableRequest,
  config: RetryConfig = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, maxDelayMs = 30_000 } = config;

  let lastError: ApiNetworkError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const signal = new AbortController().signal;

    try {
      return (await request.execute(signal)) as T;
    } catch (error) {
      // Convert to ApiNetworkError if needed
      if (!(error instanceof ApiNetworkError)) {
        throw error;
      }

      lastError = error;
      const isLastAttempt = attempt === maxAttempts - 1;

      // Check if this failure is retryable
      if (error.failure.type === "cancelled") {
        // Don't retry cancelled requests
        throw error;
      }

      if (
        error.failure.type === "auth-failure" ||
        error.failure.type === "validation-error"
      ) {
        // Don't retry auth/validation failures
        throw error;
      }

      if (!isMutationSafeToRetry(request)) {
        // Mutation without idempotency contract
        throw error;
      }

      // For offline/timeout, only retry if idempotent
      if (
        error.failure.type === "offline" ||
        error.failure.type === "timeout"
      ) {
        if (
          !request.hasIdempotencyContract &&
          request.method.toUpperCase() !== "GET"
        ) {
          // Non-idempotent mutation; don't retry
          throw error;
        }
      }

      if (isLastAttempt) {
        throw error;
      }

      // A 429/503's `Retry-After` header always caps/overrides the
      // exponential-backoff-with-jitter fallback — see
      // lib/network/retry-after.ts for why a server-provided limit must
      // win over a client-side guess.
      const { waitMs } = resolveRetryDelay(error.response, attempt, {
        baseDelayMs,
        maxDelayMs,
      });

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // This should not be reached
  throw lastError || new Error("executeWithRetry: unreachable");
}

/**
 * Determine if a failure is worth surfacing a "Retry" button to the user.
 *
 * Only safe for:
 * - Idempotent operations (GET, safe methods)
 * - Mutations with explicit idempotency contract
 *
 * Never for:
 * - Auth failures (requires re-login)
 * - Validation errors (requires new input)
 * - Non-idempotent mutations (risk of duplicates)
 */
export function shouldExposeRetry(
  request: RetryableRequest,
  error: ApiNetworkError,
): boolean {
  // Never expose retry for auth or validation failures
  if (
    error.failure.type === "auth-failure" ||
    error.failure.type === "validation-error" ||
    error.failure.type === "cancelled"
  ) {
    return false;
  }

  // Only expose retry if the operation is safe to retry
  return isMutationSafeToRetry(request);
}

/**
 * Get user-friendly recovery action for a failure.
 * Helps UI determine what action button to show.
 */
export function getRecoveryAction(error: ApiNetworkError): {
  canRetry: boolean;
  message: string;
  action?: string;
  /**
   * Milliseconds until the server says it's safe to retry (from its
   * `Retry-After` header), for a UI-level countdown. `null` when the
   * response carried no such header.
   */
  retryAfterMs?: number | null;
} {
  switch (error.failure.type) {
    case "offline":
      return {
        canRetry: true,
        message: "You're offline. Reconnect to try again.",
        action: "Retry",
      };

    case "timeout":
      return {
        canRetry: true,
        message: "Request timed out. Your network may be slow.",
        action: "Try again",
      };

    case "server-error": {
      const retryAfterMs = error.retryAfterMs;
      return {
        canRetry: true,
        message:
          retryAfterMs !== null
            ? `Server error. Please try again in ${Math.ceil(retryAfterMs / 1000)}s.`
            : "Server error. Please try again.",
        action: "Retry",
        retryAfterMs,
      };
    }

    case "rate-limited": {
      const retryAfterMs = error.retryAfterMs;
      return {
        canRetry: true,
        message:
          retryAfterMs !== null
            ? `Too many requests. Please try again in ${Math.ceil(retryAfterMs / 1000)}s.`
            : "Too many requests. Please wait before trying again.",
        action: "Retry",
        retryAfterMs,
      };
    }

    case "auth-failure":
      return {
        canRetry: false,
        message: "Your session expired. Please log in again.",
        action: "Log in",
      };

    case "validation-error":
      return {
        canRetry: false,
        message: "Invalid input. Please check and try again.",
      };

    case "cancelled":
      return {
        canRetry: false,
        message: "Request was cancelled.",
      };

    default:
      return {
        canRetry: false,
        message: "Something went wrong. Please try again.",
      };
  }
}
