/**
 * Shared opt-in / safety gate for the live API contract smoke suite (#334).
 *
 * This suite is the one place in the test tree that is allowed to make a
 * real network call to a real backend, so every spec routes through
 * `requireSmokeEnv()` before doing anything else:
 *  - It never targets production by default: `EARNPROOF_API_SMOKE_URL`
 *    must be set explicitly (there is no fallback to any hardcoded prod
 *    origin), and `EARNPROOF_API_SMOKE_ALLOW_PROD` must also be set to run
 *    against a URL that looks like a production host, so an accidental
 *    "it happened to resolve to prod" can't silently mutate real data.
 *  - It skips with a clear, human-readable reason (never fails red) when
 *    required env/credentials are absent, per the issue's "must skip with
 *    a clear reason when credentials are absent" acceptance criterion.
 *  - It never performs a mutation by default (see `read-only.spec.ts` /
 *    `mutations.spec.ts`'s own additional gates below).
 */

export interface SmokeEnv {
  apiUrl: string;
  /** Bearer token for the authenticated specs; absent for the public-only specs. */
  authToken?: string;
}

const PROD_HOST_PATTERN = /earnproof\.(com|io|app)$/i;

export type SmokeEnvResult =
  { ok: true; env: SmokeEnv } | { ok: false; skipReason: string };

/**
 * Resolves the smoke suite's target environment, or a reason to skip.
 *
 * @param opts.requireAuth - when true, also requires
 *   `EARNPROOF_API_SMOKE_TOKEN` and returns a skip reason without it.
 */
export function resolveSmokeEnv(
  opts: { requireAuth?: boolean } = {},
): SmokeEnvResult {
  const apiUrl = process.env.EARNPROOF_API_SMOKE_URL;
  if (!apiUrl) {
    return {
      ok: false,
      skipReason:
        "EARNPROOF_API_SMOKE_URL is not set — the live API contract smoke suite only runs " +
        "against an explicitly configured ephemeral/staging backend, never by default.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    return {
      ok: false,
      skipReason: `EARNPROOF_API_SMOKE_URL ("${apiUrl}") is not a valid URL.`,
    };
  }

  if (
    PROD_HOST_PATTERN.test(parsed.hostname) &&
    !process.env.EARNPROOF_API_SMOKE_ALLOW_PROD
  ) {
    return {
      ok: false,
      skipReason:
        `EARNPROOF_API_SMOKE_URL ("${apiUrl}") looks like a production host and ` +
        "EARNPROOF_API_SMOKE_ALLOW_PROD is not set — refusing to run the smoke suite " +
        "against it. This suite is for an ephemeral/staging deployment.",
    };
  }

  const authToken = process.env.EARNPROOF_API_SMOKE_TOKEN;
  if (opts.requireAuth && !authToken) {
    return {
      ok: false,
      skipReason:
        "EARNPROOF_API_SMOKE_TOKEN is not set — skipping the authenticated portion of the " +
        "live API contract smoke suite.",
    };
  }

  return { ok: true, env: { apiUrl: apiUrl.replace(/\/$/, ""), authToken } };
}

/** Matches a bearer token, a wallet signature, or anything shaped like a secret. */
const SECRET_LIKE_KEYS = /token|signature|secret|password|key|authorization/i;

/**
 * Redacts tokens, wallet signatures, and response bodies from whatever a
 * spec is about to attach to the Playwright report/trace, per the issue's
 * "must redact tokens, wallet signatures, and response bodies from
 * artifacts" acceptance criterion. Response bodies are summarized to
 * shape only (status + field names), never their values, since a real
 * backend's response can carry real proof/payment data even in a
 * read-only smoke check.
 */
export function redactForArtifact(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? "[redacted]" : value;
  }

  if (Array.isArray(value)) {
    return value.length === 0
      ? []
      : [`[redacted array, length ${value.length}]`];
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_LIKE_KEYS.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    redacted[key] =
      typeof val === "object" && val !== null
        ? "[redacted object]"
        : "[redacted]";
  }
  return redacted;
}

/** Shape-only summary of a response body: field names and value types, never values. */
export function summarizeShape(body: unknown): unknown {
  if (body === null || body === undefined) return body;
  if (Array.isArray(body)) {
    return body.length > 0 ? [summarizeShape(body[0])] : [];
  }
  if (typeof body === "object") {
    const summary: Record<string, string> = {};
    for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
      summary[key] = Array.isArray(val)
        ? "array"
        : val === null
          ? "null"
          : typeof val;
    }
    return summary;
  }
  return typeof body;
}
