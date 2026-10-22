"use client";

/**
 * Filter bar for the background job execution monitor (#219).
 *
 * Category/status filter state is owned by the parent (`JobExecutionMonitor`)
 * and mirrored into the URL via `useSearchParams`/`router.replace`, the same
 * convention `AuditLogManagement` uses for its filters.
 */

import { JOB_CATEGORIES, jobCategoryLabel, type JobCategory, type JobExecution } from "@/lib/api/jobs";

const STATUSES: readonly JobExecution["status"][] = ["running", "succeeded", "failed", "cancelled"];

export interface JobFilterBarProps {
  category: JobCategory | "";
  status: JobExecution["status"] | "";
  onChange: (next: { category: JobCategory | ""; status: JobExecution["status"] | "" }) => void;
  disabled?: boolean;
}

export function JobFilterBar({ category, status, onChange, disabled }: JobFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-4" role="group" aria-label="Job execution filters">
      <label className="grid gap-1 text-sm text-slate-300">
        <span>Category</span>
        <select
          className="h-9 w-fit rounded-md border border-white/15 bg-slate-900/40 px-3 text-sm text-white"
          disabled={disabled}
          onChange={(event) =>
            onChange({ category: event.target.value as JobCategory | "", status })
          }
          value={category}
        >
          <option value="">All categories</option>
          {JOB_CATEGORIES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {jobCategoryLabel(candidate)}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm text-slate-300">
        <span>Status</span>
        <select
          className="h-9 w-fit rounded-md border border-white/15 bg-slate-900/40 px-3 text-sm text-white"
          disabled={disabled}
          onChange={(event) =>
            onChange({ category, status: event.target.value as JobExecution["status"] | "" })
          }
          value={status}
        >
          <option value="">All statuses</option>
          {STATUSES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
