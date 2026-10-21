"use client";

/**
 * Per-key last-used and activity detail view (#217).
 *
 * Expands beneath an API key row to show when the key was last used,
 * endpoint-category call counts, and outcome counts. Never renders a raw
 * IP address, request/response payload, or secret — only the bounded
 * summary `fetchMockKeyActivity` returns. Distinguishes active / stale /
 * never-used / revoked / forbidden explicitly rather than leaving a blank.
 */

import { useEffect, useState } from "react";
import {
  fetchMockKeyActivity,
  keyActivityStateLabel,
  totalOutcomeCount,
  type KeyActivityDetail,
} from "@/lib/api/key-activity";
import { formatDateTimeWithZone, formatRelativeTime } from "@/lib/i18n";

function stateBadgeClass(state: KeyActivityDetail["state"]): string {
  switch (state) {
    case "active":
      return "border-emerald-300/50 bg-emerald-300/10 text-emerald-200";
    case "stale":
      return "border-amber-300/50 bg-amber-300/10 text-amber-200";
    case "revoked":
      return "border-rose-300/50 bg-rose-300/10 text-rose-200";
    case "unavailable":
      return "border-white/10 bg-white/[0.02] text-slate-500";
    default:
      return "border-white/15 bg-white/5 text-slate-300";
  }
}

export function KeyActivityDetailView({ keyId }: { keyId: string }) {
  const [detail, setDetail] = useState<KeyActivityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      setDetail(null);
      setError(null);
      try {
        const result = await fetchMockKeyActivity(keyId, { signal: controller.signal });
        if (!cancelled) {
          setDetail(result);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load activity for this key. Please try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [keyId]);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200" role="alert">
        {error}
      </div>
    );
  }

  if (!detail) {
    return (
      <div aria-busy="true" className="rounded-md border border-white/10 bg-slate-900/40 p-3 text-sm text-slate-400">
        Loading activity…
      </div>
    );
  }

  if (detail.state === "unavailable") {
    return (
      <div
        className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-400"
        data-testid="key-activity-forbidden"
        role="status"
      >
        You do not have access to view activity for this key.
      </div>
    );
  }

  return (
    <div
      className="grid gap-3 rounded-md border border-white/10 bg-slate-900/40 p-4 text-sm"
      data-testid="key-activity-detail"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex h-6 items-center rounded border px-2 text-xs font-semibold uppercase ${stateBadgeClass(detail.state)}`}
          data-testid="key-activity-state"
        >
          {keyActivityStateLabel(detail.state)}
        </span>
        <div className="text-xs text-slate-400" data-testid="key-activity-last-used">
          {detail.lastUsedAt ? (
            <>
              Last used {formatRelativeTime(detail.lastUsedAt)} ({formatDateTimeWithZone(detail.lastUsedAt)})
            </>
          ) : (
            "Never used"
          )}
        </div>
      </div>

      {detail.categories.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-400">Endpoint categories</h4>
          <ul className="mt-2 grid gap-1">
            {detail.categories.map((category) => (
              <li
                className="flex items-center justify-between text-slate-300"
                data-testid={`key-activity-category-${category.category}`}
                key={category.category}
              >
                <span>{category.category}</span>
                <span className="font-mono text-xs text-slate-400">
                  {category.callCount} call{category.callCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-slate-400">No recorded calls for this key yet.</p>
      )}

      {totalOutcomeCount(detail.outcomes) > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-400">Outcomes</h4>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-300">{detail.outcomes.success} success</span>
            <span className="text-amber-300">{detail.outcomes.clientError} client error</span>
            <span className="text-rose-300">{detail.outcomes.serverError} server error</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
