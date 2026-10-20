"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityEventRow } from "@/components/activity/activity-event-row";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { fetchActivityEvents } from "@/lib/api/activity";
import type { ActivityEvent, ActivityFilter } from "@/lib/api/activity";

/**
 * Recent account activity view (issue #198). Frontend-only against the
 * local mock provider in `lib/api/activity.ts` — see that file's header
 * for why, and for the redaction/scoping contract this component relies
 * on already having been applied before events reach here.
 */
export function ActivityLog() {
  const [filter, setFilter] = useState<ActivityFilter>({});
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    // Effects synchronize with external systems; the actual setState calls
    // happen inside this async closure, never synchronously within the
    // effect body itself — same pattern as
    // `lib/capabilities/capability-context.tsx`'s `load()`.
    async function loadFirstPage() {
      setLoading(true);
      setError(null);

      try {
        const page = await fetchActivityEvents({ filter });
        if (requestIdRef.current !== requestId) return; // superseded by a newer filter change
        setEvents(page.events);
        setCursor(page.nextCursor);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setError("Unable to load recent activity. Please try again.");
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadFirstPage();
  }, [filter]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    setError(null);

    try {
      const page = await fetchActivityEvents({ cursor, filter });
      if (requestIdRef.current !== requestId) return;
      setEvents((previous) => [...previous, ...page.events]);
      setCursor(page.nextCursor);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setError("Unable to load more activity. Please try again.");
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingMore(false);
      }
    }
  }, [cursor, filter, loadingMore]);

  return (
    <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <ActivityFilters filter={filter} onChange={setFilter} />

      {error && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {error}
          </p>
        </div>
      )}

      {loading ? (
        <div
          className="rounded-md border border-white/10 bg-slate-950 p-4 text-center"
          role="status"
        >
          <p className="text-sm text-slate-400">Loading recent activity...</p>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
          <p className="text-sm text-slate-400">
            {filter.category || filter.outcome
              ? "No activity matches the selected filters."
              : "No recent account activity to show."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3" data-testid="activity-event-list">
          {events.map((event) => (
            <ActivityEventRow event={event} key={event.id} />
          ))}
        </div>
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
