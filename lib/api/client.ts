import type { ZodType } from "zod";
import { appConfig } from "@/config/app";
import { ApiError, ApiResponseContractError, extractSafeErrorReference } from "@/lib/errors";
import { categorizeError, reportClientError } from "@/lib/telemetry";
import { ApiNetworkError, recordNetworkFailure, recordNetworkSuccess, dedupRequest } from "@/lib/network";
import { withConcurrencyLimit, type ClientRequestPriority } from "@/lib/network/concurrency-limiter";
import { ApiResponseValidationError, validateApiResponse } from "@/lib/validation/runtime-response";
import { parseDeprecationHeaders } from "./deprecation-warnings";
import { recordDeprecationWarning } from "./use-deprecation-warning";
import { resolveRetryDelay } from "@/lib/network/retry-after";

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds

// #328: response MIME type and size contract.
//
// 5 MiB default budget — comfortably above any real EarnProof JSON payload
// (proof lists, org usage reports, etc.) while still bounding decompression-
// heavy or oversized responses. Callers with endpoint-specific needs can
// override via ApiClientOptions.
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json\b/i;

function parseContentLength(header: string | null): number | null {
  if (header === null) return null;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Read a Response body as text, aborting once more than `maxBytes` have
 * been read — even when the server lies about or omits Content-Length.
 * Reading by byte length (not decoded character length) so the budget is
 * accurate for multi-byte UTF-8 content.
 */
async function readBodyBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiResponseContractError({
          reason: "stream_size_exceeded",
          message: `API response exceeded the ${maxBytes}-byte budget while streaming (no reliable Content-Length was provided).`,
          status: response.status,
          contentLength: total,
        });
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released (e.g. after cancel()) — safe to ignore.
    }
  }

  return new TextDecoder("utf-8").decode(
    chunks.length === 1 ? chunks[0] : concatUint8Arrays(chunks, total),
  );
}

function concatUint8Arrays(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Enforce the response MIME-type and size contract before any JSON parsing
 * is attempted (#328). Error pages (HTML), oversized bodies, and
 * decompression-heavy responses are rejected here — their bodies are never
 * parsed or passed to telemetry/logging.
 *
 * @param allowEmptyBody - set for endpoints (e.g. 204 No Content, or a
 *   bodyless 2xx) where an empty success response is expected and valid.
 */
async function readJsonResponseBody<T>(
  response: Response,
  options: { maxResponseBytes: number; allowEmptyBody: boolean },
): Promise<T> {
  const contentType = response.headers.get("content-type");
  const contentLength = parseContentLength(response.headers.get("content-length"));

  // ── Content-Length preflight ─────────────────────────────────────────────
  if (contentLength !== null && contentLength > options.maxResponseBytes) {
    throw new ApiResponseContractError({
      reason: "content_length_exceeded",
      message: `API response declared Content-Length ${contentLength} bytes, exceeding the ${options.maxResponseBytes}-byte budget.`,
      status: response.status,
      contentType,
      contentLength,
    });
  }

  // An explicitly empty body (Content-Length: 0, or a 204) is only valid
  // when the caller says this endpoint allows it.
  if (contentLength === 0 || response.status === 204) {
    if (options.allowEmptyBody) {
      return undefined as T;
    }
    throw new ApiResponseContractError({
      reason: "missing_body",
      message: "API response had an empty body, but this endpoint requires one.",
      status: response.status,
      contentType,
      contentLength,
    });
  }

  // ── Content-Type contract ────────────────────────────────────────────────
  // Checked before reading the body: an HTML error page or a non-JSON
  // response must never be parsed as API data, regardless of size.
  if (contentType === null) {
    throw new ApiResponseContractError({
      reason: "missing_content_type",
      message: "API response did not declare a Content-Type header.",
      status: response.status,
      contentType,
      contentLength,
    });
  }
  if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
    throw new ApiResponseContractError({
      reason: "unexpected_content_type",
      message: `API response declared Content-Type "${contentType}", expected "application/json".`,
      status: response.status,
      contentType,
      contentLength,
    });
  }

  // ── Bounded read ──────────────────────────────────────────────────────────
  // Content-Length is advisory (it can be absent, or wrong for a chunked/
  // compressed transfer), so the read itself is also bounded.
  const text = await readBodyBounded(response, options.maxResponseBytes);

  if (text.length === 0) {
    if (options.allowEmptyBody) return undefined as T;
    throw new ApiResponseContractError({
      reason: "missing_body",
      message: "API response had an empty body, but this endpoint requires one.",
      status: response.status,
      contentType,
      contentLength,
    });
  }

  return JSON.parse(text) as T;
}

/**
 * The current route, for telemetry only. `toRoutePattern` reduces this to a
 * known static route (or "/other") and drops the query string entirely, so
 * no proof ID or wallet address can travel out through it.
 */
function currentPathname(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

type ApiClientOptions = RequestInit & {
  path: string;
  timeoutMs?: number;
  /** Override the response byte-size budget (#328). Default: 5 MiB. */
  maxResponseBytes?: number;
  /**
   * Set when this endpoint legitimately returns an empty success body
   * (e.g. 204 No Content, or a 2xx with no content) (#328). Default: false.
   */
  allowEmptyBody?: boolean;
  /**
   * Priority within the per-origin concurrency queue when the budget is
   * exhausted (#330). Only applies to GET requests — mutations are never
   * coalesced or queued behind other requests. Default: "normal". Named
   * distinctly from RequestInit's own `priority` (a browser fetch hint
   * with different values) to avoid colliding with it.
   */
  queuePriority?: ClientRequestPriority;
  /**
   * Opt out of read coalescing and concurrency limiting for this call
   * (#330). Use for a GET whose caller already guarantees it's unique, or
   * where queueing would be wrong (e.g. a user-initiated cancel-and-retry
   * that must not join a stale in-flight request). Default: false.
   */
  skipCoalescing?: boolean;
  /**
   * Optional Zod schema to validate the parsed response body against
   * before it's handed back to the caller (#327). Omitted by default so
   * existing call sites are unaffected; a caller opts in per endpoint by
   * passing one.
   */
  responseSchema?: ZodType<unknown>;
};

/**
 * Executes a fetch with:
 * - Bounded timeout (AbortController with timeout)
 * - Caller-provided signal for cancellation (navigation/unmount)
 * - Combined signal: request aborts if either times out OR caller cancels
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: callerSignal,
    ...rest
  } = options;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  let signal: AbortSignal;
  if (callerSignal) {
    signal = AbortSignal.any([callerSignal, timeoutController.signal]);
  } else {
    signal = timeoutController.signal;
  }

  try {
    const response = await fetch(url, { ...rest, signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Retry policy for READ requests only.
 * Mutations are NEVER retried automatically - see retryRead() vs retryMutation().
 *
 * Retryable: network errors, 429, 503, 504
 * Not retryable: 4xx (except 429), aborted requests, mutations
 */
export function isRetryable(error: unknown, response?: Response): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }

  if (response) {
    if (response.status === 429) return true;
    if (response.status === 503 || response.status === 504) return true;
    if (response.status >= 400 && response.status < 500) return false;
  }

  return !response && error instanceof TypeError;
}

/**
 * A retryable failure optionally carrying the `Response` that caused it,
 * so `retryRead` can read a 429/503's `Retry-After` header before deciding
 * how long to wait for the next attempt. `fn` throws this (instead of the
 * raw error) specifically when it wants `retryRead`'s `Retry-After`-aware
 * delay; any other thrown value is treated as non-retryable, same as
 * before.
 */
export class RetryableApiFailure extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly response?: Response,
  ) {
    super(cause instanceof Error ? cause.message : "Retryable API failure");
    this.name = "RetryableApiFailure";
  }
}

export async function retryRead<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(signal);
    } catch (error) {
      const isLast = attempt === maxAttempts - 1;
      const response =
        error instanceof RetryableApiFailure ? error.response : undefined;
      const underlyingError =
        error instanceof RetryableApiFailure ? error.cause : error;

      if (signal.aborted || !isRetryable(underlyingError, response)) {
        throw error instanceof RetryableApiFailure ? error.cause : error;
      }

      if (isLast) {
        throw error instanceof RetryableApiFailure ? error.cause : error;
      }

      // A 429/503's `Retry-After` header, when present, always wins over
      // the exponential-backoff-with-jitter fallback — see
      // lib/network/retry-after.ts for why.
      const { waitMs } = resolveRetryDelay(response, attempt, { baseDelayMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw new Error("retryRead: unreachable");
}

/**
 * Mutations are never retried - idempotency must be guaranteed externally.
 */
export async function retryMutation<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return fn(signal);
}

export class ApiConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    public serverEntity?: unknown,
    public userSubmittedData?: Record<string, unknown>,
    message = "A stale write conflict occurred. The resource was modified after you loaded this form.",
  ) {
    super(message);
    this.name = "ApiConflictError";
    Object.setPrototypeOf(this, ApiConflictError.prototype);
  }
}

async function apiClientImpl<TResponse>({
  path,
  headers,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  allowEmptyBody = false,
  responseSchema,
  ...init
}: ApiClientOptions): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${appConfig.apiUrl}${path}`, {
      ...init,
      timeoutMs,
      // EarnProof API responses can include wallet-authenticated proof data.
      // Keep this client out of browser, proxy, and Next.js fetch caches.
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...headers,
      },
    });
  } catch (error) {
    recordNetworkFailure();
    reportClientError({
      error,
      category: categorizeError(error),
      pathname: currentPathname(),
    });
    // Wrap in ApiNetworkError for consistent error handling across the app
    throw new ApiNetworkError(error);
  }

  if (!response.ok) {
    recordNetworkFailure();

    // #328: bound and type-check an error body exactly like a success
    // body. An HTML error page (e.g. from a proxy/load balancer) or an
    // oversized error body must never be parsed or passed to telemetry.
    let errorBody: unknown;
    try {
      errorBody = await readJsonResponseBody<unknown>(response, {
        maxResponseBytes,
        allowEmptyBody: true,
      });
    } catch {
      errorBody = {};
    }

    const errorResponse = extractSafeErrorReference(errorBody, response.status);

    // Handle 409 Conflict errors specially for stale-write detection
    if (response.status === 409) {
      const conflictData = errorBody as {
        message?: string;
        currentEntity?: unknown;
        submittedData?: unknown;
      };
      const apiConflictError = new ApiConflictError(
        conflictData.currentEntity,
        conflictData.submittedData as Record<string, unknown> | undefined,
        errorResponse.message ||
          "A stale write conflict occurred. The resource was modified after you loaded this form.",
      );
      reportClientError({
        error: apiConflictError,
        category: categorizeError(apiConflictError, response),
        pathname: currentPathname(),
      });
      throw apiConflictError;
    }

    // Throw ApiError with safe error reference
    const apiError = new ApiError(errorResponse);
    reportClientError({
      error: apiError,
      category: categorizeError(apiError, response),
      pathname: currentPathname(),
    });
    throw apiError;
  }

  recordNetworkSuccess();

  const deprecationWarning = parseDeprecationHeaders(response.headers);
  if (deprecationWarning) {
    recordDeprecationWarning(deprecationWarning);
  }

  let body: TResponse;
  try {
    body = await readJsonResponseBody<TResponse>(response, {
      maxResponseBytes,
      allowEmptyBody,
    });
  } catch (error) {
    reportClientError({
      error,
      category: categorizeError(error, response),
      pathname: currentPathname(),
    });
    throw error;
  }

  if (responseSchema) {
    try {
      return validateApiResponse(responseSchema, body) as TResponse;
    } catch (error) {
      if (error instanceof ApiResponseValidationError) {
        // Fail closed (#327): a 200 whose body doesn't match the declared
        // schema is treated as a failure, not handed to the caller as
        // trusted data. Reported like any other client error, but the
        // error object itself carries only field paths/messages - never
        // the body - so logging/telemetry can't leak response contents.
        reportClientError({
          error,
          category: categorizeError(error, response),
          pathname: currentPathname(),
        });
      }
      throw error;
    }
  }

  return body;
}

/**
 * Public API client entry point.
 *
 * GET (and HEAD) requests are coalesced with identical in-flight requests
 * (same method, URL, and auth/tenant/network/freshness headers — see
 * lib/network/request-dedup.ts) and bounded by a per-origin concurrency
 * limit (#330), so multiple mounted panels or refresh triggers requesting
 * the same resource share one network call instead of each firing their
 * own. Mutations (POST/PUT/PATCH/DELETE, and anything with
 * `skipCoalescing: true`) always run in isolation — never coalesced, never
 * queued behind other requests — because retrying or sharing a mutation's
 * result across callers would be incorrect.
 */
export async function apiClient<TResponse>(options: ApiClientOptions): Promise<TResponse> {
  const method = (options.method ?? "GET").toUpperCase();
  const isCoalescable = (method === "GET" || method === "HEAD") && !options.skipCoalescing;

  if (!isCoalescable) {
    return apiClientImpl<TResponse>(options);
  }

  const url = `${appConfig.apiUrl}${options.path}`;
  return dedupRequest<TResponse>(
    method,
    url,
    (signal) =>
      withConcurrencyLimit(
        url,
        () => apiClientImpl<TResponse>({ ...options, signal }),
        { priority: options.queuePriority, signal },
      ),
    options.signal ?? undefined,
    options.headers,
  );
}

export function bearer(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}
