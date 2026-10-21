import {
  parseRetryAfterMs,
  resolveRetryDelay,
  MAX_RETRY_AFTER_MS,
} from "../retry-after";

describe("parseRetryAfterMs", () => {
  const now = new Date("2026-10-21T00:00:00.000Z").getTime();

  it("returns null for a missing header", () => {
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs(undefined, now)).toBeNull();
    expect(parseRetryAfterMs("", now)).toBeNull();
  });

  it("parses delta-seconds form", () => {
    expect(parseRetryAfterMs("30", now)).toBe(30_000);
    expect(parseRetryAfterMs("0", now)).toBe(0);
  });

  it("parses HTTP-date form relative to `now`", () => {
    const future = new Date(now + 45_000).toUTCString();
    expect(parseRetryAfterMs(future, now)).toBe(45_000);
  });

  it("clamps an HTTP-date in the past to 0, not a negative number", () => {
    const past = new Date(now - 10_000).toUTCString();
    expect(parseRetryAfterMs(past, now)).toBe(0);
  });

  it("clamps a value above MAX_RETRY_AFTER_MS", () => {
    expect(parseRetryAfterMs("99999", now)).toBe(MAX_RETRY_AFTER_MS);
  });

  it("returns null for a value that is neither delta-seconds nor a valid date", () => {
    expect(parseRetryAfterMs("not-a-value", now)).toBeNull();
    expect(parseRetryAfterMs("-5", now)).toBeNull();
    expect(parseRetryAfterMs("3.5", now)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRetryAfterMs("  30  ", now)).toBe(30_000);
  });
});

describe("resolveRetryDelay", () => {
  it("prefers the server's Retry-After over the local backoff schedule", () => {
    const headers = new Headers({ "Retry-After": "5" });
    const decision = resolveRetryDelay(headers, 0, { baseDelayMs: 500 });

    expect(decision.fromServer).toBe(true);
    expect(decision.waitMs).toBe(5_000);
  });

  it("accepts a bare Response as the source", () => {
    const response = {
      headers: new Headers({ "Retry-After": "2" }),
    } as Response;
    const decision = resolveRetryDelay(response, 0);

    expect(decision.fromServer).toBe(true);
    expect(decision.waitMs).toBe(2_000);
  });

  it("falls back to exponential backoff with jitter when there is no Retry-After", () => {
    const decision = resolveRetryDelay(undefined, 2, {
      baseDelayMs: 100,
      maxDelayMs: 10_000,
    });

    expect(decision.fromServer).toBe(false);
    // attempt=2: base 100 * 2^2 = 400, jittered to [200, 400]
    expect(decision.waitMs).toBeGreaterThanOrEqual(200);
    expect(decision.waitMs).toBeLessThanOrEqual(400);
  });

  it("caps the local backoff fallback at maxDelayMs", () => {
    const decision = resolveRetryDelay(undefined, 10, {
      baseDelayMs: 1000,
      maxDelayMs: 50,
    });

    expect(decision.fromServer).toBe(false);
    expect(decision.waitMs).toBeLessThanOrEqual(50);
  });

  it("does not throw for a response-like object with no .headers", () => {
    const decision = resolveRetryDelay({} as Response, 0, { baseDelayMs: 10 });
    expect(decision.fromServer).toBe(false);
  });
});
