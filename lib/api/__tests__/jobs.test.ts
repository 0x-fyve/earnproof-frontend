import {
  JobsForbiddenError,
  fetchMockJobExecutions,
  jobCategoryLabel,
  jobErrorCategoryLabel,
} from "../jobs";

describe("jobs: ordering", () => {
  it("returns executions ordered by startedAt descending", async () => {
    const page = await fetchMockJobExecutions({}, null, { pageSize: 20 });
    const timestamps = page.executions.map((execution) => new Date(execution.startedAt).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});

describe("jobs: filters", () => {
  it("filters by category", async () => {
    const page = await fetchMockJobExecutions({ category: "anchoring" }, null, { pageSize: 20 });
    expect(page.executions.length).toBeGreaterThan(0);
    expect(page.executions.every((execution) => execution.category === "anchoring")).toBe(true);
  });

  it("filters by status", async () => {
    const page = await fetchMockJobExecutions({ status: "failed" }, null, { pageSize: 20 });
    expect(page.executions.length).toBeGreaterThan(0);
    expect(page.executions.every((execution) => execution.status === "failed")).toBe(true);
  });

  it("combines category and status filters", async () => {
    const page = await fetchMockJobExecutions(
      { category: "anchoring", status: "failed" },
      null,
      { pageSize: 20 },
    );
    expect(page.executions.every((e) => e.category === "anchoring" && e.status === "failed")).toBe(
      true,
    );
  });
});

describe("jobs: pagination stability", () => {
  it("does not shift an already-fetched page when more items are requested afterward", async () => {
    const firstPage = await fetchMockJobExecutions({}, null, { pageSize: 3 });
    expect(firstPage.executions).toHaveLength(3);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await fetchMockJobExecutions({}, firstPage.nextCursor, { pageSize: 3 });
    expect(secondPage.executions.length).toBeGreaterThan(0);
    // No overlap between pages.
    const firstIds = new Set(firstPage.executions.map((e) => e.id));
    expect(secondPage.executions.every((e) => !firstIds.has(e.id))).toBe(true);
  });

  it("returns a null nextCursor once the last page is reached", async () => {
    const page = await fetchMockJobExecutions({}, null, { pageSize: 100 });
    expect(page.nextCursor).toBeNull();
  });
});

describe("jobs: retries", () => {
  it("links a retried execution back to the execution it retried", async () => {
    const page = await fetchMockJobExecutions({ category: "anchoring" }, null, { pageSize: 20 });
    const retry = page.executions.find((execution) => execution.retriedFromId !== null);
    expect(retry).toBeDefined();
    expect(page.executions.some((execution) => execution.id === retry?.retriedFromId)).toBe(true);
  });
});

describe("jobs: error redaction", () => {
  it("exposes only a bounded error category for failed executions, never a raw message", async () => {
    const page = await fetchMockJobExecutions({ status: "failed" }, null, { pageSize: 20 });
    for (const execution of page.executions) {
      expect(execution.errorCategory).not.toBeNull();
      expect(jobErrorCategoryLabel(execution.errorCategory!)).toBeTruthy();
    }
  });
});

describe("jobs: forbidden category", () => {
  it("rejects with JobsForbiddenError and returns no data", async () => {
    await expect(
      fetchMockJobExecutions({ category: "forbidden" as never }, null),
    ).rejects.toBeInstanceOf(JobsForbiddenError);
  });
});

describe("jobs: labels", () => {
  it("has a label for every category", () => {
    expect(jobCategoryLabel("sync")).toBe("Sync");
    expect(jobCategoryLabel("anchoring")).toBe("Anchoring");
    expect(jobCategoryLabel("export")).toBe("Export");
    expect(jobCategoryLabel("cleanup")).toBe("Cleanup");
    expect(jobCategoryLabel("reconciliation")).toBe("Reconciliation");
  });
});

describe("jobs: abort handling", () => {
  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchMockJobExecutions({}, null, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
