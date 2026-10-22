/**
 * Background job execution monitor (#219).
 * ==========================================
 *
 * Lists recent background job executions (sync, anchoring, export, cleanup,
 * reconciliation) with timing, outcome, and retry linkage (a retried
 * execution links back to the execution it retried via `retriedFromId`).
 *
 * Pagination is cursor-based, same convention as `getApiKeysPaginated` in
 * `lib/api/keys.ts`. The cursor here is an opaque, strictly-decreasing id
 * ordinal: new executions "arriving" append to the front of the full
 * fixture list but never shift the ordinal of an execution already
 * returned, so a page fetched by cursor always returns the same rows at the
 * same position relative to each other, even after new jobs arrive. That is
 * the "stable sort/cursor" approach documented here: ordering is always by
 * `startedAt` descending, ties broken by the execution's immutable
 * ordinal, and a cursor identifies an ordinal rather than an offset, so an
 * insertion at the front cannot shift it.
 *
 * Error details are redacted to a bounded category — never a raw stack
 * trace or payload — the same posture `webhook-ownership-verification.ts`
 * takes for verification diagnostics.
 *
 * There is no real backend job-execution-history endpoint yet; this is a
 * fixture-backed mock module, consistent with the rest of `lib/api/*.ts`.
 */

export type JobCategory = "sync" | "anchoring" | "export" | "cleanup" | "reconciliation";

export type JobOutcome = "succeeded" | "failed" | "cancelled";

export type JobErrorCategory =
  | "timeout"
  | "upstream-unavailable"
  | "validation-failed"
  | "conflict"
  | "unknown";

export type JobExecution = {
  /** Immutable, strictly-decreasing ordinal; the stable sort/cursor key. */
  ordinal: number;
  id: string;
  category: JobCategory;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** The execution this one retried, if any — links a retry back to its original. */
  retriedFromId: string | null;
  errorCategory: JobErrorCategory | null;
};

export type JobListFilters = {
  category?: JobCategory;
  status?: JobExecution["status"];
};

export type JobListPage = {
  executions: JobExecution[];
  nextCursor: string | null;
};

const JOB_CATEGORIES: readonly JobCategory[] = [
  "sync",
  "anchoring",
  "export",
  "cleanup",
  "reconciliation",
];

function isForbidden(filters: JobListFilters): boolean {
  return filters.category === ("forbidden" as JobCategory);
}

/** Builds the full fixture dataset: a deterministic, descending-ordinal list of executions. */
function buildFixtureExecutions(now: Date): JobExecution[] {
  const executions: JobExecution[] = [];
  let ordinal = 100;

  const push = (partial: Omit<JobExecution, "ordinal">) => {
    executions.push({ ordinal, ...partial });
    ordinal -= 1;
  };

  push({
    id: "job-100",
    category: "sync",
    status: "succeeded",
    startedAt: new Date(now.getTime() - 1000 * 60 * 1).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 30).toISOString(),
    durationMs: 60_000,
    retriedFromId: null,
    errorCategory: null,
  });
  push({
    id: "job-099",
    category: "anchoring",
    status: "succeeded",
    startedAt: new Date(now.getTime() - 1000 * 60 * 18).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 17).toISOString(),
    durationMs: 50_000,
    retriedFromId: "job-098",
    errorCategory: null,
  });
  push({
    id: "job-098",
    category: "anchoring",
    status: "failed",
    startedAt: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 19).toISOString(),
    durationMs: 45_000,
    retriedFromId: null,
    errorCategory: "upstream-unavailable",
  });
  push({
    id: "job-097",
    category: "export",
    status: "running",
    startedAt: new Date(now.getTime() - 1000 * 60 * 25).toISOString(),
    finishedAt: null,
    durationMs: null,
    retriedFromId: null,
    errorCategory: null,
  });
  push({
    id: "job-096",
    category: "cleanup",
    status: "cancelled",
    startedAt: new Date(now.getTime() - 1000 * 60 * 60).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 59).toISOString(),
    durationMs: 20_000,
    retriedFromId: null,
    errorCategory: null,
  });
  push({
    id: "job-095",
    category: "reconciliation",
    status: "failed",
    startedAt: new Date(now.getTime() - 1000 * 60 * 90).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 89).toISOString(),
    durationMs: 30_000,
    retriedFromId: null,
    errorCategory: "validation-failed",
  });
  push({
    id: "job-094",
    category: "sync",
    status: "failed",
    startedAt: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 119).toISOString(),
    durationMs: 15_000,
    retriedFromId: null,
    errorCategory: "timeout",
  });
  push({
    id: "job-093",
    category: "export",
    status: "succeeded",
    startedAt: new Date(now.getTime() - 1000 * 60 * 150).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 148).toISOString(),
    durationMs: 90_000,
    retriedFromId: null,
    errorCategory: null,
  });
  push({
    id: "job-092",
    category: "reconciliation",
    status: "succeeded",
    startedAt: new Date(now.getTime() - 1000 * 60 * 200).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 199).toISOString(),
    durationMs: 40_000,
    retriedFromId: null,
    errorCategory: null,
  });
  push({
    id: "job-091",
    category: "cleanup",
    status: "succeeded",
    startedAt: new Date(now.getTime() - 1000 * 60 * 240).toISOString(),
    finishedAt: new Date(now.getTime() - 1000 * 60 * 239).toISOString(),
    durationMs: 10_000,
    retriedFromId: null,
    errorCategory: null,
  });

  return executions;
}

const SIMULATED_LATENCY_MS = 150;
const DEFAULT_PAGE_SIZE = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchJobsOptions = {
  now?: Date;
  pageSize?: number;
  signal?: AbortSignal;
};

/**
 * Fetches a page of job executions matching `filters`, ordered by
 * `startedAt` descending (ties by ordinal). `cursor` is the ordinal of the
 * last execution on the previous page; omit for the first page.
 *
 * Stability: because the cursor is an ordinal rather than an offset, and
 * every fixture execution's ordinal is immutable once created, a new
 * execution "arriving" at the top of the list cannot change which ordinal
 * an existing cursor points to, so a page already fetched never shifts.
 */
export async function fetchMockJobExecutions(
  filters: JobListFilters,
  cursor: string | null,
  options: FetchJobsOptions = {},
): Promise<JobListPage> {
  await delay(SIMULATED_LATENCY_MS);
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (isForbidden(filters)) {
    throw new JobsForbiddenError();
  }

  const now = options.now ?? new Date();
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  let all = buildFixtureExecutions(now);
  if (filters.category) {
    all = all.filter((execution) => execution.category === filters.category);
  }
  if (filters.status) {
    all = all.filter((execution) => execution.status === filters.status);
  }
  // Already built in descending-ordinal (== descending startedAt) order.

  const startIndex = cursor
    ? all.findIndex((execution) => String(execution.ordinal) === cursor) + 1
    : 0;
  const slice = all.slice(startIndex, startIndex + pageSize);
  const nextExecution = all[startIndex + pageSize];

  return {
    executions: slice,
    nextCursor: nextExecution ? String(nextExecution.ordinal) : null,
  };
}

export class JobsForbiddenError extends Error {
  constructor() {
    super("You are not authorized to view job executions for this category.");
    this.name = "JobsForbiddenError";
    Object.setPrototypeOf(this, JobsForbiddenError.prototype);
  }
}

export function jobCategoryLabel(category: JobCategory): string {
  switch (category) {
    case "sync":
      return "Sync";
    case "anchoring":
      return "Anchoring";
    case "export":
      return "Export";
    case "cleanup":
      return "Cleanup";
    case "reconciliation":
      return "Reconciliation";
    default:
      return category;
  }
}

export function jobErrorCategoryLabel(category: JobErrorCategory): string {
  switch (category) {
    case "timeout":
      return "Timed out";
    case "upstream-unavailable":
      return "Upstream unavailable";
    case "validation-failed":
      return "Validation failed";
    case "conflict":
      return "Conflict";
    default:
      return "Unknown error";
  }
}

export { JOB_CATEGORIES };
