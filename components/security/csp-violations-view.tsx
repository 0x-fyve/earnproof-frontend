"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CspViolationTable } from "@/components/security/csp-violation-table";
import {
  CSP_DEFAULT_WINDOW,
  CSP_DIRECTIVES,
  CSP_ROUTE_CATEGORIES,
  CSP_WINDOWS,
  CspRequestError,
  canViewCspDiagnostics,
  fetchCspViolations,
  isReportStale,
  summarizeCspViolations,
  type CspDirective,
  type CspErrorKind,
  type CspRouteCategory,
  type CspViolationFilter,
  type CspViolationGroup,
  type CspWindow,
} from "@/lib/api/csp-violations";
import { Timestamp } from "@/components/common/timestamp";
import { defineMessages, formatMessage, formatNumber } from "@/lib/i18n";
import { clearStoredSession } from "@/lib/session";
import { useSessionRole, useSessionToken } from "@/lib/use-session";

/**
 * Operator view of aggregated CSP violations (issue #296). The contract,
 * validation and privacy rules live in `lib/api/csp-violations.ts`; the
 * operator guide is `docs/csp-violation-diagnostics.md`.
 *
 * Deterministic states: no session -> sign-in panel; a role that may not view
 * it -> denied panel, nothing fetched; 401 -> session cleared everywhere;
 * 403 / 404 / 501 -> terminal panel; other failures -> alert with the request
 * reference and a retry. Filter changes, sign-out and unmount abort the
 * in-flight request and ignore anything that arrives late.
 */

const messages = defineMessages("cspViolations", {
  summary: "{total} blocked loads in {groups} groups",
  regressions: "{count} new in the current release",
  stale: "This report was generated more than 15 minutes ago and may be out of date.",
  withheld: "{count} groups were withheld because they contained fields outside the diagnostics contract.",
  invalid: "{count} groups could not be displayed.",
});

const windowLabels: Record<CspWindow, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

type Failure = { kind: CspErrorKind; message: string; requestId: string | null };

function toFailure(error: unknown, fallback: string): Failure {
  if (error instanceof CspRequestError) {
    return { kind: error.kind, message: error.message, requestId: error.requestId || null };
  }
  return { kind: "failed", message: fallback, requestId: null };
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

const selectClass =
  "h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm font-normal text-white";

export function CspViolationsView() {
  const token = useSessionToken();
  const role = useSessionRole();
  const allowed = canViewCspDiagnostics(role);

  const [windowKey, setWindowKey] = useState<CspWindow>(CSP_DEFAULT_WINDOW);
  const [filter, setFilter] = useState<CspViolationFilter>({});
  const [groups, setGroups] = useState<CspViolationGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ generatedAt: string; currentRelease: string; releases: string[] } | null>(null);
  const [counts, setCounts] = useState({ withheld: 0, invalid: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const handleFailure = useCallback((error: unknown, fallback: string) => {
    const next = toFailure(error, fallback);
    if (next.kind === "unauthorized") {
      clearStoredSession("unauthorized");
    }
    setFailure(next);
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;

    if (!token || !allowed) {
      void Promise.resolve().then(() => {
        setGroups([]);
        setCursor(null);
        setMeta(null);
        setFailure(null);
        setCounts({ withheld: 0, invalid: 0 });
        setLoading(false);
        setLoadingMore(false);
      });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    async function loadFirstPage(sessionToken: string) {
      setLoading(true);
      setLoadingMore(false);
      setFailure(null);
      setGroups([]);
      setCursor(null);
      setMeta(null);
      setCounts({ withheld: 0, invalid: 0 });

      try {
        const report = await fetchCspViolations({
          token: sessionToken,
          window: windowKey,
          filter,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setGroups(report.groups);
        setCursor(report.nextCursor);
        setMeta({ generatedAt: report.generatedAt, currentRelease: report.currentRelease, releases: report.releases });
        setCounts({ withheld: report.withheldCount, invalid: report.invalidCount });
      } catch (error) {
        if (isAbort(error, controller.signal)) return;
        handleFailure(error, "Unable to load CSP diagnostics. Please try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadFirstPage(token);

    return () => controller.abort();
  }, [token, allowed, windowKey, filter, reloadKey, handleFailure]);

  const loadMore = useCallback(async () => {
    const controller = controllerRef.current;
    if (!token || !cursor || loadingMore || !controller || controller.signal.aborted) return;

    setLoadingMore(true);
    setFailure(null);

    try {
      const report = await fetchCspViolations({
        token,
        window: windowKey,
        filter,
        cursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setGroups((previous) => {
        const known = new Set(previous.map((group) => group.id));
        return [...previous, ...report.groups.filter((group) => !known.has(group.id))];
      });
      setCursor(report.nextCursor);
      setCounts((previous) => ({
        withheld: previous.withheld + report.withheldCount,
        invalid: previous.invalid + report.invalidCount,
      }));
    } catch (error) {
      if (isAbort(error, controller.signal)) return;
      handleFailure(error, "Unable to load more CSP diagnostics. Please try again.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [token, cursor, windowKey, filter, loadingMore, handleFailure]);

  if (!token) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5" role="status">
        <p className="text-sm font-medium text-white">Sign in to view CSP diagnostics</p>
        <p className="mt-1 text-sm text-slate-400">
          These diagnostics are only shown to signed-in organization administrators.
        </p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Access Denied</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Only organization administrators can view CSP violation diagnostics.
        </p>
      </div>
    );
  }

  if (failure && (failure.kind === "forbidden" || failure.kind === "unavailable")) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5" role="status">
        <p className="text-sm font-medium text-white">
          {failure.kind === "forbidden" ? "CSP diagnostics access denied" : "CSP diagnostics unavailable"}
        </p>
        <p className="mt-1 text-sm text-amber-100">{failure.message}</p>
        {failure.requestId && <p className="mt-2 text-xs text-slate-400">Reference: {failure.requestId}</p>}
      </div>
    );
  }

  const summary = meta ? summarizeCspViolations(groups, meta.currentRelease) : null;
  const stale = meta ? isReportStale(meta.generatedAt) : false;
  const filtered = Boolean(filter.directive || filter.routeCategory || filter.release);
  const retryable = failure !== null && groups.length === 0 && !loading;

  return (
    <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="grid gap-[7px] text-xs font-semibold text-slate-300 sm:w-44">
          Time window
          <select
            className={selectClass}
            onChange={(event) => setWindowKey(event.target.value as CspWindow)}
            value={windowKey}
          >
            {CSP_WINDOWS.map((value) => (
              <option key={value} value={value}>{windowLabels[value]}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-[7px] text-xs font-semibold text-slate-300 sm:w-52">
          Directive
          <select
            className={selectClass}
            onChange={(event) =>
              setFilter({ ...filter, directive: event.target.value ? (event.target.value as CspDirective) : undefined })
            }
            value={filter.directive ?? ""}
          >
            <option value="">All directives</option>
            {CSP_DIRECTIVES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-[7px] text-xs font-semibold text-slate-300 sm:w-48">
          Route category
          <select
            className={selectClass}
            onChange={(event) =>
              setFilter({
                ...filter,
                routeCategory: event.target.value ? (event.target.value as CspRouteCategory) : undefined,
              })
            }
            value={filter.routeCategory ?? ""}
          >
            <option value="">All route categories</option>
            {CSP_ROUTE_CATEGORIES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-[7px] text-xs font-semibold text-slate-300 sm:w-44">
          Release
          <select
            className={selectClass}
            onChange={(event) => setFilter({ ...filter, release: event.target.value || undefined })}
            value={filter.release ?? ""}
          >
            <option value="">All releases</option>
            {/* Keep the active filter selectable while the next report loads. */}
            {Array.from(new Set([...(meta?.releases ?? []), ...(filter.release ? [filter.release] : [])])).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>

      {failure && (
        <div className="grid gap-2 rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {failure.message}
            {failure.requestId ? ` Reference: ${failure.requestId}` : ""}
          </p>
          {retryable && (
            <button
              className="h-9 w-fit rounded-lg border border-white/15 px-4 text-sm font-medium text-white transition hover:bg-white/10"
              onClick={() => setReloadKey((key) => key + 1)}
              type="button"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {stale && (
        <p className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100" data-testid="csp-stale-banner" role="status">
          {messages.stale}
        </p>
      )}

      {summary && meta && !loading && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300" data-testid="csp-summary">
          <span>
            {formatMessage(messages.summary, {
              total: formatNumber(summary.totalCount),
              groups: formatNumber(summary.groupCount),
            })}
          </span>
          {summary.regressionCount > 0 && (
            <span className="font-semibold text-rose-200">
              {formatMessage(messages.regressions, { count: formatNumber(summary.regressionCount) })}
            </span>
          )}
          <span className="text-xs text-slate-500">
            Generated <Timestamp value={meta.generatedAt} /> · Current release{" "}
            <span className="font-mono">{meta.currentRelease}</span>
          </span>
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center" role="status">
          <p className="text-sm text-slate-400">Loading CSP diagnostics...</p>
        </div>
      ) : groups.length === 0 ? (
        !failure && (
          <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
            <p className="text-sm text-slate-400">
              {filtered
                ? "No CSP violations match the selected filters."
                : "No CSP violations were reported in this window."}
            </p>
          </div>
        )
      ) : (
        meta && <CspViolationTable currentRelease={meta.currentRelease} groups={groups} />
      )}

      {counts.withheld > 0 && (
        <p className="text-xs text-amber-200" data-testid="csp-withheld-note" role="status">
          {formatMessage(messages.withheld, { count: formatNumber(counts.withheld) })}
        </p>
      )}
      {counts.invalid > 0 && (
        <p className="text-xs text-slate-500" data-testid="csp-invalid-note">
          {formatMessage(messages.invalid, { count: formatNumber(counts.invalid) })}
        </p>
      )}

      {cursor && !loading && (
        <button
          className="h-10 rounded-lg border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
          disabled={loadingMore}
          onClick={loadMore}
          type="button"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
