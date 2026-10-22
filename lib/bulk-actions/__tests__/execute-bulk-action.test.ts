import {
  BulkActionAuthorizationError,
  BulkActionStaleItemError,
  classifyOutcome,
  retryableItemIds,
  runBulkAction,
  type BulkItemOutcome,
} from "../execute-bulk-action";

describe("classifyOutcome — partial success must never be reported as full success", () => {
  it("classifies all-succeeded as full-success", () => {
    const items: BulkItemOutcome[] = [
      { itemId: "a", status: "succeeded" },
      { itemId: "b", status: "succeeded" },
    ];
    expect(classifyOutcome(items, false)).toBe("full-success");
  });

  it("classifies a mix of succeeded and failed as partial-success, not full-success", () => {
    const items: BulkItemOutcome[] = [
      { itemId: "a", status: "succeeded" },
      { itemId: "b", status: "failed", reason: "boom", retryable: true },
    ];
    expect(classifyOutcome(items, false)).toBe("partial-success");
  });

  it("classifies all-failed as full-failure", () => {
    const items: BulkItemOutcome[] = [
      { itemId: "a", status: "failed", reason: "boom", retryable: true },
    ];
    expect(classifyOutcome(items, false)).toBe("full-failure");
  });

  it("classifies a cancelled run as cancelled even if some items had already succeeded", () => {
    const items: BulkItemOutcome[] = [
      { itemId: "a", status: "succeeded" },
      { itemId: "b", status: "skipped", reason: "Cancelled before this item was attempted." },
    ];
    expect(classifyOutcome(items, true)).toBe("cancelled");
  });

  it("classifies an empty item list as full-failure, never full-success", () => {
    expect(classifyOutcome([], false)).toBe("full-failure");
  });
});

describe("runBulkAction", () => {
  it("named test: mixed authorization — items the actor cannot act on fail as non-retryable, others succeed", async () => {
    const performAction = jest.fn(async (itemId: string) => {
      if (itemId === "forbidden") {
        throw new BulkActionAuthorizationError("not allowed");
      }
    });

    const result = await runBulkAction({
      idempotencyKey: "key-1",
      itemIds: ["allowed", "forbidden"],
      performAction,
    });

    expect(result.outcome).toBe("partial-success");
    const forbiddenOutcome = result.items.find((i) => i.itemId === "forbidden");
    expect(forbiddenOutcome).toMatchObject({ status: "failed", retryable: false });
    expect(retryableItemIds(result)).toEqual([]);
  });

  it("named test: stale rows — an item that disappeared/changed server-side fails as non-retryable", async () => {
    const performAction = jest.fn(async (itemId: string) => {
      if (itemId === "stale") {
        throw new BulkActionStaleItemError();
      }
    });

    const result = await runBulkAction({
      idempotencyKey: "key-2",
      itemIds: ["fresh", "stale"],
      performAction,
    });

    expect(result.outcome).toBe("partial-success");
    const staleOutcome = result.items.find((i) => i.itemId === "stale");
    expect(staleOutcome).toMatchObject({ status: "failed", retryable: false });
    expect(retryableItemIds(result)).toEqual([]);
  });

  it("named test: cancellation — items not yet attempted at the time of cancellation are recorded as skipped, not silently dropped", async () => {
    const controller = new AbortController();
    const performAction = jest.fn(async (itemId: string) => {
      if (itemId === "first") {
        controller.abort();
      }
    });

    const result = await runBulkAction({
      idempotencyKey: "key-3",
      itemIds: ["first", "second", "third"],
      performAction,
      signal: controller.signal,
    });

    expect(result.outcome).toBe("cancelled");
    expect(result.items.find((i) => i.itemId === "first")).toMatchObject({ status: "succeeded" });
    expect(result.items.find((i) => i.itemId === "second")).toMatchObject({ status: "skipped" });
    expect(result.items.find((i) => i.itemId === "third")).toMatchObject({ status: "skipped" });
  });

  it("generic (non-authorization, non-stale) failures are marked retryable", async () => {
    const performAction = jest.fn(async () => {
      throw new Error("transient network error");
    });

    const result = await runBulkAction({
      idempotencyKey: "key-4",
      itemIds: ["a"],
      performAction,
    });

    expect(result.outcome).toBe("full-failure");
    expect(retryableItemIds(result)).toEqual(["a"]);
  });

  it("reports progress via onItemSettled for each item in order", async () => {
    const seen: number[] = [];
    const performAction = jest.fn(async () => {});

    await runBulkAction({
      idempotencyKey: "key-5",
      itemIds: ["a", "b", "c"],
      performAction,
      onItemSettled: (_item, completed) => seen.push(completed),
    });

    expect(seen).toEqual([1, 2, 3]);
  });
});
