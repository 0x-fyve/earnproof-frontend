/**
 * Enhanced API error that carries failure classification and recovery context.
 */

import {
  type NetworkFailure,
  type NetworkFailureType,
  classifyNetworkFailure,
} from "./error-types";
import { parseRetryAfterMs } from "./retry-after";

/**
 * Extended error class for API failures.
 * Includes network failure classification and determines which actions are safe.
 */
export class ApiNetworkError extends Error {
  readonly failure: NetworkFailure;
  readonly isIdempotent: boolean;
  readonly response?: Response;

  constructor(
    originalError: unknown,
    response?: Response,
    isIdempotent = false,
  ) {
    const failure = classifyNetworkFailure(originalError, response);
    super(failure.message);

    this.name = "ApiNetworkError";
    this.failure = failure;
    this.isIdempotent = isIdempotent;
    this.response = response;

    // Maintain error chain
    if (originalError instanceof Error) {
      this.cause = originalError;
    }
  }

  get type(): NetworkFailureType {
    return this.failure.type;
  }

  get statusCode(): number | undefined {
    return this.failure.statusCode;
  }

  /**
   * The server's `Retry-After` header, parsed into milliseconds from now
   * (capped — see lib/network/retry-after.ts's `MAX_RETRY_AFTER_MS`), or
   * `null` when the response carried no such header (or none at all).
   * UI surfaces this as retry countdown metadata rather than guessing a
   * delay of its own.
   */
  get retryAfterMs(): number | null {
    // `response` is typed as `Response` but, in practice (and in this
    // file's own test suite), callers sometimes pass a plain
    // `{ status: number }` object rather than a real Fetch `Response` —
    // classifyNetworkFailure() only ever reads `.status`, so that was
    // never a problem before this getter existed. Guard defensively
    // rather than assuming `.headers` exists.
    const headers = this.response?.headers;
    if (!headers || typeof headers.get !== "function") {
      return null;
    }
    return parseRetryAfterMs(headers.get("Retry-After"));
  }

  /**
   * Determine if this error can be safely retried.
   * Considers both failure type and idempotency contract.
   */
  canRetry(): boolean {
    // Cancelled requests should never be retried
    if (this.failure.type === "cancelled") {
      return false;
    }

    // Auth failures require user action (login/re-auth)
    if (this.failure.type === "auth-failure") {
      return false;
    }

    // Validation errors won't succeed without input change
    if (this.failure.type === "validation-error") {
      return false;
    }

    // Offline and server errors are retryable in principle
    if (
      this.failure.type === "offline" ||
      this.failure.type === "server-error"
    ) {
      return true;
    }

    // Timeout is retryable only if idempotent
    if (this.failure.type === "timeout") {
      return this.isIdempotent;
    }

    // Unknown errors are not safely retryable
    return false;
  }

  /**
   * Determine if this is an offline/connectivity failure.
   */
  isConnectivityFailure(): boolean {
    return (
      this.failure.type === "offline" ||
      this.failure.type === "timeout" ||
      this.failure.type === "cancelled"
    );
  }

  /**
   * Determine if this is an auth failure (401/403).
   */
  isAuthFailure(): boolean {
    return this.failure.type === "auth-failure";
  }

  /**
   * Get user-friendly message for this failure.
   */
  getUserMessage(): string {
    return this.failure.message;
  }
}

/**
 * Type guard to check if an error is an ApiNetworkError.
 */
export function isApiNetworkError(error: unknown): error is ApiNetworkError {
  return error instanceof ApiNetworkError;
}
