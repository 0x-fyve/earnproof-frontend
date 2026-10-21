"use client";

/**
 * Background job execution monitor (#219).
 *
 * Filter (category/status) state is preserved in the URL via
 * `useSearchParams`/`router.replace`, matching `AuditLogManagement`'s
 * convention exactly. Pagination uses the cursor `fetchMockJobExecutions`
 * returns, which stays stable even as new jobs "arrive" at the top of the
 * fixture list (see `lib/api/jobs.ts`'s doc comment on the ordinal cursor).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { JobFilterBar } from "./job-filter-bar";
import { JobExecutionList } from "./job-execution-list";
import { CursorPagination, type PaginationState } from "@/components/common/cursor-pagination";
import {
  JobsForbiddenError,
  fetchMockJobExecutions,
  type JobCategory,
  type JobExecution,
  type JobListFilters,
} from "@/lib/api/jobs";

function filtersFromSearchParams(searchParams: URLSearchParams): JobListFilters {
  const filters: JobListFilters = {};
  const category = searchParams.get("category");
  if (category) {
    filters.category = category as JobCategory;
  }
  const status = searchParams.get("status");
  if (status) {
    filters.status = status as JobExecution["status"];
  }
  return filters;
}

export function JobExecutionMonitor() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFiltersState] = useState<JobListFilters>(() =>
    filtersFromSearchParams(searchParams),
  );
  const [executions, setExecutions] = useState<JobExecution[]>([]);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setFilters = useCallback(
    (next: JobListFilters) => {
      setFiltersState(next);
      setCursorStack([null]);
      setCursorIndex(0);

      const params = new URLSearchParams();
      if (next.category) params.set("category", next.category);
      if (next.status) params.set("status", next.status);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [router, pathname],
  );

  const loadPage = useCallback(
    async (cursor: string | null) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const page = await fetchMockJobExecutions(filters, cursor, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        setExecutions(page.executions);
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        if (err instanceof JobsForbiddenError) {
          setForbidden(true);
          setExecutions([]);
          setNextCursor(null);
        } else {
          setError("Failed to load job executions. Please try again.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    void loadPage(cursorStack[cursorIndex]);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // Re-fetch whenever filters or the current cursor change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.status, cursorIndex]);

  const handleNext = useCallback(() => {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack.slice(0, cursorIndex + 1), nextCursor]);
    setCursorIndex((index) => index + 1);
  }, [nextCursor, cursorIndex]);

  const handlePrevious = useCallback(() => {
    setCursorIndex((index) => Math.max(0, index - 1));
  }, []);

  const paginationState: PaginationState = {
    nextCursor,
    previousCursor: cursorIndex > 0 ? cursorStack[cursorIndex - 1] ?? null : null,
    isLoading: loading,
  };

  if (forbidden) {
    return (
      <div
        className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5"
        data-testid="job-monitor-forbidden"
      >
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          You do not have access to view job executions for this category.
        </p>
      </div>
    );
  }

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Job Executions</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Recent sync, anchoring, export, cleanup, and reconciliation job executions.
        </p>
      </div>

      <JobFilterBar
        category={filters.category ?? ""}
        disabled={loading && executions.length === 0}
        onChange={({ category, status }) =>
          setFilters({
            category: category || undefined,
            status: status || undefined,
          })
        }
        status={filters.status ?? ""}
      />

      {error ? (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {error}
          </p>
        </div>
      ) : null}

      <JobExecutionList executions={executions} loading={loading} />

      <CursorPagination
        onNext={handleNext}
        onPrevious={handlePrevious}
        resultCount={executions.length}
        state={paginationState}
      />
    </section>
  );
}
