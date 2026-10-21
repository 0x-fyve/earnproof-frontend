import {
  withConcurrencyLimit,
  getConcurrencyCounters,
  setMaxConcurrentPerOrigin,
  clearConcurrencyLimiters,
} from "../concurrency-limiter";

const ORIGIN_A = "https://api-a.example.com/resource";
const ORIGIN_B = "https://api-b.example.com/resource";

describe("concurrency-limiter (#330)", () => {
  afterEach(() => {
    clearConcurrencyLimiters();
  });

  it("runs requests immediately while under the per-origin budget", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 6);
    const result = await withConcurrencyLimit(ORIGIN_A, async () => "ok");
    expect(result).toBe("ok");
  });

  it("queues requests beyond the per-origin concurrency budget", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 2);

    const order: number[] = [];
    let release1: () => void = () => undefined;
    let release2: () => void = () => undefined;

    const p1 = withConcurrencyLimit(ORIGIN_A, () => new Promise<void>((resolve) => { release1 = resolve; })).then(() => order.push(1));
    const p2 = withConcurrencyLimit(ORIGIN_A, () => new Promise<void>((resolve) => { release2 = resolve; })).then(() => order.push(2));
    const p3 = withConcurrencyLimit(ORIGIN_A, async () => order.push(3));

    // Give the microtask queue a tick so p1/p2 have acquired their slots.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getConcurrencyCounters(ORIGIN_A).active).toBe(2);
    expect(getConcurrencyCounters(ORIGIN_A).queued).toBe(1);

    release1();
    await p1;
    await p3; // p3 should now have acquired the freed slot
    release2();
    await p2;

    expect(order[0]).toBe(1);
    expect(order).toContain(3);
  });

  it("tracks independent budgets per origin", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 1);
    setMaxConcurrentPerOrigin(ORIGIN_B, 1);

    let releaseA: () => void = () => undefined;
    const pA = withConcurrencyLimit(ORIGIN_A, () => new Promise<void>((resolve) => { releaseA = resolve; }));

    // A second origin's request must not be blocked by origin A's exhausted budget.
    const resultB = await withConcurrencyLimit(ORIGIN_B, async () => "b-ok");
    expect(resultB).toBe("b-ok");

    releaseA();
    await pA;
  });

  it("releases the queued request's promise with an AbortError when its signal aborts before a slot frees", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 1);

    let releaseHeld: () => void = () => undefined;
    const held = withConcurrencyLimit(ORIGIN_A, () => new Promise<void>((resolve) => { releaseHeld = resolve; }));

    const controller = new AbortController();
    const queued = withConcurrencyLimit(ORIGIN_A, async () => "should not run", {
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    releaseHeld();
    await held;
  });

  it("services higher-priority requests before lower-priority ones queued earlier", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 1);

    const order: string[] = [];
    let releaseHeld: () => void = () => undefined;
    const held = withConcurrencyLimit(ORIGIN_A, () => new Promise<void>((resolve) => { releaseHeld = resolve; }));

    const low = withConcurrencyLimit(ORIGIN_A, async () => { order.push("low"); }, { priority: "low" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const high = withConcurrencyLimit(ORIGIN_A, async () => { order.push("high"); }, { priority: "high" });

    releaseHeld();
    await held;
    await Promise.all([low, high]);

    expect(order).toEqual(["high", "low"]);
  });

  it("exposes observability counters without recording request payloads or URLs beyond the origin key", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 5);
    await withConcurrencyLimit(ORIGIN_A, async () => "ok");
    await withConcurrencyLimit(ORIGIN_A, async () => "ok");

    const counters = getConcurrencyCounters(ORIGIN_A);
    expect(counters.totalAcquired).toBe(2);
    expect(counters.active).toBe(0);
    expect(counters.queued).toBe(0);
    // Counters are a flat numeric snapshot — no payload/body/header fields exist.
    expect(Object.keys(counters).sort()).toEqual(
      ["active", "queued", "totalAcquired", "totalCancelledWhileQueued", "totalQueueWaitMs"].sort(),
    );
  });

  it("counts requests cancelled while queued separately from requests that ran", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 1);

    let releaseHeld: () => void = () => undefined;
    const held = withConcurrencyLimit(ORIGIN_A, () => new Promise<void>((resolve) => { releaseHeld = resolve; }));

    const controller = new AbortController();
    const queued = withConcurrencyLimit(ORIGIN_A, async () => "x", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    expect(getConcurrencyCounters(ORIGIN_A).totalCancelledWhileQueued).toBe(1);

    releaseHeld();
    await held;
  });

  it("releases the slot even if execute() throws, so a failed request doesn't leak a slot", async () => {
    setMaxConcurrentPerOrigin(ORIGIN_A, 1);

    await expect(
      withConcurrencyLimit(ORIGIN_A, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(getConcurrencyCounters(ORIGIN_A).active).toBe(0);

    // A follow-up request must be able to acquire the slot immediately.
    const result = await withConcurrencyLimit(ORIGIN_A, async () => "ok");
    expect(result).toBe("ok");
  });
});
