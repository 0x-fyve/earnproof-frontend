import { appConfig } from "@/config/app";
import { ApiError, extractSafeErrorReference } from "@/lib/errors";
import { categorizeError, reportClientError } from "@/lib/telemetry";
import { ApiNetworkError, recordNetworkFailure, recordNetworkSuccess } from "@/lib/network";
import { parseDeprecationHeaders } from "./deprecation-warnings";
import { recordDeprecationWarning } from "./use-deprecation-warning";

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds

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

      if (signal.aborted || !isRetryable(error)) {
        throw error;
      }

      if (isLast) {
        throw error;
      }

      const delay =
        baseDelayMs *
        Math.pow(2, attempt) *
        (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delay));
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

/**
 * Signed cursor validation and pagination recovery.
 *
 * Cursors are opaque to the client: the client never decodes, edits, or
 * re-signs them. When the server rejects a cursor (expired, tampered with,
 * or no longer matching the active filters), the client restarts the
 * pagination from the first page while preserving the current filters.
 *
 * Recovery must never bypass tenant authorization: the restart request is sent
 * through the same authenticated client and authorization headers are
 * preserved. The client never attempts to repair or forge a cursor.
 */

export const INVALID_CURSOR_CODE = "invalid_cursor" as const;

export type InvalidCursorReason =
  | "expired"
  | "tampered"
  | "filter_mismatch"
  | "unknown";

export interface InvalidCursorDetails {
  /** Machine-readable reason category. */
  reason: InvalidCursorReason;
  /** Stable support reference that can be quoted to support. */
  supportReference: string;
  /** Human-readable message suitable for display. */
  message: string;
  /** Whether the client can safely restart from the first page. */
  recoverable: boolean;
}

/**
 * Thrown when the server rejects a cursor. The client must not inspect or
 * modify the cursor itself; it only reacts to this typed error.
 */
export class InvalidCursorError extends Error {
  readonly statusCode = 400;
  readonly code = INVALID_CURSOR_CODE;
  readonly details: InvalidCursorDetails;

  constuctor(details: InvalidCursorDetails) {
    super(details.message);
    this.name = "InvalidCursorError";
    this.details = details;
    Object.setPrototypeOf(this, InvalidCursorError.prototype);
  }
}

const INVALID_CURSOR_MESSAGES = {
  expired: "Your page position expired. Restarting from the first page.",
  tampered: "The page position could not be verified. Restarting from the first page.",
  filter_mismatch: "The page position no longer matches the current filters. Restarting from the first page.",
  unknown: "The page position is no longer valid. Restarting from the first page.",
} as const;

function normalizeInvalidCursorReason(value: unknown): InvalidCursorReason {
  if (
    value === "expired" ||
    value === "tampered" ||
    value === "filter_mismatch"
  ) {
    return value;
  }
  return "unknown";
}

/**
 * Deterministically detects an invalid-cursor response from the server.
 * The client never inspects the cursor contents itself - it only reads the
 * server-provided error code and safe reference.
 */
export function isInvalidCursorResponse(
  status: number,
  body: unknown,
): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }
  if (!body || typeof body !== "object") {
    return false;
  }
  const record = body as Record<string, unknown>;
  return record.code === INVALID_CURSOR_CODE;
}

/**
 * Builds a stable support reference from safe server fields only. Does not
 * include cursor contents, tokens, or any user identifiers.
 */
export function buildInvalidCursorDetails(
  body: unknown,
  status: number,
): InvalidCursorDetails {
  const record =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const reason = normalizeInvalidCursorReason(record.reason);
  const safeReference = extractSafeErrorReference(body, status);
  const supportReference =
    safeReference.referenceId || safeReference.requestId || `cursor-${reason}`;
  return {
    reason,
    supportReference,
    message: INVALID_CURSOR_MESSAGES[reason],
    recoverable: true,
  };
}

export interface PaginationRecoveryResult<T> {
  /** The restarted (first-page) result. */
  data: T;
  /** Details of the cursor failure that triggered recovery. */
  recovery: InvalidCursorDetails;
}

/**
 * Restarts a paginated read from the first page after an invalid-cursor
 * failure. The caller provides a function that issues the first-page
 * request with the current filters and the same authenticated client.
 *
 * Guarantees:
 * - The cursor is never forwarded or re-used.
 * - Filters are preserved by the caller-supplied restart function.
 * - Authorization headers are preserved because the same client is used.
 * - Recovery is deterministic: exactly one restart attempt.
 */
export async function recoverPagination<T>(
  error: unknown,
  restartFromFirstPage: () => Promise<T>,
): Promise<PaginationRecoveryResult<T>> {
  if (!(error instanceof InvalidCursorError)) {
    throw error;
  }
  const data = await restartFromFirstPage();
  return { data, recovery: error.details };
}

export async function apiClient<TR>({
  path,
  headers,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ...init
}: ApiClientOptions): Promise<TR> {
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
    const networkError = new ApiNetworkError(
      error instanceof Error ? error.message : "Network request failed",
      { cause: error },
    );
    reportClientError({
      category: categorizeError(networkError),
      route: currentPathname(),
    });
    throw networkError;
  }

  recordNetworkSuccess();
  parseDeprecationHeaders(response.headers);

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (isInvalidCursorResponse(response.status, body)) {
      throw new InvalidCursorError(BuildInvalidCursorDetails(body, response.status));
    }

    throw ApiError.fromResponse(response, body);
  }

  if (response.status === 204) {
    return undefined as TR;
  }

  return (await response.json()) as TR;
}
