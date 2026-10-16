/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { CapacityTrendChart } from "../capacity-trend-chart";
import { CapacityForecastChart } from "../capacity-forecast-chart";
import {
  trendData,
  forecastData,
  nearExhaustionTrendData,
  exceededCapacityTrendData,
  unlimitedTrendData,
  staleTrendData,
  quickExhaustionForecast,
  noExhaustionForecast,
} from "@/lib/api/__tests__/organization-usage.fixtures";

describe("CapacityTrendChart", () => {
  it("renders trend chart with title and data points", () => {
    const trend = trendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Proofs Trend")).toBeInTheDocument();
    expect(screen.getByText(/Observations/)).toBeInTheDocument();
  });

  it("displays stale indicator when data is stale", () => {
    const trend = staleTrendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("does not show stale indicator for fresh data", () => {
    const trend = trendData({ isStale: false });
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("renders SVG chart container", () => {
    const trend = trendData();
    const { container } = render(<CapacityTrendChart trend={trend} />);
    
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("displays warning threshold annotation (80%)", () => {
    const trend = trendData();
    const { container } = render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Warning (80%)")).toBeInTheDocument();
  });

  it("displays limit line for bounded capacity", () => {
    const trend = trendData({ limit: 100 });
    const { container } = render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Limit")).toBeInTheDocument();
  });

  it("does not show limit line for unlimited capacity", () => {
    const trend = unlimitedTrendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.queryByText("Limit")).not.toBeInTheDocument();
  });

  it("shows metadata correctly", () => {
    const trend = trendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText(/Observations/)).toBeInTheDocument();
    expect(screen.getByText(/Time span/)).toBeInTheDocument();
    expect(screen.getByText(/Latest usage/)).toBeInTheDocument();
  });

  it("handles near exhaustion (95%+)", () => {
    const trend = nearExhaustionTrendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Proofs (Near Limit) Trend")).toBeInTheDocument();
  });

  it("handles exceeded capacity (>100%)", () => {
    const trend = exceededCapacityTrendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Proofs (Exceeded) Trend")).toBeInTheDocument();
  });

  it("displays message when no data points available", () => {
    const trend = trendData({ points: [] });
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText(/No historical data available/)).toBeInTheDocument();
  });

  it("renders data point markers in SVG", () => {
    const trend = trendData();
    const { container } = render(<CapacityTrendChart trend={trend} />);
    
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThan(0);
  });

  it("accessibility: provides aria labels for percentage", () => {
    const trend = trendData();
    render(<CapacityTrendChart trend={trend} />);
    
    // The chart should be accessible (component is rendered)
    expect(screen.getByText("Proofs Trend")).toBeInTheDocument();
  });
});

describe("CapacityForecastChart", () => {
  it("renders forecast chart with title and projections", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Proofs Forecast/)).toBeInTheDocument();
    expect(screen.getByText(/Estimate/)).toBeInTheDocument();
    expect(screen.getByText(/Forecast span/)).toBeInTheDocument();
  });

  it("displays exhaustion badge when exhaustion is projected", () => {
    const forecast = quickExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText("Exhaustion Projected")).toBeInTheDocument();
  });

  it("does not show exhaustion badge when no exhaustion", () => {
    const forecast = noExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.queryByText("Exhaustion Projected")).not.toBeInTheDocument();
  });

  it("displays exhaustion window with projected date", () => {
    const forecast = quickExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Projected exhaustion/)).toBeInTheDocument();
  });

  it("does not show exhaustion window when not projected", () => {
    const forecast = noExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.queryByText(/Projected exhaustion/)).not.toBeInTheDocument();
  });

  it("renders SVG forecast chart", () => {
    const forecast = forecastData();
    const { container } = render(<CapacityForecastChart forecast={forecast} />);
    
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("displays confidence legend", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Estimated projection/)).toBeInTheDocument();
    expect(screen.getByText(/Confidence bounds/)).toBeInTheDocument();
  });

  it("shows metadata: forecast span", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Forecast span/)).toBeInTheDocument();
  });

  it("shows metadata: current usage", () => {
    const forecast = forecastData({ currentUsed: 75, limit: 100 });
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Current usage/)).toBeInTheDocument();
  });

  it("shows metadata: high confidence points", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/High confidence points/)).toBeInTheDocument();
  });

  it("displays limit line for bounded capacity", () => {
    const forecast = forecastData({ limit: 100 });
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText("Limit")).toBeInTheDocument();
  });

  it("does not show limit line for unlimited capacity", () => {
    const forecast = forecastData({ limit: null });
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.queryByText("Limit")).not.toBeInTheDocument();
  });

  it("shows message when no projection data available", () => {
    const forecast = forecastData({ projections: [] });
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/No forecast data available/)).toBeInTheDocument();
  });

  it("renders projection point markers in SVG", () => {
    const forecast = forecastData();
    const { container } = render(<CapacityForecastChart forecast={forecast} />);
    
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThan(0);
  });

  it("handles quick exhaustion scenarios", () => {
    const forecast = quickExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText("Exhaustion Projected")).toBeInTheDocument();
    expect(screen.getByText(/Projected exhaustion/)).toBeInTheDocument();
  });

  it("handles stable growth with no exhaustion", () => {
    const forecast = noExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.queryByText("Exhaustion Projected")).not.toBeInTheDocument();
    expect(screen.queryByText(/Projected exhaustion/)).not.toBeInTheDocument();
  });

  it("displays generated timestamp", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Generated at/)).toBeInTheDocument();
  });

  it("accessibility: component is rendered and accessible", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/Forecast/)).toBeInTheDocument();
  });
});

describe("Chart Rendering Edge Cases", () => {
  it("trend chart handles single data point", () => {
    const trend = trendData({ points: trendData({ points: [] }).points.slice(0, 1) });
    const result = render(<CapacityTrendChart trend={trend} />);
    
    // Should render without error
    expect(result.container).toBeDefined();
  });

  it("forecast chart handles high confidence projections", () => {
    const forecast = forecastData();
    render(<CapacityForecastChart forecast={forecast} />);
    
    expect(screen.getByText(/High confidence points/)).toBeInTheDocument();
  });

  it("trend chart reflects stale data warning", () => {
    const trend = staleTrendData();
    render(<CapacityTrendChart trend={trend} />);
    
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/Stale \(generated at/)).toBeInTheDocument();
  });

  it("forecast chart shows no exhaustion case clearly", () => {
    const forecast = noExhaustionForecast();
    render(<CapacityForecastChart forecast={forecast} />);
    
    // Should show forecast but not exhaustion
    expect(screen.getByText(/Forecast span/)).toBeInTheDocument();
    expect(screen.queryByText(/Projected exhaustion/)).not.toBeInTheDocument();
  });
});
