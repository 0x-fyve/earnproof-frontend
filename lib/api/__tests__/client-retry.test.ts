/**
 * Tests for lib/api/client.ts's retry path (retryRead / RetryableApiFailure),
 * focused on Retry-After-aware delay selection (#329): a server-provided
 * Retry-After must win over the client's own exponential-backoff guess,
 * cancellation must stop a wait immediately, and the existing
 * isRetryable() classification (429/503/504 retryable, other 4xx not)
 * must be unaffected.
 */

import { isRetryable, retryRead, RetryableApiFailure } from "../client";

describe("isRetryable", () => {
  it("is unaffected by this change: still treats 429/503/504 as retryable", () => {
    expect(isRetryable(new Error("x"), { status: 429 } as Response)).toBe(true);
    expect(isRetryable(new Error("x"), { status: 503 } as Response)).toBe(true);
    expect(isRetryable(new Error("x"), { status: 504 } as Response)).toBe(true);
  });

  it("still treats other 4xx as non-retryable", () => {
    expect(isRetryable(new Error("x"), { status: 400 } as Response)).toBe(
      false,
    );
    expect(isRetryable(new Error("x"), { status: 404 } as Response)).toBe(
      false,
    );
  });

  it("still treats an aborted request as non-retryable", () => {
    expect(isRetryable(new DOMException("Aborted", "AbortError"))).toBe(false);
  });
});

describe("retryRead", () => {
  function realTimers() {
    jest.useRealTimers();
  }

  afterEach(realTimers);

  it("retries a plain retryable error using exponential backoff (no response)", async () => {
    let attempt = 0;
    const fn = jest.fn(async () => {
      attempt++;
      if (attempt < 2) {
        throw new TypeError("network down");
      }
      return "ok";
    });

    const result = await retryRead(fn, new AbortController().signal, 3, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honors the server's Retry-After over the exponential backoff schedule for a 429", async () => {
    let attempt = 0;
    const response = {
      headers: new Headers({ "Retry-After": "0" }),
    } as Response;
    const fn = jest.fn(async () => {
      attempt++;
      if (attempt < 2) {
        throw new RetryableApiFailure(new Error("429"), {
          ...response,
          status: 429,
        } as Response);
      }
      return "ok";
    });

    const start = Date.now();
    const result = await retryRead(fn, new AbortController().signal, 3, 10_000);
    const elapsed = Date.now() - start;

    expect(result).toBe("ok");
    // Retry-After: 0 means "retry immediately" — far faster than the
    // 10_000ms base exponential delay this test deliberately set, which
    // would otherwise dominate if Retry-After were ignored.
    expect(elapsed).toBeLessThan(2000);
  });

  it("unwraps RetryableApiFailure.cause when throwing a non-retryable failure", async () => {
    const cause = new Error("bad request");
    const fn = jest.fn(async () => {
      throw new RetryableApiFailure(cause, { status: 400 } as Response);
    });

    await expect(
      retryRead(fn, new AbortController().signal, 3, 1),
    ).rejects.toBe(cause);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("unwraps RetryableApiFailure.cause when exhausting retries", async () => {
    const cause = new Error("still 503");
    const fn = jest.fn(async () => {
      throw new RetryableApiFailure(cause, { status: 503 } as Response);
    });

    await expect(
      retryRead(fn, new AbortController().signal, 2, 1),
    ).rejects.toBe(cause);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops waiting immediately when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = jest.fn(async () => {
      throw new TypeError("network down");
    });

    await expect(retryRead(fn, controller.signal, 3, 1)).rejects.toThrow(
      "network down",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable plain error at all", async () => {
    const fn = jest.fn(async () => {
      throw new Error("validation failed");
    });

    await expect(
      retryRead(fn, new AbortController().signal, 3, 1),
    ).rejects.toThrow("validation failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
