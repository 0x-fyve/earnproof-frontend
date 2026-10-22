"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityEventRow } from "@/components/activity/activity-event-row";
import { ActivityFilters } from "@/components/activity/activity-filters";
import {
  ActivityRequestError,
  fetchActivityEvents,
  type ActivityErrorKind,
  type ActivityEvent,
  type ActivityFilter,
} from "@/lib/api/activity";
import { clearStoredSession, readStoredSession, subscribeSession } from "@/lib/session";

/**
 * Recent account activity view, backed by the versioned `GET /activity`
 * endpoint (`lib/api/activity.ts` documents the contract, redaction and
 * validation this component relies on).
 *
 * Deterministic states:
 * - no in-memory session: "sign in" panel, nothing fetched, nothing shown
 * - 401: the session is cleared (every tab) and the sign-in panel replaces the list
 * - 403 / 404 / 501: a terminal panel with no retry, because retrying cannot help
 * - other failures: an alert carrying the request reference, with a retry button
 * - a filter change, sign-out or unmount aborts in-flight requests, and a
 *   response that arrives after that is ignored
 */

const sessionTokenSnapshot = () => readStoredSession()?.token ?? null;
const serverSnapshot = () => null;

type Failure = { kind: ActivityErrorKind; message: string; requestId: string | null };

function toFailure(error: unknown, fallback: string): Failure {
  if (error instanceof ActivityRequestError) {
    return { kind: error.kind, message: error.message, requestId: error.requestId || null };
  }
  return { kind: "failed", message: fallback, requestId: null };
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function ActivityLog() {
  const token = useSyncExternalStore(subscribeSession, sessionTokenSnapshot, serverSnapshot);

  const [filter, setFilter] = useState<ActivityFilter>({});
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const handleFailure = useCallback((error: unknown, fallback: string) => {
    const next = toFailure(error, fallback);
    if (next.kind === "unauthorized") {
      // Ends the session in this tab and tells the others; the sign-in panel takes over.
      clearStoredSession("unauthorized");
    }
    setFailure(next);
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;

    if (!token) {
      // Signed out (or never signed in): drop whatever was on screen.
      // Deferred like the loader below so no state is set synchronously in the effect.
      void Promise.resolve().then(() => {
        setEvents([]);
        setCursor(null);
        setFailure(null);
        setDroppedCount(0);
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
      setEvents([]);
      setCursor(null);
      setDroppedCount(0);

      try {
        const page = await fetchActivityEvents({ token: sessionToken, filter, signal: controller.signal });
        if (controller.signal.aborted) return;
        setEvents(page.events);
        setCursor(page.nextCursor);
        setDroppedCount(page.droppedCount);
      } catch (error) {
        if (isAbort(error, controller.signal)) return;
        handleFailure(error, "Unable to load recent activity. Please try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadFirstPage(token);

    return () => controller.abort();
  }, [token, filter, reloadKey, handleFailure]);

  const loadMore = useCallback(async () => {
    const controller = controllerRef.current;
    if (!token || !cursor || loadingMore || !controller || controller.signal.aborted) return;

    setLoadingMore(true);
    setFailure(null);

    try {
      const page = await fetchActivityEvents({ token, cursor, filter, signal: controller.signal });
      if (controller.signal.aborted) return;
      setEvents((previous) => {
        const known = new Set(previous.map((event) => event.id));
        return [...previous, ...page.events.filter((event) => !known.has(event.id))];
      });
      setCursor(page.nextCursor);
      setDroppedCount((previous) => previous + page.droppedCount);
    } catch (error) {
      if (isAbort(error, controller.signal)) return;
      handleFailure(error, "Unable to load more activity. Please try again.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [token, cursor, filter, loadingMore, handleFailure]);

  if (!token) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5" role="status">
        <p className="text-sm font-medium text-white">Sign in to view account activity</p>
        <p className="mt-1 text-sm text-slate-400">
          Account activity is only shown for a signed-in wallet. Connect your wallet and sign the
          challenge to continue.
        </p>
      </div>
    );
  }

  if (failure && (failure.kind === "forbidden" || failure.kind === "unavailable")) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5" role="status">
        <p className="text-sm font-medium text-white">
          {failure.kind === "forbidden" ? "Activity access denied" : "Activity log unavailable"}
        </p>
        <p className="mt-1 text-sm text-amber-100">{failure.message}</p>
        {failure.requestId && (
          <p className="mt-2 text-xs text-slate-400">Reference: {failure.requestId}</p>
        )}
      </div>
    );
  }

  const filtered = Boolean(filter.category || filter.outcome);
  const retryable = failure !== null && events.length === 0 && !loading;

  return (
    <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <ActivityFilters filter={filter} onChange={setFilter} />

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

      {loading ? (
        <div
          className="rounded-md border border-white/10 bg-slate-950 p-4 text-center"
          role="status"
        >
          <p className="text-sm text-slate-400">Loading recent activity...</p>
        </div>
      ) : events.length === 0 ? (
        !failure && (
          <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
            <p className="text-sm text-slate-400">
              {filtered
                ? "No activity matches the selected filters."
                : "No recent account activity to show."}
            </p>
          </div>
        )
      ) : (
        <div className="grid gap-3" data-testid="activity-event-list">
          {events.map((event) => (
            <ActivityEventRow event={event} key={event.id} />
          ))}
        </div>
      )}

      {droppedCount > 0 && (
        <p className="text-xs text-slate-500" data-testid="activity-dropped-note">
          {droppedCount === 1
            ? "1 entry could not be displayed."
            : `${droppedCount} entries could not be displayed.`}
        </p>
      )}

      <p aria-live="polite" className="sr-only" role="status">
        {!loading && events.length > 0 ? `Showing ${events.length} events.` : ""}
      </p>

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
