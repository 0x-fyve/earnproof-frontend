import { apiClient, bearer, retryRead } from "./client";

/**
 * Organization quota and usage reporting.
 *
 * NOTE: `/organizations/{id}/usage` is not yet defined in
 * `lib/api/openapi/earnproof-api.v1.json` — the backend does not expose
 * this endpoint today. This module follows the same request/response
 * conventions as the sibling `organizations.ts` client (REST resource
 * under `/organizations/{id}`, bearer auth, `apiClient` retry helpers) so
 * it can be wired up with no shape changes once the endpoint ships.
 * Because the schema isn't in the OpenAPI spec, it is deliberately NOT
 * registered in `lib/api/client-contracts.json` (that file is checked
 * against the real spec by `npm run test:contracts`).
 *
 * All numbers rendered by the dashboard built on top of this module
 * (`components/settings/organization-usage-dashboard.tsx`) come only from
 * this authenticated server response — the UI never estimates or derives
 * usage numbers client-side.
 */

export const USAGE_RESOURCES = ["API_KEYS", "WEBHOOKS", "PROOFS", "SYNCHRONIZATION"] as const;
export type UsageResource = (typeof USAGE_RESOURCES)[number];

/**
 * Quota exhaustion (how much of an allotment has been consumed within a
 * window) is a distinct concept from request rate limiting (how fast
 * requests can be made). This type intentionally has no fields describing
 * requests-per-second/minute — see `RateLimitStatus` below for that.
 */
export type ResourceUsage = {
  resource: UsageResource;
  /** Units consumed in the current quota period. */
  used: number;
  /**
   * The configured allotment for the current window, or `null` when the
   * organization's plan has no limit for this resource (unlimited).
   */
  limit: number | null;
  /** ISO 8601 timestamp of when the current window resets. */
  windowResetAt: string;
  /** Whether the window is a fixed period or a rolling one. */
  windowType: "FIXED" | "ROLLING";
  /**
   * Deep link to the resource list this total is drawn from (e.g. the API
   * keys or webhooks settings page), so a user can go see exactly what's
   * contributing to the total.
   */
  resourceHref: string;
};

/**
 * Request rate limiting is reported separately from quota usage: a caller
 * can be well under its monthly proof quota and still be rate limited on
 * bursts, and vice versa. Conflating the two in a single "usage" number
 * would hide that distinction from the user.
 */
export type RateLimitStatus = {
  limitPerMinute: number;
  remainingInWindow: number;
  windowResetAt: string;
};

export type OrganizationUsage = {
  organizationId: string;
  generatedAt: string;
  resources: ResourceUsage[];
  rateLimit: RateLimitStatus;
};

export async function getOrganizationUsage(
  token: string,
  organizationId: string,
  signal: AbortSignal
): Promise<OrganizationUsage> {
  return retryRead(async (signal) => {
    return apiClient<OrganizationUsage>({
      path: `/organizations/${organizationId}/usage`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export type UsageLevel = "nominal" | "warning" | "exceeded" | "unlimited";

/**
 * Determines the warning level deterministically from used/limit, never
 * from color alone — callers pair this with an icon/text label (see
 * `getUsageLevelLabel`) so the distinction survives for colorblind users
 * and in text-only contexts (aria labels, exports).
 */
export function getUsageLevel(usage: Pick<ResourceUsage, "used" | "limit">): UsageLevel {
  if (usage.limit === null) {
    return "unlimited";
  }
  if (usage.limit <= 0) {
    return usage.used > 0 ? "exceeded" : "nominal";
  }
  const ratio = usage.used / usage.limit;
  if (usage.used >= usage.limit) {
    return "exceeded";
  }
  if (ratio >= 0.8) {
    return "warning";
  }
  return "nominal";
}

export function getUsageLevelLabel(level: UsageLevel): string {
  switch (level) {
    case "nominal":
      return "Within limit";
    case "warning":
      return "Near limit";
    case "exceeded":
      return "Limit exceeded";
    case "unlimited":
      return "Unlimited";
    default:
      return level;
  }
}

export function getUsageLevelTone(level: UsageLevel): "success" | "warning" | "accent" {
  switch (level) {
    case "nominal":
      return "success";
    case "warning":
    case "exceeded":
      return "warning";
    case "unlimited":
      return "accent";
    default:
      return "accent";
  }
}

export function formatUsageResource(resource: UsageResource): string {
  switch (resource) {
    case "API_KEYS":
      return "API Keys";
    case "WEBHOOKS":
      return "Webhooks";
    case "PROOFS":
      return "Proofs";
    case "SYNCHRONIZATION":
      return "Synchronization";
    default:
      return resource;
  }
}

/**
 * A percentage for progress-bar rendering, clamped to [0, 100]. Returns
 * `null` for unlimited resources since a bounded bar doesn't meaningfully
 * represent "no limit" — callers must render the unlimited state
 * explicitly instead of drawing a 0%-full bar.
 */
export function getUsagePercentage(usage: Pick<ResourceUsage, "used" | "limit">): number | null {
  if (usage.limit === null) {
    return null;
  }
  if (usage.limit <= 0) {
    return usage.used > 0 ? 100 : 0;
  }
  return Math.min(100, Math.max(0, Math.round((usage.used / usage.limit) * 100)));
}

/**
 * Registry types for capacity tracking: issuer (organizations), schema
 * (credential schemas), and proof (generated proofs/credentials).
 */
export const REGISTRY_TYPES = ["ISSUER", "SCHEMA", "PROOF"] as const;
export type RegistryType = (typeof REGISTRY_TYPES)[number];

/**
 * A single historical capacity observation for a registry or resource.
 * Timestamps are ISO 8601 for database/API consistency.
 */
export type CapacityTrendPoint = {
  timestamp: string;
  /** Units used at this observation time */
  used: number;
  /** Configured limit (null for unlimited) */
  limit: number | null;
  /** Percentage of capacity (0-100, null for unlimited) */
  percentageUsed: number | null;
  /** Registry being tracked (if applicable) */
  registryType?: RegistryType;
};

/**
 * Forecasted capacity projection with confidence bounds.
 * Estimates are clearly marked as such; no raw private data is exposed.
 */
export type CapacityForecast = {
  /** Point in time being projected */
  timestamp: string;
  /** Estimated units consumed at this timestamp */
  estimatedUsed: number;
  /** Configured limit (same as current) */
  limit: number | null;
  /** Estimated percentage of capacity (0-100, null for unlimited) */
  estimatedPercentage: number | null;
  /** Lower bound of projection (confidence interval) */
  projectionLowerBound: number;
  /** Upper bound of projection (confidence interval) */
  projectionUpperBound: number;
  /** If limit exists and trend indicates exhaustion, the ISO 8601 timestamp when limit will be reached */
  projectedExhaustionAt?: string;
  /** Confidence level: "low" (<70%), "medium" (70-85%), "high" (>85%) */
  confidence: "low" | "medium" | "high";
};

/**
 * Historical trend data for a resource or registry type.
 * Used for rendering bounded trend charts and detecting patterns.
 */
export type CapacityTrendData = {
  /** Resource or registry identifier */
  identifier: string;
  /** Human-readable name (e.g., "Proofs", "Issuer Registry") */
  displayName: string;
  /** Type of capacity being tracked */
  type: UsageResource | RegistryType;
  /** Configured limit (null for unlimited) */
  limit: number | null;
  /** Historical observations (ascending by timestamp) */
  points: CapacityTrendPoint[];
  /** When this trend data was generated/fetched */
  generatedAt: string;
  /** Indicates if data is stale (older than 5 minutes) */
  isStale: boolean;
};

/**
 * Capacity forecast data for projections and exhaustion windows.
 * Clearly marked as estimates with confidence levels.
 */
export type CapacityForecastData = {
  /** Resource or registry identifier */
  identifier: string;
  /** Human-readable name (e.g., "Proofs", "Issuer Registry") */
  displayName: string;
  /** Type of capacity being tracked */
  type: UsageResource | RegistryType;
  /** Configured limit (null for unlimited) */
  limit: number | null;
  /** Most recent observed usage (for chart baseline) */
  currentUsed: number;
  /** Forecasted points (ascending by timestamp) */
  projections: CapacityForecast[];
  /** When this forecast was generated */
  generatedAt: string;
};

/**
 * Organization capacity trends and forecasts keyed by resource/registry.
 * Trends provide historical context; forecasts project exhaustion windows.
 */
export type OrganizationCapacityTrends = {
  organizationId: string;
  /** When this snapshot was generated */
  generatedAt: string;
  /** Trends indexed by resource or registry type */
  trends: Record<string, CapacityTrendData>;
};

export type OrganizationCapacityForecasts = {
  organizationId: string;
  /** When this snapshot was generated */
  generatedAt: string;
  /** Forecasts indexed by resource or registry type */
  forecasts: Record<string, CapacityForecastData>;
};

export async function getCapacityTrends(
  token: string,
  organizationId: string,
  signal: AbortSignal
): Promise<OrganizationCapacityTrends> {
  return retryRead(async (signal) => {
    return apiClient<OrganizationCapacityTrends>({
      path: `/organizations/${organizationId}/usage/trends`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function getCapacityForecasts(
  token: string,
  organizationId: string,
  signal: AbortSignal
): Promise<OrganizationCapacityForecasts> {
  return retryRead(async (signal) => {
    return apiClient<OrganizationCapacityForecasts>({
      path: `/organizations/${organizationId}/usage/forecasts`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}
