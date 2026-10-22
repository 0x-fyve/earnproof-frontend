"use client";

/**
 * Job execution list for the background job monitor (#219).
 *
 * Renders executions in the order the API returned them (`startedAt`
 * descending, stable across pagination) with timing, outcome, and a link
 * from a retried execution back to the execution it retried. Error details
 * are rendered only as the bounded `errorCategory`, never a raw message.
 */

import { StatusBadge } from "@/components/common/production-ui";
import {
  jobCategoryLabel,
  jobErrorCategoryLabel,
  type JobExecution,
} from "@/lib/api/jobs";
import { formatDateTimeWithZone, formatRelativeTime } from "@/lib/i18n";

function statusTone(status: JobExecution["status"]): "success" | "warning" | "accent" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "warning";
    default:
      return "accent";
  }
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export interface JobExecutionListProps {
  executions: JobExecution[];
  loading: boolean;
}

export function JobExecutionList({ executions, loading }: JobExecutionListProps) {
  if (!loading && executions.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
        <p className="text-sm text-slate-400">No job executions match these filters.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid="job-execution-list">
      <div className="hidden grid-cols-[1fr_1fr_1.5fr_1fr_1.5fr] gap-4 border-b border-white/10 pb-2 text-xs font-semibold uppercase text-slate-400 md:grid">
        <div>Category</div>
        <div>Status</div>
        <div>Started</div>
        <div>Duration</div>
        <div>Detail</div>
      </div>

      {executions.map((execution) => (
        <div
          className="grid gap-3 rounded-md border border-white/10 bg-slate-950 p-4 text-sm md:grid-cols-[1fr_1fr_1.5fr_1fr_1.5fr] md:items-center md:gap-4"
          data-testid={`job-execution-${execution.id}`}
          key={execution.id}
        >
          <div className="font-medium text-white">{jobCategoryLabel(execution.category)}</div>
          <div>
            <StatusBadge tone={statusTone(execution.status)}>{execution.status}</StatusBadge>
          </div>
          <div className="min-w-0 font-mono text-xs text-slate-300">
            {formatRelativeTime(execution.startedAt)} ({formatDateTimeWithZone(execution.startedAt)})
          </div>
          <div className="text-slate-400">{formatDuration(execution.durationMs)}</div>
          <div className="text-slate-300">
            {execution.status === "failed" && execution.errorCategory ? (
              <span className="text-rose-300" data-testid={`job-error-${execution.id}`}>
                {jobErrorCategoryLabel(execution.errorCategory)}
              </span>
            ) : null}
            {execution.retriedFromId ? (
              <div className="text-xs text-cyan-200" data-testid={`job-retry-link-${execution.id}`}>
                Retry of {execution.retriedFromId}
              </div>
            ) : null}
            {execution.status !== "failed" && !execution.retriedFromId ? (
              <span className="text-slate-500">—</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
