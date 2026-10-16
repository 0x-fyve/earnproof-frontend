"use client";

import { formatDate, formatDateTime } from "@/lib/i18n";
import type { CapacityTrendData } from "@/lib/api/organization-usage";

/**
 * Renders a bounded trend chart for capacity usage over time using SVG.
 * Shows historical observations with optional staleness indicator.
 * No raw private data is exposed; only aggregated percentages and counts.
 */
export function CapacityTrendChart({ trend }: { trend: CapacityTrendData }) {
  if (!trend.points || trend.points.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3 className="text-sm font-semibold text-white">{trend.displayName} Trend</h3>
        <p className="mt-2 text-xs text-slate-400">No historical data available.</p>
      </div>
    );
  }

  // Calculate chart dimensions and scale
  const points = trend.points;
  const chartWidth = 400;
  const chartHeight = 150;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Y-axis: 0 to 100% (or 0 to max used if unlimited)
  const maxUsage = Math.max(...points.map((p) => p.percentageUsed ?? 0), 100);
  const yScale = plotHeight / maxUsage;

  // X-axis: time-based scaling
  const timestamps = points.map((p) => new Date(p.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const timeRange = maxTime - minTime || 1;
  const xScale = plotWidth / timeRange;

  // Build path coordinates for trend line
  const pathPoints = points
    .map((point, idx) => {
      const x = padding.left + (timestamps[idx] - minTime) * xScale;
      const y = padding.top + plotHeight - (point.percentageUsed ?? 0) * yScale;
      return `${x},${y}`;
    })
    .join(" L ");

  const pathD = `M ${pathPoints}`;

  // Format time axis labels
  const timePoints = [];
  if (points.length > 0) {
    timePoints.push(points[0]);
    if (points.length > 1) {
      timePoints.push(points[Math.floor(points.length / 2)]);
      timePoints.push(points[points.length - 1]);
    }
  }

  return (
    <article className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{trend.displayName} Trend</h3>
        {trend.isStale && (
          <span className="inline-flex h-6 items-center rounded-full bg-amber-300/20 px-2 text-xs font-medium text-amber-200">
            Stale
          </span>
        )}
      </div>

      {/* SVG Trend Chart */}
      <div className="overflow-x-auto rounded bg-slate-900/50 p-2">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-full" style={{ height: "auto" }}>
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <line
              key={`grid-${pct}`}
              x1={padding.left}
              y1={padding.top + plotHeight - (pct / maxUsage) * plotHeight}
              x2={chartWidth - padding.right}
              y2={padding.top + plotHeight - (pct / maxUsage) * plotHeight}
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
              y={padding.top + plotHeight - (pct / maxUsage) * plotHeight + 4}
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

          {/* Trend line */}
          <polyline points={pathPoints} fill="none" stroke="rgb(34, 197, 94)" strokeWidth="2" />

          {/* Data points */}
          {points.map((point, idx) => {
            const x = padding.left + (timestamps[idx] - minTime) * xScale;
            const y = padding.top + plotHeight - (point.percentageUsed ?? 0) * yScale;
            const isExceeded = point.percentageUsed !== null && point.percentageUsed >= 100;
            const isWarning = point.percentageUsed !== null && point.percentageUsed >= 80 && !isExceeded;

            return (
              <circle
                key={`point-${idx}`}
                cx={x}
                cy={y}
                r="4"
                fill={isExceeded ? "rgb(244, 63, 94)" : isWarning ? "rgb(251, 146, 60)" : "rgb(34, 197, 94)"}
                stroke="rgb(15, 23, 42)"
                strokeWidth="2"
              />
            );
          })}

          {/* Threshold line at 80% (warning) */}
          <line
            x1={padding.left}
            y1={padding.top + plotHeight - 0.8 * plotHeight}
            x2={chartWidth - padding.right}
            y2={padding.top + plotHeight - 0.8 * plotHeight}
            stroke="rgb(251, 146, 60)"
            strokeWidth="1"
            strokeDasharray="4,4"
            opacity="0.5"
          />

          {/* Threshold label for 80% */}
          <text
            x={chartWidth - padding.right - 5}
            y={padding.top + plotHeight - 0.8 * plotHeight - 5}
            fontSize="10"
            fill="rgb(251, 146, 60)"
            opacity="0.7"
            textAnchor="end"
          >
            Warning (80%)
          </text>

          {/* Limit line if applicable */}
          {trend.limit !== null && (
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
        </svg>
      </div>

      {/* Metadata */}
      <div className="grid gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Observations</span>
          <span className="text-slate-200">{points.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Time span</span>
          <span className="text-slate-200">
            {formatDate(points[0].timestamp)} to {formatDate(points[points.length - 1].timestamp)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Latest usage</span>
          <span className="text-slate-200">
            {trend.limit === null
              ? `${points[points.length - 1].used} used`
              : `${points[points.length - 1].used} / ${trend.limit}`}
          </span>
        </div>
        {trend.isStale && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Data freshness</span>
            <span className="text-amber-200">Stale (generated at {formatDateTime(trend.generatedAt)})</span>
          </div>
        )}
      </div>
    </article>
  );
}
