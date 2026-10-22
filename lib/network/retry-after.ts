/**
 * Centralized `Retry-After` parsing and server-aware retry delay policy.
 *
 * Both `lib/api/client.ts`'s `retryRead` and `lib/network/retry-orchestrator.ts`'s
 * `executeWithRetry` compute their own exponential-backoff-with-jitter
 * delay for 429/503 responses, but neither reads the server's own
 * `Retry-After` header: a server returning 429 with `Retry-After: 120`
 * would otherwise be hammered again in well under two minutes by a client
 * computing its own short backoff. This module is the one place that
 * parses the header and turns it into a delay both retry paths use, so a
 * server-provided limit always caps (never gets overridden by) the
 * client's own backoff calculation.
 */

/**
 * Upper bound on how long a single retry wait is ever allowed to be, even
 * if the server's `Retry-After` value is larger. Protects against a
 * misconfigured or malicious upstream parking a request for hours; the
 * caller surfaces the countdown via `RetryDecision.waitMs` instead and the
 * user/caller can choose to abandon the wait.
 */
export const MAX_RETRY_AFTER_MS = 120_000; // 2 minutes

/**
 * Parses a `Retry-After` header value, which per RFC 9110 §10.2.3 is
 * either:
 *  - delta-seconds: a non-negative integer number of seconds, or
 *  - HTTP-date: an absolute timestamp (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
 *
 * Returns the delay in milliseconds from `now`, clamped to
 * `[0, MAX_RETRY_AFTER_MS]`, or `null` if the header is absent or does not
 * parse as either form.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!headerValue) {
    return null;
  }

  const trimmed = headerValue.trim();
  if (trimmed === "") {
    return null;
  }

  // delta-seconds form: digits only, no sign, no decimal point.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) {
      return null;
    }
    return clamp(seconds * 1000);
  }

  // HTTP-date form. RFC 9110 §5.6.7 mandates the IMF-fixdate format
  // ("Wed, 21 Oct 2026 07:28:00 GMT"), so require at least a weekday-name
  // comma before trying `Date.parse` — `Date.parse` is notoriously
  // permissive (e.g. `Date.parse("-5")` succeeds, parsing a bare number as
  // some date) and would otherwise accept input that is neither valid
  // delta-seconds nor a real HTTP-date as if it were the latter.
  if (!/^[A-Za-z]{3},/.test(trimmed)) {
    return null;
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return clamp(parsedDate - now);
}

function clamp(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    return 0;
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export type RetryAfterSource = Headers | Response | string | null | undefined;

function headerFrom(source: RetryAfterSource): string | null {
  if (!source) {
    return null;
  }
  if (typeof source === "string") {
    return source;
  }
  if (source instanceof Headers) {
    return source.get("Retry-After");
  }
  // Response — guarded defensively since some callers (e.g. existing test
  // fixtures, or `{ status: number }` shims used elsewhere in this
  // codebase for classification only) pass a plain object without a real
  // `.headers`.
  const headers = (source as Response).headers;
  if (!headers || typeof headers.get !== "function") {
    return null;
  }
  return headers.get("Retry-After");
}

export interface RetryDecision {
  /** Milliseconds to wait before the next attempt. */
  waitMs: number;
  /**
   * Whether `waitMs` came from the server's `Retry-After` header (true) or
   * was computed locally via exponential backoff with jitter (false).
   */
  fromServer: boolean;
}

/**
 * Computes the actual wait for the next retry attempt: the server's
 * `Retry-After` header when present and parseable (capped at
 * `MAX_RETRY_AFTER_MS`), otherwise exponential backoff with jitter.
 *
 * A server-specified `Retry-After` always wins over the client's own
 * backoff schedule — it reflects the server's own knowledge of when it
 * will be ready, which a client-side guess cannot improve on, only
 * undercut.
 */
export function resolveRetryDelay(
  source: RetryAfterSource,
  attempt: number,
  config: { baseDelayMs?: number; maxDelayMs?: number } = {},
): RetryDecision {
  const retryAfterMs = parseRetryAfterMs(headerFrom(source));
  if (retryAfterMs !== null) {
    return { waitMs: retryAfterMs, fromServer: true };
  }

  const { baseDelayMs = 500, maxDelayMs = 30_000 } = config;
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jittered = exponentialDelay * (0.5 + Math.random() * 0.5);
  return { waitMs: Math.min(jittered, maxDelayMs), fromServer: false };
}
