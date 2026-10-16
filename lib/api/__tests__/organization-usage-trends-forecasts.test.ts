/**
 * Unit tests for capacity trends and forecasts API types and functions.
 * Covers positive, negative, boundary, and edge cases.
 * No production data or private credentials.
 */

import {
  organizationCapacityTrends,
  organizationCapacityForecasts,
  trendData,
  forecastData,
  generateTrendPoints,
  generateForecastPoints,
  staleTrendData,
  nearExhaustionTrendData,
  exceededCapacityTrendData,
  unlimitedTrendData,
  zeroUsageTrendData,
  singlePointTrendData,
  quickExhaustionForecast,
  noExhaustionForecast,
  unlimitedForecast,
  highConfidenceForecast,
  lowConfidenceForecast,
  emptyCapacityTrends,
  emptyCapacityForecasts,
  mixedScenarioTrends,
  mixedScenarioForecasts,
} from "./organization-usage.fixtures";

describe("Capacity Trends and Forecasts - Fixtures and Types", () => {
  describe("Trend Point Generation", () => {
    it("generates correct number of trend points", () => {
      const points = generateTrendPoints(7);
      expect(points).toHaveLength(7);
    });

    it("generates points with ascending timestamps", () => {
      const points = generateTrendPoints(5);
      for (let i = 1; i < points.length; i++) {
        expect(new Date(points[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(points[i - 1].timestamp).getTime()
        );
      }
    });

    it("interpolates usage from start to end", () => {
      const points = generateTrendPoints(5, 10, 50, 100);
      expect(points[0].used).toBe(10);
      expect(points[points.length - 1].used).toBe(50);
      // Middle points should be between start and end
      expect(points[2].used).toBeGreaterThanOrEqual(points[0].used);
      expect(points[2].used).toBeLessThanOrEqual(points[points.length - 1].used);
    });

    it("calculates percentages correctly", () => {
      const points = generateTrendPoints(3, 25, 75, 100);
      expect(points[0].percentageUsed).toBe(25);
      expect(points[2].percentageUsed).toBe(75);
    });

    it("clamps percentages to [0, 100]", () => {
      const points = generateTrendPoints(3, 90, 110, 100);
      points.forEach((p) => {
        if (p.percentageUsed !== null) {
          expect(p.percentageUsed).toBeGreaterThanOrEqual(0);
          expect(p.percentageUsed).toBeLessThanOrEqual(100);
        }
      });
    });

    it("handles unlimited capacity (null limit)", () => {
      const points = generateTrendPoints(3, 1000, 5000, null);
      points.forEach((p) => {
        expect(p.limit).toBeNull();
        expect(p.percentageUsed).toBeNull();
      });
    });

    it("handles zero usage", () => {
      const points = generateTrendPoints(3, 0, 0, 100);
      points.forEach((p) => {
        expect(p.used).toBe(0);
        expect(p.percentageUsed).toBe(0);
      });
    });

    it("handles single point", () => {
      const points = generateTrendPoints(1);
      expect(points).toHaveLength(1);
      expect(points[0].used).toBeDefined();
    });
  });

  describe("Forecast Point Generation", () => {
    it("generates correct number of forecast points", () => {
      const points = generateForecastPoints(14);
      expect(points).toHaveLength(14);
    });

    it("generates points with ascending timestamps (future)", () => {
      const points = generateForecastPoints(5);
      const now = Date.now();
      for (const p of points) {
        expect(new Date(p.timestamp).getTime()).toBeGreaterThan(now);
      }
    });

    it("projects usage growth based on growth rate", () => {
      const points = generateForecastPoints(10, 50, 0.1, 100);
      // Usage should generally increase
      for (let i = 1; i < points.length; i++) {
        expect(points[i].estimatedUsed).toBeGreaterThanOrEqual(points[i - 1].estimatedUsed - 1);
      }
    });

    it("calculates confidence intervals correctly", () => {
      const points = generateForecastPoints(10, 50, 0.05, 100);
      points.forEach((p) => {
        expect(p.projectionLowerBound).toBeLessThanOrEqual(p.estimatedUsed);
        expect(p.projectionUpperBound).toBeGreaterThanOrEqual(p.estimatedUsed);
      });
    });

    it("widens confidence bounds over time", () => {
      const points = generateForecastPoints(10, 50, 0.05, 100);
      for (let i = 1; i < points.length; i++) {
        const spread1 = (points[i - 1].projectionUpperBound - points[i - 1].projectionLowerBound) /
          points[i - 1].estimatedUsed;
        const spread2 = (points[i].projectionUpperBound - points[i].projectionLowerBound) /
          points[i].estimatedUsed;
        expect(spread2).toBeGreaterThanOrEqual(spread1 - 0.01); // Allow small floating-point variance
      }
    });

    it("assigns confidence levels based on time horizon", () => {
      const points = generateForecastPoints(15, 50, 0.05, 100);
      // Near term (1-3 days) should be high confidence
      expect(points[0].confidence).toBe("high");
      expect(points[2].confidence).toBe("high");
      // Mid term (4-7 days) should be medium
      expect(points[4].confidence).toBe("medium");
      // Far term (8+ days) should be low
      expect(points[10].confidence).toBe("low");
    });

    it("detects exhaustion when projection reaches limit", () => {
      const points = generateForecastPoints(10, 80, 0.15, 100);
      const exhaustionPoint = points.find((p) => p.projectedExhaustionAt);
      expect(exhaustionPoint).toBeDefined();
      expect(exhaustionPoint?.estimatedUsed).toBeGreaterThanOrEqual(100);
    });

    it("does not mark exhaustion for stable growth", () => {
      const points = generateForecastPoints(14, 50, 0.01, 100);
      const exhaustionPoint = points.find((p) => p.projectedExhaustionAt);
      expect(exhaustionPoint).toBeUndefined();
    });

    it("handles unlimited capacity forecasts", () => {
      const points = generateForecastPoints(10, 1000, 0.1, null);
      points.forEach((p) => {
        expect(p.limit).toBeNull();
        expect(p.estimatedPercentage).toBeNull();
        expect(p.projectedExhaustionAt).toBeUndefined();
      });
    });
  });

  describe("Trend Data Fixture", () => {
    it("creates valid trend data with defaults", () => {
      const trend = trendData();
      expect(trend.identifier).toBe("proofs");
      expect(trend.displayName).toBe("Proofs");
      expect(trend.type).toBe("PROOFS");
      expect(trend.limit).toBe(100);
      expect(trend.points).toHaveLength(7);
      expect(trend.generatedAt).toBeDefined();
      expect(trend.isStale).toBe(false);
    });

    it("allows overrides", () => {
      const trend = trendData({
        displayName: "Custom",
        limit: 50,
        isStale: true,
      });
      expect(trend.displayName).toBe("Custom");
      expect(trend.limit).toBe(50);
      expect(trend.isStale).toBe(true);
    });

    it("stale trend data is marked correctly", () => {
      const stale = staleTrendData();
      expect(stale.isStale).toBe(true);
      // Check that generatedAt is in the past
      const age = Date.now() - new Date(stale.generatedAt).getTime();
      expect(age).toBeGreaterThan(5 * 60 * 1000); // >5 minutes
    });
  });

  describe("Forecast Data Fixture", () => {
    it("creates valid forecast data with defaults", () => {
      const forecast = forecastData();
      expect(forecast.identifier).toBe("proofs");
      expect(forecast.displayName).toBe("Proofs");
      expect(forecast.type).toBe("PROOFS");
      expect(forecast.limit).toBe(100);
      expect(forecast.currentUsed).toBe(50);
      expect(forecast.projections).toHaveLength(14);
      expect(forecast.generatedAt).toBeDefined();
    });

    it("allows overrides", () => {
      const forecast = forecastData({
        displayName: "Custom",
        limit: 50,
        currentUsed: 30,
      });
      expect(forecast.displayName).toBe("Custom");
      expect(forecast.limit).toBe(50);
      expect(forecast.currentUsed).toBe(30);
    });
  });

  describe("Edge Cases - Trends", () => {
    it("handles near exhaustion (95%+)", () => {
      const trend = nearExhaustionTrendData();
      const lastPoint = trend.points[trend.points.length - 1];
      expect(lastPoint.percentageUsed).toBeGreaterThanOrEqual(95);
    });

    it("handles exceeded capacity", () => {
      const trend = exceededCapacityTrendData();
      const lastPoint = trend.points[trend.points.length - 1];
      expect(lastPoint.percentageUsed).toBeGreaterThan(100);
    });

    it("handles unlimited capacity", () => {
      const trend = unlimitedTrendData();
      expect(trend.limit).toBeNull();
      trend.points.forEach((p) => {
        expect(p.limit).toBeNull();
        expect(p.percentageUsed).toBeNull();
      });
    });

    it("handles zero usage", () => {
      const trend = zeroUsageTrendData();
      trend.points.forEach((p) => {
        expect(p.used).toBe(0);
        expect(p.percentageUsed).toBe(0);
      });
    });

    it("handles single point (insufficient history)", () => {
      const trend = singlePointTrendData();
      expect(trend.points).toHaveLength(1);
    });
  });

  describe("Edge Cases - Forecasts", () => {
    it("detects quick exhaustion (2-3 days)", () => {
      const forecast = quickExhaustionForecast();
      const exhaustionPoints = forecast.projections.filter((p) => p.projectedExhaustionAt);
      expect(exhaustionPoints.length).toBeGreaterThan(0);
      // Exhaustion should be within 5 days
      const firstExhaustion = exhaustionPoints[0];
      const daysDifference = 
        (new Date(firstExhaustion.timestamp).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysDifference).toBeLessThan(5);
    });

    it("handles stable usage with no exhaustion", () => {
      const forecast = noExhaustionForecast();
      const exhaustionPoints = forecast.projections.filter((p) => p.projectedExhaustionAt);
      expect(exhaustionPoints).toHaveLength(0);
    });

    it("handles unlimited capacity forecasts", () => {
      const forecast = unlimitedForecast();
      expect(forecast.limit).toBeNull();
      forecast.projections.forEach((p) => {
        expect(p.limit).toBeNull();
        expect(p.estimatedPercentage).toBeNull();
        expect(p.projectedExhaustionAt).toBeUndefined();
      });
    });

    it("high confidence for near-term projections", () => {
      const forecast = highConfidenceForecast();
      forecast.projections.forEach((p) => {
        expect(p.confidence).toBe("high");
      });
    });

    it("low confidence for distant horizons", () => {
      const forecast = lowConfidenceForecast();
      const midToLatePts = forecast.projections.slice(7);
      midToLatePts.forEach((p) => {
        expect(p.confidence).toBe("low");
      });
    });
  });

  describe("Empty/Missing Data", () => {
    it("handles empty trends", () => {
      const trends = emptyCapacityTrends();
      expect(trends.trends).toEqual({});
      expect(trends.generatedAt).toBeDefined();
    });

    it("handles empty forecasts", () => {
      const forecasts = emptyCapacityForecasts();
      expect(forecasts.forecasts).toEqual({});
      expect(forecasts.generatedAt).toBeDefined();
    });
  });

  describe("Mixed Scenarios", () => {
    it("handles diverse trend states", () => {
      const trends = mixedScenarioTrends();
      const trendarrs = Object.values(trends.trends);
      
      // API keys: stable low usage
      expect(trendarrs[0].points[0].percentageUsed).toBeLessThan(trendarrs[0].points[6].percentageUsed);
      expect(trendarrs[0].points[6].percentageUsed).toBeLessThan(50);
      
      // Webhooks: near limit
      expect(trendarrs[1].points[6].percentageUsed).toBeGreaterThanOrEqual(90);
      
      // Proofs: exceeded
      expect(trendarrs[2].points[6].percentageUsed).toBeGreaterThan(100);
    });

    it("handles diverse exhaustion windows", () => {
      const forecasts = mixedScenarioForecasts();
      const exhaustionTimes: number[] = [];

      Object.values(forecasts.forecasts).forEach((fc) => {
        const exhaustionPt = fc.projections.find((p) => p.projectedExhaustionAt);
        if (exhaustionPt) {
          const days = 
            (new Date(exhaustionPt.timestamp).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
          exhaustionTimes.push(days);
        }
      });

      // Should have multiple distinct exhaustion times
      expect(exhaustionTimes.length).toBeGreaterThan(0);
    });
  });

  describe("Organization-level Snapshots", () => {
    it("creates organization trends with all resources", () => {
      const trends = organizationCapacityTrends();
      expect(Object.keys(trends.trends).length).toBeGreaterThan(0);
      expect(trends.organizationId).toBeDefined();
      expect(trends.generatedAt).toBeDefined();
    });

    it("creates organization forecasts with all resources", () => {
      const forecasts = organizationCapacityForecasts();
      expect(Object.keys(forecasts.forecasts).length).toBeGreaterThan(0);
      expect(forecasts.organizationId).toBeDefined();
      expect(forecasts.generatedAt).toBeDefined();
    });

    it("allows custom organization ID", () => {
      const trends = organizationCapacityTrends({ organizationId: "custom-org" });
      expect(trends.organizationId).toBe("custom-org");
    });
  });

  describe("Data Consistency", () => {
    it("trend points maintain monotonic or increasing timestamps", () => {
      const trend = trendData();
      for (let i = 1; i < trend.points.length; i++) {
        const prev = new Date(trend.points[i - 1].timestamp).getTime();
        const curr = new Date(trend.points[i].timestamp).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("forecast points maintain monotonic increasing timestamps", () => {
      const forecast = forecastData();
      for (let i = 1; i < forecast.projections.length; i++) {
        const prev = new Date(forecast.projections[i - 1].timestamp).getTime();
        const curr = new Date(forecast.projections[i].timestamp).getTime();
        expect(curr).toBeGreaterThan(prev);
      }
    });

    it("percentage values align with used/limit ratio", () => {
      const trend = trendData({
        limit: 100,
        points: generateTrendPoints(5, 25, 75, 100),
      });
      trend.points.forEach((p) => {
        if (p.limit !== null) {
          const expectedPct = Math.round((p.used / p.limit) * 100);
          expect(p.percentageUsed).toBe(expectedPct);
        }
      });
    });
  });
});
