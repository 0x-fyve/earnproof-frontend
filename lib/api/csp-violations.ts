/**
 * CSP violation diagnostics: aggregated, sample-free counts of blocked
 * resources for authorized operators.
 * =================================================================
 *
 * Endpoint: `GET /csp-violations` under the versioned API base (v1), scoped
 * server-side to the caller's organization by the bearer token (same model as
 * the audit log). Contract: `lib/api/openapi/earnproof-api.v1.json`
 * (`CspViolationReport`, `CspViolationGroup`). Operator guide:
 * `docs/csp-violation-diagnostics.md`.
 *
 * Privacy contract (issue #296), enforced here and not left to the server:
 * - A group carries only: directive, route category, release, a coarse blocked
 *   source kind, a count and first/last-seen times. Every string is either an
 *   enum member or a short identifier that cannot hold a URL.
 * - The client never receives or keeps blocked URIs, document URLs, source
 *   files, script samples, DOM snippets, referrers, tokens or anything a user
 *   typed. If a group arrives with any of those fields it is withheld whole
 *   (fail closed) and counted, instead of being cleaned up and shown.
 * - Fields outside the contract are dropped at parse time.
 * - Remediation links are chosen by this client from a fixed table, never
 *   taken from the response.
 */

import { appConfig } from "@/config/app";
import { apiClient, bearer, retryRead } from "@/lib/api/client";
import { MAX_CURSOR_LENGTH, isValidOpaqueCursor } from "@/lib/api/opaque-cursor";
import { ApiError } from "@/lib/errors";
import { generateCorrelationId } from "@/lib/telemetry/correlation";

/** Directives the app's own policy sets (see `config/security-headers.ts`). */
export const CSP_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "worker-src",
  "manifest-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-src",
  "frame-ancestors",
  "child-src",
] as const;
export type CspDirective = (typeof CSP_DIRECTIVES)[number];

/** Coarse route buckets. Never a path, so no id or wallet address can appear. */
export const CSP_ROUTE_CATEGORIES = [
  "public",
  "verify",
  "embed",
  "proofs",
  "settings",
  "issuers",
  "developers",
  "other",
] as const;
export type CspRouteCategory = (typeof CSP_ROUTE_CATEGORIES)[number];

/** What kind of source was blocked, without saying which one. */
export const CSP_BLOCKED_KINDS = [
  "inline",
  "eval",
  "data",
  "blob",
  "same-origin",
  "third-party",
  "unknown",
] as const;
export type CspBlockedKind = (typeof CSP_BLOCKED_KINDS)[number];

export const CSP_WINDOWS = ["1h", "24h", "7d"] as const;
export type CspWindow = (typeof CSP_WINDOWS)[number];
export const CSP_DEFAULT_WINDOW: CspWindow = "24h";

export const CSP_MIN_PAGE_SIZE = 1;
export const CSP_MAX_PAGE_SIZE = 200;
export const CSP_DEFAULT_PAGE_SIZE = 50;
export const CSP_MAX_RELEASES = 50;

/** A report older than this is shown as stale. Exactly this age is still fresh. */
export const CSP_STALE_AFTER_MS = 15 * 60 * 1000;

/** Roles that may open the view. The server remains the authority. */
export const CSP_VIEWER_ROLES = ["ADMIN", "ISSUER"] as const;

export type CspViolationGroup = {
  id: string;
  directive: CspDirective;
  routeCategory: CspRouteCategory;
  release: string;
  /** First release this directive, route category and blocked kind was ever seen in. */
  firstSeenRelease: string;
  blockedKind: CspBlockedKind;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type CspViolationFilter = {
  directive?: CspDirective;
  routeCategory?: CspRouteCategory;
  release?: string;
};

export type CspViolationReport = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  /** The release currently deployed. Used to flag regressions. */
  currentRelease: string;
  /** Releases that appear in the window, for the filter control. */
  releases: string[];
  groups: CspViolationGroup[];
  nextCursor: string | null;
};

export type FetchedCspViolationReport = CspViolationReport & {
  requestId: string;
  /** Groups withheld because they carried fields outside the diagnostics contract. */
  withheldCount: number;
  /** Groups dropped because they were malformed. */
  invalidCount: number;
};

export type CspErrorKind =
  | "invalid-request"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "invalid-response"
  | "failed";

export class CspRequestError extends Error {
  readonly kind: CspErrorKind;
  readonly requestId: string;

  constructor(kind: CspErrorKind, requestId: string, message: string) {
    super(message);
    this.name = "CspRequestError";
    this.kind = kind;
    this.requestId = requestId;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Keys that would carry the very data this view must never hold. Their mere
 * presence on a group withholds it. Compared after lowercasing and removing
 * `-` and `_`, so `blocked-uri`, `blockedURI` and `blocked_uri` all match.
 */
const FORBIDDEN_KEYS = new Set([
  "blockeduri",
  "blockedurl",
  "documenturi",
  "documenturl",
  "documentpath",
  "sourcefile",
  "sample",
  "scriptsample",
  "linenumber",
  "columnnumber",
  "referrer",
  "originalpolicy",
  "violatedirective",
  "url",
  "uri",
  "href",
  "path",
  "pathname",
  "query",
  "snippet",
  "dom",
  "domsnippet",
  "html",
  "text",
  "value",
  "input",
  "token",
  "authorization",
  "cookie",
  "useragent",
  "ip",
  "ipaddress",
  "wallet",
  "walletaddress",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "");
}

const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Release ids are short build labels (semver, date, short git sha). Anything
 * shaped like a JWT or a prefixed key is refused even though it matches the
 * character set.
 */
export function isSafeReleaseId(value: unknown): value is string {
  if (typeof value !== "string" || !RELEASE_PATTERN.test(value)) return false;
  if (/^eyJ/.test(value)) return false;
  if (/^(sk|pk|key|tok|token|bearer|secret)[_.-]/i.test(value)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.find((entry) => entry === value) ?? null;
}

type GroupParse =
  | { status: "ok"; group: CspViolationGroup }
  | { status: "withheld" }
  | { status: "invalid" };

export function parseCspViolationGroup(raw: unknown): GroupParse {
  if (!isRecord(raw)) return { status: "invalid" };

  if (Object.keys(raw).some((key) => FORBIDDEN_KEYS.has(normalizeKey(key)))) {
    return { status: "withheld" };
  }

  const id = typeof raw.id === "string" && ID_PATTERN.test(raw.id) ? raw.id : null;
  const directive = oneOf(CSP_DIRECTIVES, raw.directive);
  const routeCategory = oneOf(CSP_ROUTE_CATEGORIES, raw.routeCategory);
  const blockedKind = oneOf(CSP_BLOCKED_KINDS, raw.blockedKind);
  const release = isSafeReleaseId(raw.release) ? raw.release : null;
  const firstSeenRelease = isSafeReleaseId(raw.firstSeenRelease) ? raw.firstSeenRelease : null;
  const firstSeenAt = validTimestamp(raw.firstSeenAt);
  const lastSeenAt = validTimestamp(raw.lastSeenAt);
  const count = raw.count;

  if (
    !id ||
    !directive ||
    !routeCategory ||
    !blockedKind ||
    !release ||
    !firstSeenRelease ||
    !firstSeenAt ||
    !lastSeenAt ||
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    Date.parse(firstSeenAt) > Date.parse(lastSeenAt)
  ) {
    return { status: "invalid" };
  }

  return {
    status: "ok",
    group: { id, directive, routeCategory, release, firstSeenRelease, blockedKind, count, firstSeenAt, lastSeenAt },
  };
}

export function parseCspViolationReport(
  raw: unknown,
  requestId: string,
  requestCursor: string | null = null,
): FetchedCspViolationReport {
  const malformed = () => new CspRequestError("invalid-response", requestId, "CSP diagnostics response was malformed.");

  if (!isRecord(raw) || !Array.isArray(raw.groups)) throw malformed();

  const generatedAt = validTimestamp(raw.generatedAt);
  const windowStart = validTimestamp(raw.windowStart);
  const windowEnd = validTimestamp(raw.windowEnd);
  if (!generatedAt || !windowStart || !windowEnd || Date.parse(windowStart) > Date.parse(windowEnd)) {
    throw malformed();
  }
  if (!isSafeReleaseId(raw.currentRelease)) throw malformed();

  if (!Array.isArray(raw.releases) || raw.releases.length > CSP_MAX_RELEASES) throw malformed();
  const releases: string[] = [];
  for (const entry of raw.releases) {
    if (!isSafeReleaseId(entry)) throw malformed();
    if (!releases.includes(entry)) releases.push(entry);
  }

  let nextCursor: string | null;
  if (raw.nextCursor === null || raw.nextCursor === undefined) {
    nextCursor = null;
  } else if (isValidOpaqueCursor(raw.nextCursor)) {
    // A server that returns the cursor it was given would loop forever.
    nextCursor = raw.nextCursor === requestCursor ? null : raw.nextCursor;
  } else {
    throw malformed();
  }

  const seen = new Set<string>();
  const groups: CspViolationGroup[] = [];
  let withheldCount = 0;
  let invalidCount = 0;
  for (const entry of raw.groups) {
    const parsed = parseCspViolationGroup(entry);
    if (parsed.status === "withheld") {
      withheldCount += 1;
    } else if (parsed.status === "invalid") {
      invalidCount += 1;
    } else if (!seen.has(parsed.group.id)) {
      seen.add(parsed.group.id);
      groups.push(parsed.group);
    }
  }

  return {
    generatedAt,
    windowStart,
    windowEnd,
    currentRelease: raw.currentRelease,
    releases,
    groups,
    nextCursor,
    requestId,
    withheldCount,
    invalidCount,
  };
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/** True when this group first appeared in the release that is live now. */
export function isRegression(group: CspViolationGroup, currentRelease: string): boolean {
  return group.release === currentRelease && group.firstSeenRelease === currentRelease;
}

/**
 * Stale when the report is strictly older than `CSP_STALE_AFTER_MS`.
 * A report dated in the future (clock skew) counts as fresh.
 */
export function isReportStale(generatedAt: string, now: number = Date.now()): boolean {
  return now - Date.parse(generatedAt) > CSP_STALE_AFTER_MS;
}

export function canViewCspDiagnostics(role: string | null | undefined): boolean {
  return CSP_VIEWER_ROLES.some((allowed) => allowed === role);
}

export function summarizeCspViolations(groups: CspViolationGroup[], currentRelease: string) {
  return {
    totalCount: groups.reduce((sum, group) => sum + group.count, 0),
    groupCount: groups.length,
    regressionCount: groups.filter((group) => isRegression(group, currentRelease)).length,
  };
}

// ---------------------------------------------------------------------------
// Remediation (client-owned, never from the response)
// ---------------------------------------------------------------------------

export type CspRemediationLink = { label: string; href: string; external: boolean };
export type CspRemediation = { title: string; steps: string[]; links: CspRemediationLink[] };

const KIND_STEPS: Record<CspBlockedKind, string> = {
  inline: "Move the inline code or style into a file served from this origin, or give it a nonce or hash in the policy.",
  eval: "Remove eval and new Function from the code path. Do not add unsafe-eval to the policy.",
  data: "Serve the data: resource as a file, or confirm the directive really needs data: and allow only that directive.",
  blob: "Confirm the blob: use is intentional. If it is, allow blob: for this directive only.",
  "same-origin": "Check the deploy served every asset for this release. A same-origin block often means a missing or renamed file.",
  "third-party": "Find which feature loads a third-party resource. Remove it, or add the exact origin to the matching directive after review.",
  unknown: "Reproduce on the affected route category in the browser console to see which resource is blocked.",
};

export function getCspRemediation(group: Pick<CspViolationGroup, "directive" | "blockedKind" | "routeCategory">): CspRemediation {
  const helpBase = appConfig.helpUrl.replace(/\/+$/, "");
  return {
    title: `Fix ${group.directive} blocks on ${group.routeCategory} routes`,
    steps: [
      KIND_STEPS[group.blockedKind],
      "Change the policy in config/security-headers.ts only after you know which resource is blocked. Widen one directive, never default-src.",
      "Deploy, then check this view again. Counts for the new release should stop growing.",
    ],
    links: [
      { label: `Help: ${group.directive}`, href: `${helpBase}/csp/${group.directive}`, external: true },
      { label: "Security overview", href: "/security", external: false },
      { label: "System status", href: "/status", external: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type FetchCspViolationsOptions = {
  token: string;
  signal: AbortSignal;
  window?: CspWindow;
  filter?: CspViolationFilter;
  cursor?: string | null;
  limit?: number;
};

export function buildCspViolationQuery(
  options: Pick<FetchCspViolationsOptions, "window" | "filter" | "cursor" | "limit">,
  requestId = "",
): string {
  const reject = (message: string) => new CspRequestError("invalid-request", requestId, message);
  const params = new URLSearchParams();

  const window = options.window ?? CSP_DEFAULT_WINDOW;
  if (!CSP_WINDOWS.includes(window)) throw reject("Unknown time window.");
  params.set("window", window);

  const limit = options.limit ?? CSP_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < CSP_MIN_PAGE_SIZE || limit > CSP_MAX_PAGE_SIZE) {
    throw reject(`Page size must be a whole number from ${CSP_MIN_PAGE_SIZE} to ${CSP_MAX_PAGE_SIZE}.`);
  }
  params.set("limit", String(limit));

  const { directive, routeCategory, release } = options.filter ?? {};
  if (directive !== undefined) {
    if (!CSP_DIRECTIVES.includes(directive)) throw reject("Unknown directive filter.");
    params.set("directive", directive);
  }
  if (routeCategory !== undefined) {
    if (!CSP_ROUTE_CATEGORIES.includes(routeCategory)) throw reject("Unknown route category filter.");
    params.set("routeCategory", routeCategory);
  }
  if (release !== undefined) {
    if (!isSafeReleaseId(release)) throw reject("Invalid release filter.");
    params.set("release", release);
  }

  if (options.cursor !== undefined && options.cursor !== null) {
    if (!isValidOpaqueCursor(options.cursor)) throw reject("Invalid pagination cursor.");
    params.set("cursor", options.cursor);
  }

  return `?${params.toString()}`;
}

function toRequestError(error: unknown, requestId: string): CspRequestError {
  if (error instanceof CspRequestError) return error;
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return new CspRequestError("unauthorized", requestId, "Your session has ended.");
      case 403:
        return new CspRequestError("forbidden", requestId, "You do not have access to CSP diagnostics.");
      case 404:
      case 501:
        return new CspRequestError("unavailable", requestId, "CSP diagnostics are not available.");
      case 400:
      case 422:
        return new CspRequestError("invalid-request", requestId, "The CSP diagnostics request was rejected.");
      default:
        return new CspRequestError("failed", requestId, "Unable to load CSP diagnostics.");
    }
  }
  return new CspRequestError("failed", requestId, "Unable to load CSP diagnostics.");
}

/**
 * Fetches one page of aggregated CSP violation groups. Throws on any failure;
 * never returns generated data. An aborted request rethrows its AbortError.
 */
export async function fetchCspViolations(options: FetchCspViolationsOptions): Promise<FetchedCspViolationReport> {
  const requestId = generateCorrelationId();

  try {
    if (!options.token) {
      throw new CspRequestError("unauthorized", requestId, "Your session has ended.");
    }
    const query = buildCspViolationQuery(options, requestId);

    const raw = await retryRead(
      (signal) =>
        apiClient<unknown>({
          path: `/csp-violations${query}`,
          method: "GET",
          headers: { ...bearer(options.token), "X-Request-Id": requestId },
          signal,
        }),
      options.signal,
    );

    return parseCspViolationReport(raw, requestId, options.cursor ?? null);
  } catch (error) {
    if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    throw toRequestError(error, requestId);
  }
}

export { MAX_CURSOR_LENGTH as CSP_MAX_CURSOR_LENGTH };
