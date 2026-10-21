/**
 * Per-origin client request concurrency limiter (#330).
 *
 * Bounds how many requests to the same origin can be in flight at once, so
 * a page mounting many panels (each firing its own GET) can't overwhelm a
 * constrained endpoint. Requests beyond the budget queue in priority order
 * (higher first; FIFO within the same priority) and are released as
 * in-flight slots free up.
 *
 * Observability counters track request/queue depth and wait time only —
 * never the request payload, URL, or any response data, per the issue's
 * "without recording request payloads" requirement.
 */

export type ClientRequestPriority = "high" | "normal" | "low";

const PRIORITY_RANK: Record<ClientRequestPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export interface ConcurrencyLimiterCounters {
  /** Requests currently holding a concurrency slot for this origin. */
  active: number;
  /** Requests waiting for a free slot. */
  queued: number;
  /** Total requests that have acquired a slot since creation. */
  totalAcquired: number;
  /** Total requests cancelled while queued (never ran). */
  totalCancelledWhileQueued: number;
  /** Cumulative time (ms) requests have spent queued before acquiring a slot. */
  totalQueueWaitMs: number;
}

interface QueueEntry {
  priority: ClientRequestPriority;
  enqueuedAt: number;
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class OriginLimiter {
  private active = 0;
  private readonly queue: QueueEntry[] = [];
  private readonly counters: ConcurrencyLimiterCounters = {
    active: 0,
    queued: 0,
    totalAcquired: 0,
    totalCancelledWhileQueued: 0,
    totalQueueWaitMs: 0,
  };

  constructor(private maxConcurrent: number) {}

  getCounters(): ConcurrencyLimiterCounters {
    return { ...this.counters, active: this.active, queued: this.queue.length };
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
    this.drain();
  }

  /** Acquire a slot, queueing (by priority) if the budget is exhausted. */
  async acquire(priority: ClientRequestPriority, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (this.active < this.maxConcurrent) {
      this.active += 1;
      this.counters.totalAcquired += 1;
      return () => this.release();
    }

    const enqueuedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { priority, enqueuedAt, resolve, reject };
      if (signal) {
        entry.onAbort = () => {
          const index = this.queue.indexOf(entry);
          if (index !== -1) {
            this.queue.splice(index, 1);
            this.counters.totalCancelledWhileQueued += 1;
            reject(new DOMException("Aborted", "AbortError"));
          }
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
        entry.reject = (reason: unknown) => {
          signal.removeEventListener("abort", entry.onAbort!);
          reject(reason);
        };
        const originalResolve = entry.resolve;
        entry.resolve = () => {
          signal.removeEventListener("abort", entry.onAbort!);
          originalResolve();
        };
      }
      this.enqueue(entry);
    });

    this.active += 1;
    this.counters.totalAcquired += 1;
    this.counters.totalQueueWaitMs += Date.now() - enqueuedAt;
    return () => this.release();
  }

  private enqueue(entry: QueueEntry): void {
    const rank = PRIORITY_RANK[entry.priority];
    const insertAt = this.queue.findIndex((q) => PRIORITY_RANK[q.priority] > rank);
    if (insertAt === -1) {
      this.queue.push(entry);
    } else {
      this.queue.splice(insertAt, 0, entry);
    }
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      next.resolve();
    }
  }
}

const DEFAULT_MAX_CONCURRENT_PER_ORIGIN = 6;

const limiters = new Map<string, OriginLimiter>();

function originKey(url: string): string {
  try {
    return new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin).origin;
  } catch {
    // Relative/malformed URL — treat the raw string as its own bucket
    // rather than throwing, so a bad URL fails at the fetch layer, not here.
    return url;
  }
}

function getLimiter(url: string): OriginLimiter {
  const key = originKey(url);
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new OriginLimiter(DEFAULT_MAX_CONCURRENT_PER_ORIGIN);
    limiters.set(key, limiter);
  }
  return limiter;
}

/**
 * Run `execute` once a concurrency slot for `url`'s origin is available.
 * Queues (by `priority`) when the per-origin budget is exhausted. If
 * `signal` aborts while queued, the wait is cancelled and never starts
 * `execute`; if it aborts after starting, cancellation is left to
 * `execute`/the caller's own signal handling — this limiter only owns the
 * queueing, not the request itself.
 */
export async function withConcurrencyLimit<T>(
  url: string,
  execute: () => Promise<T>,
  options: { priority?: ClientRequestPriority; signal?: AbortSignal } = {},
): Promise<T> {
  const limiter = getLimiter(url);
  const release = await limiter.acquire(options.priority ?? "normal", options.signal);
  try {
    return await execute();
  } finally {
    release();
  }
}

/** Observability snapshot for the origin a given URL belongs to (#330). */
export function getConcurrencyCounters(url: string): ConcurrencyLimiterCounters {
  return getLimiter(url).getCounters();
}

/** Override the per-origin concurrency budget (default: 6). */
export function setMaxConcurrentPerOrigin(url: string, max: number): void {
  getLimiter(url).setMaxConcurrent(max);
}

/** Test/reset helper: drop all tracked origin limiters and their counters. */
export function clearConcurrencyLimiters(): void {
  limiters.clear();
}
