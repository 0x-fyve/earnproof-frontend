"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOrganizationUsage,
  getUsageLevel,
  getUsageLevelLabel,
  getUsageLevelTone,
  getUsagePercentage,
  formatUsageResource,
  getCapacityTrends,
  getCapacityForecasts,
  type OrganizationUsage,
  type ResourceUsage,
  type OrganizationCapacityTrends,
  type OrganizationCapacityForecasts,
  type CapacityTrendData,
  type CapacityForecastData,
} from "@/lib/api/organization-usage";
import { getOrganizations } from "@/lib/api/organizations";
import { StatusBadge } from "@/components/common/production-ui";
import { formatDate, formatDateTime, formatMessage } from "@/lib/i18n";
import { CapacityTrendChart } from "@/components/charts/capacity-trend-chart";
import { CapacityForecastChart } from "@/components/charts/capacity-forecast-chart";
import type { Organization } from "@/lib/api/generated/v1";

const SESSION_KEY = "earnproof.session";

type SessionData = {
  token: string;
  user: { id: string; role: string };
};

function readStoredSession(): SessionData | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored) as SessionData;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/** How stale is "stale"? Usage data older than this is flagged in the UI. */
const STALE_AFTER_MS = 5 * 60 * 1000;

type ViewMode = "current" | "trends" | "forecasts";
type RegistryDrillDown = string | null;

/**
 * Organization quota and usage dashboard: current usage, configured
 * limits, and reset/window context for API keys, webhooks, proofs, and
 * synchronization, plus request rate limiting (reported separately from
 * quota — see `lib/api/organization-usage.ts`).
 *
 * Extended with trend and forecast views showing historical capacity
 * tracking and projected exhaustion windows. Trends provide historical
 * context; forecasts estimate when capacity will be exhausted based on
 * current patterns.
 *
 * Server-endpoint status: `/organizations/{id}/usage`, `/organizations/{id}/usage/trends`,
 * and `/organizations/{id}/usage/forecasts` do not exist in the current backend.
 * Failed fetches render explicit "unavailable" states.
 */
export function OrganizationUsageDashboard() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [usage, setUsage] = useState<OrganizationUsage | null>(null);
  const [trends, setTrends] = useState<OrganizationCapacityTrends | null>(null);
  const [forecasts, setForecasts] = useState<OrganizationCapacityForecasts | null>(null);
  const [loading, setLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [forecastsError, setForecastsError] = useState<string | null>(null);
  const [usageCheckedAt, setUsageCheckedAt] = useState<number | null>(null);
  const [trendsCheckedAt, setTrendsCheckedAt] = useState<number | null>(null);
  const [forecastsCheckedAt, setForecastsCheckedAt] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("current");
  const [expandedRegistry, setExpandedRegistry] = useState<RegistryDrillDown>(null);

  const token = session?.token ?? null;
  const isAdmin = session?.user.role === "ADMIN" || session?.user.role === "ISSUER";

  const loadOrganizations = useCallback(async () => {
    if (!token) {
      return;
    }
    setOrganizationsError(null);
    try {
      const controller = new AbortController();
      const orgs = await getOrganizations(token, controller.signal);
      setOrganizations(orgs);
      setSelectedOrgId((current) => current ?? orgs[0]?.id ?? null);
    } catch {
      setOrganizationsError("Could not load organizations. Please try again.");
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void loadOrganizations();
      }
    });
    return () => {
      active = false;
    };
  }, [loadOrganizations]);

  const loadUsage = useCallback(async () => {
    if (!token || !selectedOrgId) {
      return;
    }
    setLoading(true);
    setUsageError(null);
    try {
      const controller = new AbortController();
      const result = await getOrganizationUsage(token, selectedOrgId, controller.signal);
      setUsage(result);
      setUsageCheckedAt(Date.now());
    } catch {
      setUsage(null);
      setUsageError(
        "Usage data is unavailable right now. The organization usage service could not be reached."
      );
    } finally {
      setLoading(false);
    }
  }, [token, selectedOrgId]);

  const loadTrends = useCallback(async () => {
    if (!token || !selectedOrgId) {
      return;
    }
    setTrendsError(null);
    try {
      const controller = new AbortController();
      const result = await getCapacityTrends(token, selectedOrgId, controller.signal);
      setTrends(result);
      setTrendsCheckedAt(Date.now());
    } catch {
      setTrends(null);
      setTrendsError("Capacity trend data could not be loaded.");
    }
  }, [token, selectedOrgId]);

  const loadForecasts = useCallback(async () => {
    if (!token || !selectedOrgId) {
      return;
    }
    setForecastsError(null);
    try {
      const controller = new AbortController();
      const result = await getCapacityForecasts(token, selectedOrgId, controller.signal);
      setForecasts(result);
      setForecastsCheckedAt(Date.now());
    } catch {
      setForecasts(null);
      setForecastsError("Capacity forecast data could not be loaded.");
    }
  }, [token, selectedOrgId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void loadUsage();
        void loadTrends();
        void loadForecasts();
      }
    });
    return () => {
      active = false;
    };
  }, [loadUsage, loadTrends, loadForecasts]);

  // Pure function of state: staleness computed from timestamps captured in effect callbacks
  const isStale =
    usage && usageCheckedAt !== null
      ? usageCheckedAt - new Date(usage.generatedAt).getTime() > STALE_AFTER_MS
      : false;

  const isTrendsStale =
    trends && trendsCheckedAt !== null
      ? trendsCheckedAt - new Date(trends.generatedAt).getTime() > STALE_AFTER_MS
      : false;

  const isForecatsStale =
    forecasts && forecastsCheckedAt !== null
      ? forecastsCheckedAt - new Date(forecasts.generatedAt).getTime() > STALE_AFTER_MS
      : false;

  // Mark individual trend points as stale
  const trendDataWithStaleness = trends
    ? Object.entries(trends.trends).map(([key, trend]) => ({
        key,
        data: {
          ...trend,
          isStale: isTrendsStale,
        } as CapacityTrendData,
      }))
    : [];

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to view organization usage.
        </p>
        <a
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          href="/proofs"
        >
          Connect Wallet
        </a>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          The usage dashboard requires administrative access. Contact your administrator if you need
          access.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Usage, Trends &amp; Forecasts</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Current usage, historical trends, and projected capacity exhaustion for this organization&apos;s
              API keys, webhooks, proofs, and payment synchronization.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!selectedOrgId}
              onClick={() => {
                void loadUsage();
                void loadTrends();
                void loadForecasts();
              }}
              type="button"
            >
              Refresh All
            </button>
          </div>
        </div>

        {organizationsError && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {organizationsError}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-200" htmlFor="usage-org-select">
            Organization
          </label>
          <select
            className="mt-1 h-10 w-full max-w-md rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white disabled:opacity-50"
            disabled={organizations.length === 0}
            id="usage-org-select"
            onChange={(event) => {
              setSelectedOrgId(event.target.value);
              setViewMode("current");
              setExpandedRegistry(null);
            }}
            value={selectedOrgId ?? ""}
          >
            {organizations.length === 0 && <option value="">No organizations available</option>}
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10">
        {(
          [
            { mode: "current" as const, label: "Current Usage" },
            { mode: "trends" as const, label: "Trends" },
            { mode: "forecasts" as const, label: "Forecasts" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.mode}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              viewMode === tab.mode
                ? "border-cyan-300 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => {
              setViewMode(tab.mode);
              setExpandedRegistry(null);
            }}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Current Usage View */}
      {viewMode === "current" && (
        <>
          {usageError && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4" role="alert">
              <p className="text-sm text-rose-200">{usageError}</p>
            </div>
          )}

          {loading && !usage && !usageError && (
            <p className="text-sm text-slate-400">Loading usage data...</p>
          )}

          {usage && (
            <section className="grid gap-4">
              {isStale && (
                <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3" role="status">
                  <p className="text-sm text-amber-100">
                    {formatMessage(
                      "This usage snapshot is from {generatedAt} and may be out of date. Click Refresh All for current numbers.",
                      { generatedAt: formatDateTime(usage.generatedAt) }
                    )}
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {usage.resources.map((resource) => (
                  <UsageCard key={resource.resource} usage={resource} />
                ))}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <h3 className="text-lg font-semibold text-white">Request Rate Limit</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Rate limiting governs request bursts and is separate from the resource quotas above —
                  you can be under quota and still be rate limited, or vice versa.
                </p>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-400">Limit</dt>
                    <dd className="text-slate-200">
                      {formatMessage("{limit} requests / minute", {
                        limit: usage.rateLimit.limitPerMinute,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Remaining in window</dt>
                    <dd className="text-slate-200">{usage.rateLimit.remainingInWindow}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Window resets</dt>
                    <dd className="text-slate-200">{formatDateTime(usage.rateLimit.windowResetAt)}</dd>
                  </div>
                </dl>
              </div>
            </section>
          )}
        </>
      )}

      {/* Trends View */}
      {viewMode === "trends" && (
        <>
          {trendsError && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4" role="alert">
              <p className="text-sm text-rose-200">{trendsError}</p>
            </div>
          )}

          {!trends && !trendsError && (
            <p className="text-sm text-slate-400">Loading trend data...</p>
          )}

          {trends && trendDataWithStaleness.length > 0 && (
            <section className="grid gap-4">
              {trendDataWithStaleness.map(({ key, data }) => (
                <div key={key}>
                  <CapacityTrendChart trend={data} />
                  {expandedRegistry === key && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs text-slate-400">Drill-down details for {data.displayName}</p>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {trends && trendDataWithStaleness.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm text-slate-400">No trend data available for this organization.</p>
            </div>
          )}
        </>
      )}

      {/* Forecasts View */}
      {viewMode === "forecasts" && (
        <>
          {forecastsError && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4" role="alert">
              <p className="text-sm text-rose-200">{forecastsError}</p>
            </div>
          )}

          {!forecasts && !forecastsError && (
            <p className="text-sm text-slate-400">Loading forecast data...</p>
          )}

          {forecasts && Object.entries(forecasts.forecasts).length > 0 && (
            <section className="grid gap-4">
              {Object.entries(forecasts.forecasts).map(([key, forecast]) => (
                <div key={key}>
                  <CapacityForecastChart forecast={forecast} />
                  {expandedRegistry === key && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs text-slate-400">Drill-down details for {forecast.displayName}</p>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {forecasts && Object.entries(forecasts.forecasts).length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm text-slate-400">No forecast data available for this organization.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UsageCard({ usage }: { usage: ResourceUsage }) {
  const level = getUsageLevel(usage);
  const percentage = getUsagePercentage(usage);
  const levelLabel = getUsageLevelLabel(level);
  const tone = getUsageLevelTone(level);

  return (
    <article className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{formatUsageResource(usage.resource)}</h3>
        <StatusBadge tone={tone}>
          {/* Icon/text alongside color so the level never relies on color alone. */}
          <span aria-hidden="true">{level === "exceeded" ? "⚠ " : level === "warning" ? "▲ " : ""}</span>
          {levelLabel}
        </StatusBadge>
      </div>

      <p className="text-2xl font-semibold text-white">
        {usage.limit === null
          ? formatMessage("{used} used", { used: usage.used })
          : formatMessage("{used} / {limit}", { used: usage.used, limit: usage.limit })}
      </p>

      {percentage !== null && (
        <div
          aria-label={formatMessage("{resource} usage: {percentage}% of quota", {
            resource: formatUsageResource(usage.resource),
            percentage,
          })}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percentage}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
        >
          <div
            className={`h-full rounded-full ${
              level === "exceeded" ? "bg-rose-400" : level === "warning" ? "bg-amber-300" : "bg-emerald-400"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      <p className="text-xs text-slate-400">
        {formatMessage(
          usage.windowType === "ROLLING" ? "Rolling window resets {date}" : "Resets {date}",
          { date: formatDate(usage.windowResetAt) }
        )}
      </p>

      <a
        className="w-fit text-xs text-cyan-200 underline underline-offset-4"
        href={usage.resourceHref}
      >
        {formatMessage("View {resource}", { resource: formatUsageResource(usage.resource) })}
      </a>
    </article>
  );
}
