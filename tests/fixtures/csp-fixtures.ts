/**
 * Synthetic CSP diagnostics fixtures. Releases are made-up labels and no
 * fixture contains a real URL, sample or token; the "forbidden field" builders
 * exist only to prove such data is refused.
 */

import type { FetchedCspViolationReport } from "@/lib/api/csp-violations";

export const CSP_TOKEN = "synthetic-csp-token";
export const CSP_ADMIN = {
  id: "user-csp-admin",
  walletAddress: "GSYNTHETICCSPADMIN000000000000000000000000000000000000",
  walletHash: "hash-csp-admin",
  role: "ADMIN" as const,
};
export const CSP_WORKER = { ...CSP_ADMIN, id: "user-csp-worker", role: "WORKER" as const };

export const NOW = Date.parse("2026-03-10T12:00:00.000Z");
export const GENERATED_AT = "2026-03-10T11:55:00.000Z";

export function wireGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: "grp_script_embed",
    directive: "script-src-elem",
    routeCategory: "embed",
    release: "2026.03.1",
    firstSeenRelease: "2026.03.1",
    blockedKind: "third-party",
    count: 42,
    firstSeenAt: "2026-03-10T09:00:00.000Z",
    lastSeenAt: "2026-03-10T11:50:00.000Z",
    ...overrides,
  };
}

export function wireReport(groups: unknown[] = [wireGroup()], overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: GENERATED_AT,
    windowStart: "2026-03-09T12:00:00.000Z",
    windowEnd: "2026-03-10T11:55:00.000Z",
    currentRelease: "2026.03.1",
    releases: ["2026.03.1", "2026.02.4"],
    groups,
    nextCursor: null,
    ...overrides,
  };
}

export function fetchedReport(overrides: Partial<FetchedCspViolationReport> = {}): FetchedCspViolationReport {
  return {
    generatedAt: new Date().toISOString(),
    windowStart: "2026-03-09T12:00:00.000Z",
    windowEnd: "2026-03-10T11:55:00.000Z",
    currentRelease: "2026.03.1",
    releases: ["2026.03.1", "2026.02.4"],
    groups: [wireGroup() as never],
    nextCursor: null,
    requestId: "0123456789abcdef0123456789abcdef",
    withheldCount: 0,
    invalidCount: 0,
    ...overrides,
  };
}

/** Each entry is a field the diagnostics contract forbids, with a synthetic value. */
export const FORBIDDEN_FIELDS: Record<string, unknown> = {
  blockedUri: "https://tracker.example.invalid/pixel.gif?uid=123",
  "blocked-uri": "https://tracker.example.invalid/a.js",
  documentUri: "https://app.example.invalid/proofs/abc123?wallet=GSYNTHETIC",
  sourceFile: "https://app.example.invalid/_next/static/chunk.js",
  sample: "eval('secret')",
  scriptSample: "document.cookie",
  lineNumber: 12,
  referrer: "https://example.invalid/",
  originalPolicy: "default-src 'self'",
  url: "https://example.invalid/x",
  snippet: "<input value='typed by user'>",
  token: "synthetic-token-value",
  authorization: "Bearer synthetic",
  walletAddress: "GSYNTHETICWALLET",
  userAgent: "Mozilla/5.0",
  ipAddress: "203.0.113.9",
};
