/**
 * Network failure classification for offline and degraded-network recovery.
 *
 * Distinguishes between:
 * - offline: no network connectivity
 * - server-error: 5xx responses
 * - rate-limited: 429 Too Many Requests
 * - validation-error: 4xx client input errors (not 401/403/429)
 * - auth-failure: 401/403 authorization failures
 * - timeout: request exceeded time limit
 * - cancelled: request was aborted by caller
 *
 * Each failure type maps to distinct, honest messaging and recovery actions.
 */

export type NetworkFailureType =
  | "offline"
  | "server-error"
  | "rate-limited"
  | "validation-error"
  | "auth-failure"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface NetworkFailure {
  type: NetworkFailureType;
  message: string;
  statusCode?: number;
  originalError: unknown;
  retryable: boolean;
}

/**
 * Classify a network error into a distinct failure type.
 * Combines error object inspection with HTTP response status codes.
 */
export function classifyNetworkFailure(
  error: unknown,
  response?: { status: number },
): NetworkFailure {
  // Aborted requests (user navigation, timeout abort)
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      type: "cancelled",
      message: "Request was cancelled",
      originalError: error,
      retryable: false,
    };
  }

  // Explicit timeout errors
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return {
      type: "timeout",
      message: "Request timed out. Your network may be slow or offline.",
      originalError: error,
      retryable: true,
    };
  }

  // HTTP response codes
  if (response) {
    const status = response.status;

    // Auth failures
    if (status === 401 || status === 403) {
      return {
        type: "auth-failure",
        message:
          status === 401
            ? "Your session has expired. Please log in again."
            : "You don't have permission to perform this action.",
        statusCode: status,
        originalError: error,
        retryable: false, // Auth failures require user action (login)
      };
    }

    // Server errors
    if (status >= 500) {
      return {
        type: "server-error",
        message:
          status === 503
            ? "Service temporarily unavailable. The server is under maintenance."
            : status === 504
              ? "Gateway timeout. The upstream service is not responding."
              : "Server encountered an error. Please try again later.",
        statusCode: status,
        originalError: error,
        retryable: true,
      };
    }

    // Rate limiting: retryable on its own schedule (the server's own
    // Retry-After header — see lib/network/retry-after.ts — not the
    // client's guess), unlike every other 4xx below.
    if (status === 429) {
      return {
        type: "rate-limited",
        message: "Too many requests. Please wait before trying again.",
        statusCode: status,
        originalError: error,
        retryable: true,
      };
    }

    // Validation errors (4xx except 401/403/429)
    if (status >= 400) {
      return {
        type: "validation-error",
        message: "Invalid request. Please check your input and try again.",
        statusCode: status,
        originalError: error,
        retryable: false, // Validation errors won't succeed on retry without user input change
      };
    }
  }

  // Network errors (no response, TypeError indicates fetch/connectivity issue)
  if (error instanceof TypeError) {
    return {
      type: "offline",
      message:
        "Cannot reach the server. Check your internet connection and try again.",
      originalError: error,
      retryable: true,
    };
  }

  // Unknown errors
  return {
    type: "unknown",
    message: "Something went wrong. Please try again.",
    originalError: error,
    retryable: false,
  };
}

/**
 * Determine if a failure can be safely retried.
 * Consider both the failure type and idempotency contract.
 */
export function canRetry(
  failure: NetworkFailure,
  isIdempotent: boolean,
): boolean {
  // Offline, server errors, and rate limiting are retryable in principle,
  // regardless of idempotency — matching this function's existing
  // contract for offline/server-error (see error-types.test.ts). The
  // separate non-idempotent-mutation gate lives in
  // lib/network/retry-orchestrator.ts's `isMutationSafeToRetry`, which
  // callers combine with this: a 429 means "slow down", not "this
  // specific write is safe to repeat", so a non-idempotent mutation still
  // does not auto-retry just because this returns true.
  if (
    failure.type === "offline" ||
    failure.type === "server-error" ||
    failure.type === "rate-limited"
  ) {
    return true;
  }

  // Timeout is retryable only if the operation is idempotent
  if (failure.type === "timeout" && isIdempotent) {
    return true;
  }

  // Cancelled requests should not be retried automatically
  if (failure.type === "cancelled") {
    return false;
  }

  // Auth, validation, and unknown failures are not retryable
  return false;
}
