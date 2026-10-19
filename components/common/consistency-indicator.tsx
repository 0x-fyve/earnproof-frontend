"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/common/production-ui";
import type { ResourceConsistencyState } from "@/lib/query/read-after-write";

export interface ConsistencyIndicatorProps {
  /** Consistency state for the resource being viewed. */
  state: ResourceConsistencyState<unknown> | null;
  /** Viewer's active organization ID; cross-tenant states are rejected and never rendered. */
  viewerOrganizationId: string;
  /** Expected resource type for this view; mismatched resource states are ignored. */
  expectedResourceType?: string;
  /** Expected resource ID for this view; mismatched resource states are ignored. */
  expectedResourceId?: string;
  /** Retry callback invoked when the user clicks Retry Check. */
  onRetryRead?: () => void;
  /** Human-readable label for the resource (e.g. "Organization policy"). */
  resourceLabel?: string;
}

/**
 * Displays bounded pending-propagation states and expired-window support
 * guidance for read-after-write consistency (#256).
 *
 * Clears automatically as soon as `state.status === "consistent"` (when the
 * expected resource version has been observed).
 */
export function ConsistencyIndicator({
  state,
  viewerOrganizationId,
  expectedResourceType,
  expectedResourceId,
  onRetryRead,
  resourceLabel = "Resource",
}: ConsistencyIndicatorProps) {
  if (!state) return null;

  // Fail closed on cross-tenant or mismatched-resource state
  if (
    !viewerOrganizationId ||
    state.organizationId !== viewerOrganizationId
  ) {
    return null;
  }

  if (
    expectedResourceType &&
    state.resourceType !== expectedResourceType
  ) {
    return null;
  }

  if (
    expectedResourceId &&
    state.resourceId !== expectedResourceId
  ) {
    return null;
  }

  // Indicator clears once expected version is observed (status === "consistent") or when idle
  if (
    state.status === "consistent" ||
    state.status === "idle" ||
    state.status === "optimistic-pending"
  ) {
    return null;
  }

  const correlationId = state.consistencyToken?.correlationId ?? null;

  if (state.status === "pending-propagation") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="consistency-pending-banner"
        className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-4 text-sm text-cyan-100"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="accent">Syncing replicas</StatusBadge>
            <span className="font-semibold text-white">
              {resourceLabel} update confirmed (target v{state.expectedVersion})
            </span>
          </div>

          {onRetryRead && (
            <button
              type="button"
              onClick={onRetryRead}
              className="h-8 rounded border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
            >
              Check replica status
            </button>
          )}
        </div>

        <p className="mt-2 text-xs leading-5 text-cyan-100/90">
          Your change has been committed and is propagating to read replicas
          (observed replica v{state.observedReplicaVersion} of expected v
          {state.expectedVersion}). Confirmed local results are locked to
          prevent stale reads from overwriting your update.
        </p>
      </div>
    );
  }

  // status === "expired"
  return (
    <div
      role="alert"
      data-testid="consistency-expired-banner"
      className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning">Propagation delayed</StatusBadge>
          <span className="font-semibold text-white">
            {resourceLabel} replica propagation window expired
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onRetryRead && (
            <button
              type="button"
              onClick={onRetryRead}
              className="h-8 rounded bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Retry consistency check
            </button>
          )}
          <Link
            href="/status"
            className="inline-flex h-8 items-center rounded border border-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/5"
          >
            System Status
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-8 items-center rounded border border-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/5"
          >
            Contact Support
          </Link>
        </div>
      </div>

      <p className="mt-2 text-xs leading-5 text-amber-100/90">
        Read replicas have not yet reported version v{state.expectedVersion}{" "}
        (last observed v{state.observedReplicaVersion}). Your confirmed local
        result remains preserved so your changes are not lost. Retry the check
        or contact support if replica lag persists.
        {correlationId && (
          <>
            {" "}
            Support reference:{" "}
            <code className="font-mono text-amber-200">{correlationId}</code>
          </>
        )}
      </p>
    </div>
  );
}
