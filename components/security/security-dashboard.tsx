"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganizationContext } from "@/lib/organization-context";
import { useAuthSession } from "@/lib/auth";
import {
  getOrganizationSecurityPosture,
  evaluateSecurityChecks,
  getPostureSummary,
  hasCriticalIssues,
  getMostCriticalSeverity,
  groupChecksByCategory,
  formatEvaluationAge,
  type SecurityPosture,
} from "@/lib/api/security-posture";
import { SecurityPostureScore } from "./security-posture-score";
import { SecurityChecksList } from "./security-checks-list";
import { SecurityCategorySummary } from "./security-category-summary";
import { SecurityRefreshButton } from "./security-refresh-button";
import { SecurityExportButton } from "./security-export-button";

export function SecurityDashboard() {
  const { user, token } = useAuthSession();
  const { organization } = useOrganizationContext();

  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load security posture on mount and when organization changes
  const loadPosture = useCallback(async (isRefresh = false) => {
    if (!organization || !token || !user) {
      setLoading(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await getOrganizationSecurityPosture(
        token,
        organization.id,
        controller.signal
      );

      if (controller.signal.aborted) {
        return;
      }

      setPosture(data);
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "Failed to load security posture";
        setError(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [organization, token, user]);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        void loadPosture();
      }
    });

    return () => {
      active = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadPosture]);

  // Check authorization
  const isAdmin = user?.role === "ADMIN" || user?.role === "ISSUER";
  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Access Denied</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Only organization administrators can access the security posture dashboard.
        </p>
      </div>
    );
  }

  // Render loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
          <div className="h-12 w-32 animate-pulse rounded bg-white/10" />
          <div className="mt-4 h-6 w-full animate-pulse rounded bg-white/10" />
          <div className="mt-2 h-6 w-3/4 animate-pulse rounded bg-white/10" />
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-5">
        <h2 className="text-lg font-semibold text-red-400">Unable to Load Security Posture</h2>
        <p className="mt-2 text-sm text-red-300">{error}</p>
        <button
          onClick={() => loadPosture()}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-red-500/20 px-3 text-xs font-medium text-red-200 transition hover:bg-red-500/30"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Render no data state
  if (!posture) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <p className="text-sm text-slate-300">No security data available.</p>
      </div>
    );
  }

  const criticalIssues = hasCriticalIssues(posture);
  const mostCritical = getMostCriticalSeverity(posture);
  const summary = getPostureSummary(posture);
  const categorized = groupChecksByCategory(posture.checks);
  const lastEvaluated = formatEvaluationAge(posture);

  return (
    <div className="space-y-8">
      {/* Header with score and actions */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Security Posture</h2>
          <p className="mt-1 text-sm text-slate-400">
            {summary} • Evaluated {lastEvaluated}
            {!posture.isFresh && posture.stalenessDays && (
              <span className="ml-2 inline-block rounded-full bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
                Data stale ({posture.stalenessDays}d old)
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <SecurityRefreshButton
            organizationId={organization!.id}
            onRefresh={() => loadPosture(true)}
            isRefreshing={refreshing}
          />
          <SecurityExportButton organizationId={organization!.id} />
        </div>
      </div>

      {/* Critical alert if needed */}
      {criticalIssues && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <div className="flex gap-3">
            <div className="flex-shrink-0 text-red-400">
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-red-400">Critical Issues Detected</h3>
              <p className="mt-1 text-sm text-red-300">
                {posture.severityCounts.CRITICAL} critical severity finding
                {posture.severityCounts.CRITICAL !== 1 ? "s" : ""} require immediate attention.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Score card */}
      <SecurityPostureScore
        score={posture.score}
        severity={mostCritical}
        isFresh={posture.isFresh}
      />

      {/* Severity breakdown */}
      <div className="grid gap-4 sm:grid-cols-5">
        {[
          { label: "Critical", count: posture.severityCounts.CRITICAL, color: "red" },
          { label: "High", count: posture.severityCounts.HIGH, color: "orange" },
          { label: "Medium", count: posture.severityCounts.MEDIUM, color: "yellow" },
          { label: "Low", count: posture.severityCounts.LOW, color: "blue" },
          { label: "Info", count: posture.severityCounts.INFO, color: "green" },
        ].map(({ label, count, color }) => (
          <div
            key={label}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
          >
            <div className={`text-sm font-medium text-${color}-300`}>{label}</div>
            <div className="mt-2 text-2xl font-bold text-white">{count}</div>
          </div>
        ))}
      </div>

      {/* Category summary */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-white">By Category</h3>
        <SecurityCategorySummary categorized={categorized} />
      </div>

      {/* Detailed checks */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-white">Security Checks</h3>
        <SecurityChecksList
          checks={posture.checks}
          onPostureRefresh={() => loadPosture(true)}
        />
      </div>
    </div>
  );
}
