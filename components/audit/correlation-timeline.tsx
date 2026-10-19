"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/i18n";
import {
  formatCorrelationLinkStatus,
  redactEventActor,
  safeEventSummary,
  type CorrelationTimelineResult,
} from "@/lib/audit/correlation-explorer";

const CATEGORY_STYLES: Record<string, string> = {
  request: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  job: "border-violet-300/30 bg-violet-300/10 text-violet-200",
  webhook: "border-amber-300/30 bg-amber-300/10 text-amber-200",
  anchoring: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  unknown: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

/**
 * Renders a correlation-id-based causal timeline for an audit explorer
 * (#243). Takes an already-built `CorrelationTimelineResult` (built by
 * `buildCorrelationTimeline` from entries the caller already scoped to
 * their own tenant) and a redaction toggle that defaults on, matching
 * `AuditLogExport`'s existing `redactActors` default.
 *
 * Keyboard navigation: each timeline row is a focusable button
 * (`role="listitem"` would not be independently focusable), so arrow-key
 * users can move through the causal sequence without a mouse.
 */
export function CorrelationTimeline({
  result,
  redactActors = true,
}: {
  result: CorrelationTimelineResult;
  redactActors?: boolean;
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  if (result.status !== "available") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4" role="status">
        <h3 className="text-sm font-semibold text-white">{formatCorrelationLinkStatus(result.status)}</h3>
        <p className="mt-1 text-xs text-slate-400">{result.message}</p>
      </div>
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" && index < result.entries.length - 1) {
      event.preventDefault();
      setFocusedIndex(index + 1);
      const next = document.getElementById(`correlation-entry-${result.correlationId}-${index + 1}`);
      next?.focus();
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      setFocusedIndex(index - 1);
      const prev = document.getElementById(`correlation-entry-${result.correlationId}-${index - 1}`);
      prev?.focus();
    }
  }

  return (
    <div
      aria-label={`Correlated events for ${result.correlationId}`}
      className="grid gap-2"
      role="list"
    >
      {result.entries.map((entry, index) => {
        const redacted = redactEventActor(entry.event, redactActors);
        const summary = safeEventSummary(redacted);
        const deepLinkHref = `/settings/audit?correlationId=${encodeURIComponent(result.correlationId)}&entryId=${encodeURIComponent(entry.event.id)}`;

        return (
          <button
            aria-current={focusedIndex === index}
            className={`grid gap-1 rounded-md border p-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${CATEGORY_STYLES[summary.category] ?? CATEGORY_STYLES.unknown}`}
            id={`correlation-entry-${result.correlationId}-${index}`}
            key={entry.event.id}
            onClick={() => setFocusedIndex(index)}
            onFocus={() => setFocusedIndex(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="listitem"
            tabIndex={0}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase">{summary.category}</span>
              <span className="text-xs text-slate-400">{formatDateTime(summary.occurredAt)}</span>
            </div>
            <p className="truncate text-xs text-slate-200">{summary.action}</p>
            <p className="truncate text-xs text-slate-400">{summary.resource}</p>
            {!entry.renderableRaw && (
              <p className="text-xs text-amber-200" role="note">
                This event uses a newer schema version. Only safe summary fields are shown.
              </p>
            )}
            <a
              className="mt-1 w-fit text-xs text-cyan-300 underline hover:text-cyan-200"
              href={deepLinkHref}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              View in audit log
            </a>
          </button>
        );
      })}
    </div>
  );
}
