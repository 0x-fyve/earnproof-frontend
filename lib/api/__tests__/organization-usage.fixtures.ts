/**
 * Synthetic test fixtures for organization capacity trends and forecasts.
 * No production data, wallet material, or private credentials included.
 * Fixtures cover positive, negative, stale, edge cases, and boundary scenarios.
 */

import type {
  CapacityTrendPoint,
  CapacityTrendData,
  CapacityForecast,
  CapacityForecastData,
  OrganizationCapacityTrends,
  OrganizationCapacityForecasts,
  UsageResource,
  RegistryType,
} from "../organization-usage";

/**
 * Generates synthetic trend points simulating capacity growth over time.
 * @param count Number of points to generate (default 7 for weekly data)
 * @param startUsed Starting usage value
 * @param endUsed Ending usage value
 * @param limit Capacity limit (null for unlimited)
 */
export function generateTrendPoints(
  count: number = 7,
  startUsed: number = 10,
  endUsed: number = 40,
  limit: number | null = 100
): CapacityTrendPoint[] {
  const points: CapacityTrendPoint[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now - (count - i - 1) * dayMs).toISOString();
    const progress = count > 1 ? i / (count - 1) : 0;
    const used = Math.round(startUsed + (endUsed - startUsed) * progress);
    const percentageUsed = limit === null ? null : Math.min(100, Math.round((used / limit) * 100));

    points.push({
      timestamp,
      used,
      limit,
      percentageUsed,
    });
  }

  return points;
}

/**
 * Generates a trend data fixture for a single resource/registry.
 */
export function trendData(overrides: Partial<CapacityTrendData> = {}): CapacityTrendData {
  const points = overrides.points ?? generateTrendPoints();
  return {
    identifier: overrides.identifier ?? "proofs",
    displayName: overrides.displayName ?? "Proofs",
    type: overrides.type ?? ("PROOFS" as UsageResource),
    limit: overrides.limit ?? 100,
    points,
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    isStale: overrides.isStale ?? false,
  };
}

/**
 * Generates organization capacity trends with multiple resources.
 */
export function organizationCapacityTrends(
  overrides: Partial<OrganizationCapacityTrends> = {}
): OrganizationCapacityTrends {
  return {
    organizationId: overrides.organizationId ?? "org-1",
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    trends: overrides.trends ?? {
      api_keys: trendData({
        identifier: "api_keys",
        displayName: "API Keys",
        type: "API_KEYS",
        limit: 10,
        points: generateTrendPoints(7, 2, 8, 10),
      }),
      webhooks: trendData({
        identifier: "webhooks",
        displayName: "Webhooks",
        type: "WEBHOOKS",
        limit: 5,
        points: generateTrendPoints(7, 1, 4, 5),
      }),
      proofs: trendData({
        identifier: "proofs",
        displayName: "Proofs",
        type: "PROOFS",
        limit: 100,
        points: generateTrendPoints(7, 30, 75, 100),
      }),
    },
  };
}

/**
 * Generates synthetic forecast points with confidence bounds.
 * @param count Number of future points to project
 * @param currentUsed Current observed usage
 * @param growthRate Daily growth rate as fraction (0.05 = 5% per day)
 * @param limit Capacity limit
 */
export function generateForecastPoints(
  count: number = 14,
  currentUsed: number = 50,
  growthRate: number = 0.05,
  limit: number | null = 100
): CapacityForecast[] {
  const points: CapacityForecast[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 1; i <= count; i++) {
    const timestamp = new Date(now + i * dayMs).toISOString();
    // Linear growth projection
    const estimatedUsed = currentUsed + i * currentUsed * growthRate;
    const estimatedPercentage = limit === null ? null : Math.min(100, Math.round((estimatedUsed / limit) * 100));

    // Confidence bounds: narrow at start, wider as projection extends
    const confidenceSpread = i * 0.02; // Widens by 2% per day
    const projectionLowerBound = Math.max(0, estimatedUsed * (1 - confidenceSpread));
    const projectionUpperBound = Math.min(limit ?? Infinity, estimatedUsed * (1 + confidenceSpread));

    // Confidence level decreases with time horizon
    const confidence: "low" | "medium" | "high" = i <= 3 ? "high" : i <= 7 ? "medium" : "low";

    // Calculate exhaustion point if applicable
    const projectedExhaustionAt =
      limit !== null && estimatedUsed >= limit
        ? new Date(now + i * dayMs).toISOString()
        : undefined;

    points.push({
      timestamp,
      estimatedUsed: Math.round(estimatedUsed),
      limit,
      estimatedPercentage,
      projectionLowerBound: Math.round(projectionLowerBound),
      projectionUpperBound: Math.round(projectionUpperBound),
      projectedExhaustionAt,
      confidence,
    });
  }

  return points;
}

/**
 * Generates forecast data for a single resource/registry.
 */
export function forecastData(overrides: Partial<CapacityForecastData> = {}): CapacityForecastData {
  const projections = overrides.projections ?? generateForecastPoints();
  return {
    identifier: overrides.identifier ?? "proofs",
    displayName: overrides.displayName ?? "Proofs",
    type: overrides.type ?? ("PROOFS" as UsageResource),
    limit: overrides.limit ?? 100,
    currentUsed: overrides.currentUsed ?? 50,
    projections,
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
  };
}

/**
 * Generates organization capacity forecasts with multiple resources.
 */
export function organizationCapacityForecasts(
  overrides: Partial<OrganizationCapacityForecasts> = {}
): OrganizationCapacityForecasts {
  return {
    organizationId: overrides.organizationId ?? "org-1",
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    forecasts: overrides.forecasts ?? {
      api_keys: forecastData({
        identifier: "api_keys",
        displayName: "API Keys",
        type: "API_KEYS",
        limit: 10,
        currentUsed: 8,
        projections: generateForecastPoints(14, 8, 0.05, 10),
      }),
      webhooks: forecastData({
        identifier: "webhooks",
        displayName: "Webhooks",
        type: "WEBHOOKS",
        limit: 5,
        currentUsed: 4,
        projections: generateForecastPoints(14, 4, 0.03, 5),
      }),
      proofs: forecastData({
        identifier: "proofs",
        displayName: "Proofs",
        type: "PROOFS",
        limit: 100,
        currentUsed: 75,
        projections: generateForecastPoints(14, 75, 0.08, 100),
      }),
    },
  };
}

/**
 * Stale trend data (5+ minutes old)
 */
export function staleTrendData(): CapacityTrendData {
  const staleGeneratedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return trendData({
    generatedAt: staleGeneratedAt,
    isStale: true,
  });
}

/**
 * Edge case: capacity near exhaustion (95%+ used)
 */
export function nearExhaustionTrendData(): CapacityTrendData {
  return trendData({
    displayName: "Proofs (Near Limit)",
    identifier: "proofs_near_limit",
    limit: 100,
    points: generateTrendPoints(7, 85, 98, 100),
  });
}

/**
 * Edge case: capacity exceeded
 */
export function exceededCapacityTrendData(): CapacityTrendData {
  const points = generateTrendPoints(7, 95, 115, 100);
  // Mark points over limit as >100%
  return trendData({
    displayName: "Proofs (Exceeded)",
    identifier: "proofs_exceeded",
    limit: 100,
    points: points.map((p) => ({
      ...p,
      percentageUsed: p.percentageUsed ? Math.min(120, p.percentageUsed + 20) : null,
    })),
  });
}

/**
 * Edge case: unlimited capacity (no limit)
 */
export function unlimitedTrendData(): CapacityTrendData {
  return trendData({
    displayName: "Synchronization (Unlimited)",
    identifier: "sync_unlimited",
    limit: null,
    points: generateTrendPoints(7, 1000, 5000, null),
  });
}

/**
 * Edge case: zero usage (fresh start)
 */
export function zeroUsageTrendData(): CapacityTrendData {
  return trendData({
    displayName: "API Keys (Fresh)",
    identifier: "api_keys_fresh",
    limit: 10,
    points: generateTrendPoints(7, 0, 0, 10),
  });
}

/**
 * Edge case: single data point (insufficient history)
 */
export function singlePointTrendData(): CapacityTrendData {
  return trendData({
    displayName: "Webhooks (Limited History)",
    identifier: "webhooks_single",
    limit: 5,
    points: generateTrendPoints(1, 2, 2, 5),
  });
}

/**
 * Forecast edge case: quick exhaustion (2-3 days)
 */
export function quickExhaustionForecast(): CapacityForecastData {
  return forecastData({
    displayName: "Proofs (Quick Exhaustion)",
    identifier: "proofs_quick_exhaustion",
    limit: 100,
    currentUsed: 80,
    projections: generateForecastPoints(14, 80, 0.15, 100), // Aggressive growth rate
  });
}

/**
 * Forecast edge case: no exhaustion in horizon
 */
export function noExhaustionForecast(): CapacityForecastData {
  return forecastData({
    displayName: "Webhooks (Stable)",
    identifier: "webhooks_stable",
    limit: 5,
    currentUsed: 2,
    projections: generateForecastPoints(14, 2, 0.01, 5), // Low growth rate
  });
}

/**
 * Forecast edge case: unlimited capacity
 */
export function unlimitedForecast(): CapacityForecastData {
  return forecastData({
    displayName: "Synchronization (Unlimited)",
    identifier: "sync_unlimited_forecast",
    limit: null,
    currentUsed: 5000,
    projections: generateForecastPoints(14, 5000, 0.1, null),
  });
}

/**
 * Forecast: high confidence (near term)
 */
export function highConfidenceForecast(): CapacityForecastData {
  const projections = generateForecastPoints(3, 50, 0.05, 100);
  return forecastData({
    displayName: "API Keys (High Confidence)",
    identifier: "api_keys_high_confidence",
    limit: 100,
    currentUsed: 50,
    projections,
  });
}

/**
 * Forecast: low confidence (distant horizon)
 */
export function lowConfidenceForecast(): CapacityForecastData {
  const projections = generateForecastPoints(30, 50, 0.02, 100);
  return forecastData({
    displayName: "Proofs (Low Confidence)",
    identifier: "proofs_low_confidence",
    limit: 100,
    currentUsed: 50,
    projections,
  });
}

/**
 * Empty trends (no data)
 */
export function emptyCapacityTrends(): OrganizationCapacityTrends {
  return {
    organizationId: "org-1",
    generatedAt: new Date().toISOString(),
    trends: {},
  };
}

/**
 * Empty forecasts (no data)
 */
export function emptyCapacityForecasts(): OrganizationCapacityForecasts {
  return {
    organizationId: "org-1",
    generatedAt: new Date().toISOString(),
    forecasts: {},
  };
}

/**
 * Mixed scenarios: some resources trending well, others near exhaustion
 */
export function mixedScenarioTrends(): OrganizationCapacityTrends {
  return organizationCapacityTrends({
    trends: {
      api_keys: trendData({
        identifier: "api_keys",
        displayName: "API Keys",
        type: "API_KEYS",
        limit: 10,
        points: generateTrendPoints(7, 2, 3, 10), // Stable, low usage
      }),
      webhooks: trendData({
        identifier: "webhooks",
        displayName: "Webhooks",
        type: "WEBHOOKS",
        limit: 5,
        points: generateTrendPoints(7, 4, 5, 5), // Near limit
      }),
      proofs: trendData({
        identifier: "proofs",
        displayName: "Proofs",
        type: "PROOFS",
        limit: 100,
        points: generateTrendPoints(7, 20, 110, 100), // Exceeded
      }),
    },
  });
}

/**
 * Mixed scenarios: diverse exhaustion windows
 */
export function mixedScenarioForecasts(): OrganizationCapacityForecasts {
  return organizationCapacityForecasts({
    forecasts: {
      api_keys: forecastData({
        identifier: "api_keys",
        displayName: "API Keys",
        type: "API_KEYS",
        limit: 10,
        currentUsed: 8,
        projections: generateForecastPoints(14, 8, 0.02, 10), // Exhaustion ~25 days
      }),
      webhooks: forecastData({
        identifier: "webhooks",
        displayName: "Webhooks",
        type: "WEBHOOKS",
        limit: 5,
        currentUsed: 4,
        projections: generateForecastPoints(14, 4, 0.12, 5), // Exhaustion ~5 days
      }),
      proofs: forecastData({
        identifier: "proofs",
        displayName: "Proofs",
        type: "PROOFS",
        limit: 100,
        currentUsed: 75,
        projections: generateForecastPoints(14, 75, 0.08, 100), // Exhaustion ~3 days
      }),
    },
  });
}
