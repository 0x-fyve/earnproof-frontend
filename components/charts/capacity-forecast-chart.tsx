"use client";

import { formatDate, formatDateTime } from "@/lib/i18n";
import type { CapacityForecastData } from "@/lib/api/organization-usage";

/**
 * Renders a bounded forecast chart for projected capacity exhaustion.
 * Shows confidence intervals, exhaustion windows, and current baselines.
 * Clearly marked as estimates with no raw private data exposure.
 */
export function CapacityForecastChart({ forecast }: { forecast: CapacityForecastData }) {
  if (!forecast.projections || forecast.projections.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3 className="text-sm font-semibold text-white">{forecast.displayName} Forecast</h3>
        <p className="mt-2 text-xs text-slate-400">No forecast data available.</p>
      </div>
    );
  }

  const projections = forecast.projections;
  const chartWidth = 400;
  const chartHeight = 150;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Y-axis: 0 to 100% (or max projection)
  const maxProjection = Math.max(...projections.map((p) => p.projectionUpperBound ?? 100), 100);
  const yScale = plotHeight / maxProjection;

  // X-axis: time-based scaling
  const timestamps = projections.map((p) => new Date(p.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const timeRange = maxTime - minTime || 1;
  const xScale = plotWidth / timeRange;

  // Build paths for upper/lower bounds and estimated line
  const lowerBoundPoints = projections
    .map((p, idx) => {
      const x = padding.left + (timestamps[idx] - minTime) * xScale;
      const y = padding.top + plotHeight - (p.projectionLowerBound * yScale);
      return `${x},${y}`;
    })
    .join(" L ");

  const upperBoundPoints = projections
    .map((p, idx) => {
      const x = padding.left + (timestamps[idx] - minTime) * xScale;
      const y = padding.top + plotHeight - (p.projectionUpperBound * yScale);
      return `${x},${y}`;
    })
    .join(" L ");

  const estimatedPoints = projections
    .map((p, idx) => {
      const x = padding.left + (timestamps[idx] - minTime) * xScale;
      const y = padding.top + plotHeight - ((p.estimatedPercentage ?? 0) * yScale);
      return `${x},${y}`;
    })
    .join(" L ");

  // Confidence levels for styling
  const getConfidenceColor = (confidence: "low" | "medium" | "high") => {
    switch (confidence) {
      case "high":
        return "rgb(34, 197, 94)";
      case "medium":
        return "rgb(251, 146, 60)";
      case "low":
        return "rgb(244, 63, 94)";
    }
  };

  // Find exhaustion point if any
  const exhaustionProjection = projections.find((p) => p.projectedExhaustionAt);

  // Time points for X-axis labels
  const timePoints = [];
  if (projections.length > 0) {
    timePoints.push(projections[0]);
    if (projections.length > 1) {
      timePoints.push(projections[Math.floor(projections.length / 2)]);
      timePoints.push(projections[projections.length - 1]);
    }
  }

  return (
    <article className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{forecast.displayName} Forecast (Estimate)</h3>
        {exhaustionProjection && (
          <span className="inline-flex h-6 items-center rounded-full bg-rose-300/20 px-2 text-xs font-medium text-rose-200">
            Exhaustion Projected
          </span>
        )}
      </div>

      {/* SVG Forecast Chart */}
      <div className="overflow-x-auto rounded bg-slate-900/50 p-2">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-full" style={{ height: "auto" }}>
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <line
              key={`grid-${pct}`}
              x1={padding.left}
              y1={padding.top + plotHeight - (pct / maxProjection) * plotHeight}
              x2={chartWidth - padding.right}
              y2={padding.top + plotHeight - (pct / maxProjection) * plotHeight}
              stroke="rgba(148, 163, 184, 0.1)"
              strokeWidth="1"
            />
          ))}

          {/* Y-axis */}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + plotHeight}
            stroke="rgba(148, 163, 184, 0.3)"
            strokeWidth="1"
          />

          {/* X-axis */}
          <line
            x1={padding.left}
            y1={padding.top + plotHeight}
            x2={chartWidth - padding.right}
            y2={padding.top + plotHeight}
            stroke="rgba(148, 163, 184, 0.3)"
            strokeWidth="1"
          />

          {/* Y-axis labels */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <text
              key={`y-label-${pct}`}
              x={padding.left - 10}
              y={padding.top + plotHeight - (pct / maxProjection) * plotHeight + 4}
              fontSize="12"
              fill="rgba(148, 163, 184, 0.7)"
              textAnchor="end"
            >
              {pct}%
            </text>
          ))}

          {/* X-axis labels */}
          {timePoints.map((point, idx) => {
            const x = padding.left + (new Date(point.timestamp).getTime() - minTime) * xScale;
            return (
              <g key={`x-label-${idx}`}>
                <text
                  x={x}
                  y={padding.top + plotHeight + 18}
                  fontSize="11"
                  fill="rgba(148, 163, 184, 0.7)"
                  textAnchor="middle"
                >
                  {formatDate(point.timestamp)}
                </text>
              </g>
            );
          })}

          {/* Confidence interval (filled region) */}
          <defs>
            <linearGradient id="confidenceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(34, 197, 94, 0.2)" />
              <stop offset="100%" stopColor="rgba(34, 197, 94, 0.05)" />
            </linearGradient>
          </defs>

          {/* Upper and lower bounds as filled area */}
          <path
            d={`M ${lowerBoundPoints} L ${upperBoundPoints
              .split(" L ")
              .reverse()
              .join(" L ")} Z`}
            fill="url(#confidenceGradient)"
          />

          {/* Lower bound line */}
          <polyline points={lowerBoundPoints} fill="none" stroke="rgba(34, 197, 94, 0.4)" strokeWidth="1" strokeDasharray="2,2" />

          {/* Upper bound line */}
          <polyline points={upperBoundPoints} fill="none" stroke="rgba(34, 197, 94, 0.4)" strokeWidth="1" strokeDasharray="2,2" />

          {/* Estimated projection line */}
          <polyline points={estimatedPoints} fill="none" stroke="rgb(34, 197, 94)" strokeWidth="2" />

          {/* Projection points with confidence coloring */}
          {projections.map((p, idx) => {
            const x = padding.left + (timestamps[idx] - minTime) * xScale;
            const y = padding.top + plotHeight - ((p.estimatedPercentage ?? 0) * yScale);
            const color = getConfidenceColor(p.confidence);

            return (
              <circle
                key={`point-${idx}`}
                cx={x}
                cy={y}
                r="3"
                fill={color}
                stroke="rgb(15, 23, 42)"
                strokeWidth="1"
              />
            );
          })}

          {/* Limit line */}
          {forecast.limit !== null && (
            <>
              <line
                x1={padding.left}
                y1={padding.top + plotHeight - plotHeight}
                x2={chartWidth - padding.right}
                y2={padding.top + plotHeight - plotHeight}
                stroke="rgb(244, 63, 94)"
                strokeWidth="1"
                strokeDasharray="2,2"
                opacity="0.5"
              />
              <text
                x={chartWidth - padding.right - 5}
                y={padding.top + 12}
                fontSize="10"
                fill="rgb(244, 63, 94)"
                opacity="0.7"
                textAnchor="end"
              >
                Limit
              </text>
            </>
          )}

          {/* Current baseline marker */}
          <line
            x1={padding.left}
            y1={padding.top + plotHeight - (forecast.currentUsed / (forecast.limit ?? 100)) * yScale}
            x2={padding.left + 5}
            y2={padding.top + plotHeight - (forecast.currentUsed / (forecast.limit ?? 100)) * yScale}
            stroke="rgb(59, 130, 246)"
            strokeWidth="2"
          />
          <text
            x={padding.left + 10}
            y={padding.top + plotHeight - (forecast.currentUsed / (forecast.limit ?? 100)) * yScale + 4}
            fontSize="10"
            fill="rgb(59, 130, 246)"
            opacity="0.8"
          >
            Current
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-2 w-4 bg-emerald-400" />
          <span className="text-slate-300">Estimated projection</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-4 border-b-2 border-dashed border-emerald-400" />
          <span className="text-slate-300">Confidence bounds</span>
        </div>
      </div>

      {/* Exhaustion Window (if applicable) */}
      {exhaustionProjection && exhaustionProjection.projectedExhaustionAt && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-xs font-medium text-rose-100">
            <span className="font-semibold">Projected exhaustion:</span> {formatDate(exhaustionProjection.projectedExhaustionAt)}
          </p>
          <p className="mt-1 text-xs text-rose-200">
            Based on current usage patterns, this registry is projected to reach capacity on this date.
          </p>
        </div>
      )}

      {/* Metadata */}
      <div className="grid gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Forecast span</span>
          <span className="text-slate-200">
            {formatDate(projections[0].timestamp)} to {formatDate(projections[projections.length - 1].timestamp)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Current usage</span>
          <span className="text-slate-200">
            {forecast.limit === null
              ? `${forecast.currentUsed} used`
              : `${forecast.currentUsed} / ${forecast.limit}`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">High confidence points</span>
          <span className="text-slate-200">{projections.filter((p) => p.confidence === "high").length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Generated at</span>
          <span className="text-slate-200">{formatDateTime(forecast.generatedAt)}</span>
        </div>
      </div>
    </article>
  );
}
