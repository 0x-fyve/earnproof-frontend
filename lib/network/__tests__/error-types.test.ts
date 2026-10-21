import {
  classifyNetworkFailure,
  canRetry,
  type NetworkFailure,
} from "../error-types";

describe("error-types", () => {
  describe("classifyNetworkFailure", () => {
    it("classifies offline failures (TypeError with no response)", () => {
      const error = new TypeError("Failed to fetch");
      const failure = classifyNetworkFailure(error);

      expect(failure.type).toBe("offline");
      expect(failure.retryable).toBe(true);
      expect(failure.message).toContain("internet connection");
    });

    it("classifies timeout failures (TimeoutError)", () => {
      const error = new DOMException("Timeout", "TimeoutError");
      const failure = classifyNetworkFailure(error);

      expect(failure.type).toBe("timeout");
      expect(failure.retryable).toBe(true);
      expect(failure.message).toContain("timed out");
    });

    it("classifies cancelled failures (AbortError)", () => {
      const error = new DOMException("Aborted", "AbortError");
      const failure = classifyNetworkFailure(error);

      expect(failure.type).toBe("cancelled");
      expect(failure.retryable).toBe(false);
    });

    it("classifies 401 as auth failure", () => {
      const error = new Error("Unauthorized");
      const response = { status: 401 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("auth-failure");
      expect(failure.retryable).toBe(false);
      expect(failure.statusCode).toBe(401);
    });

    it("classifies 403 as auth failure", () => {
      const error = new Error("Forbidden");
      const response = { status: 403 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("auth-failure");
      expect(failure.retryable).toBe(false);
      expect(failure.statusCode).toBe(403);
    });

    it("classifies 5xx as server error", () => {
      const error = new Error("Server Error");
      const response = { status: 500 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("server-error");
      expect(failure.retryable).toBe(true);
      expect(failure.statusCode).toBe(500);
    });

    it("classifies 503 Service Unavailable specifically", () => {
      const error = new Error("Service Unavailable");
      const response = { status: 503 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("server-error");
      expect(failure.message).toContain("maintenance");
    });

    it("classifies 504 Gateway Timeout specifically", () => {
      const error = new Error("Gateway Timeout");
      const response = { status: 504 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("server-error");
      expect(failure.message).toContain("upstream");
    });

    it("classifies 4xx validation errors (except 401/403)", () => {
      const error = new Error("Bad Request");
      const response = { status: 400 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("validation-error");
      expect(failure.retryable).toBe(false);
    });

    it("classifies 429 as its own rate-limited type, retryable", () => {
      const error = new Error("Too Many Requests");
      const response = { status: 429 };
      const failure = classifyNetworkFailure(error, response);

      expect(failure.type).toBe("rate-limited");
      expect(failure.retryable).toBe(true);
      expect(failure.statusCode).toBe(429);
    });

    it("classifies unknown errors as unknown", () => {
      const error = new Error("Something else");
      const failure = classifyNetworkFailure(error);

      expect(failure.type).toBe("unknown");
      expect(failure.retryable).toBe(false);
    });
  });

  describe("canRetry", () => {
    const createFailure = (type: string): NetworkFailure => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: type as any,
      message: "test",
      originalError: new Error("test"),
      retryable: true,
    });

    it("allows retry for offline failures with idempotent ops", () => {
      const failure = createFailure("offline");
      expect(canRetry(failure, true)).toBe(true);
    });

    it("allows retry for offline failures without idempotency if op is safe", () => {
      const failure = createFailure("offline");
      expect(canRetry(failure, false)).toBe(true);
    });

    it("allows retry for server errors", () => {
      const failure = createFailure("server-error");
      expect(canRetry(failure, true)).toBe(true);
      expect(canRetry(failure, false)).toBe(true);
    });

    it("allows retry for rate-limited failures regardless of idempotency", () => {
      // canRetry itself doesn't gate on mutation safety — that's a
      // separate check in retry-orchestrator.ts's isMutationSafeToRetry,
      // which callers must combine with this.
      const failure = createFailure("rate-limited");
      expect(canRetry(failure, true)).toBe(true);
      expect(canRetry(failure, false)).toBe(true);
    });

    it("allows retry for timeouts only if idempotent", () => {
      const failure = createFailure("timeout");
      expect(canRetry(failure, true)).toBe(true);
      expect(canRetry(failure, false)).toBe(false);
    });

    it("never allows retry for cancelled requests", () => {
      const failure = createFailure("cancelled");
      expect(canRetry(failure, true)).toBe(false);
      expect(canRetry(failure, false)).toBe(false);
    });

    it("never allows retry for auth failures", () => {
      const failure = createFailure("auth-failure");
      expect(canRetry(failure, true)).toBe(false);
    });

    it("never allows retry for validation errors", () => {
      const failure = createFailure("validation-error");
      expect(canRetry(failure, true)).toBe(false);
    });
  });
});
