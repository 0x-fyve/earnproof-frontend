import {
  isMutationSafeToRetry,
  shouldExposeRetry,
  getRecoveryAction,
  executeWithRetry,
  type RetryableRequest,
} from "../retry-orchestrator";
import { ApiNetworkError } from "../api-error";

describe("retry-orchestrator", () => {
  describe("isMutationSafeToRetry", () => {
    it("allows retry for GET requests", () => {
      const request: RetryableRequest = {
        method: "GET",
        hasIdempotencyContract: false,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(true);
    });

    it("allows retry for HEAD requests", () => {
      const request: RetryableRequest = {
        method: "HEAD",
        hasIdempotencyContract: false,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(true);
    });

    it("allows retry for DELETE requests", () => {
      const request: RetryableRequest = {
        method: "DELETE",
        hasIdempotencyContract: false,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(true);
    });

    it("allows retry for POST with idempotency contract", () => {
      const request: RetryableRequest = {
        method: "POST",
        hasIdempotencyContract: true,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(true);
    });

    it("forbids retry for POST without idempotency contract", () => {
      const request: RetryableRequest = {
        method: "POST",
        hasIdempotencyContract: false,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(false);
    });

    it("forbids retry for PUT without idempotency contract", () => {
      const request: RetryableRequest = {
        method: "PUT",
        hasIdempotencyContract: false,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(false);
    });

    it("forbids retry for PATCH without idempotency contract", () => {
      const request: RetryableRequest = {
        method: "PATCH",
        hasIdempotencyContract: false,
        execute: jest.fn(),
      };
      expect(isMutationSafeToRetry(request)).toBe(false);
    });
  });

  describe("shouldExposeRetry", () => {
    const createRequest = (
      method = "GET",
      hasIdempotency = false,
    ): RetryableRequest => ({
      method,
      hasIdempotencyContract: hasIdempotency,
      execute: jest.fn(),
    });

    it("exposes retry for idempotent GET with offline failure", () => {
      const request = createRequest("GET");
      const error = new ApiNetworkError(new TypeError("offline"));

      expect(shouldExposeRetry(request, error)).toBe(true);
    });

    it("exposes retry for idempotent POST with server error", () => {
      const request = createRequest("POST", true);
      const error = new ApiNetworkError(new Error("5xx"), { status: 500 });

      expect(shouldExposeRetry(request, error)).toBe(true);
    });

    it("never exposes retry for auth failure", () => {
      const request = createRequest("GET");
      const error = new ApiNetworkError(new Error("401"), { status: 401 });

      expect(shouldExposeRetry(request, error)).toBe(false);
    });

    it("never exposes retry for validation error", () => {
      const request = createRequest("GET");
      const error = new ApiNetworkError(new Error("400"), { status: 400 });

      expect(shouldExposeRetry(request, error)).toBe(false);
    });

    it("never exposes retry for cancelled request", () => {
      const request = createRequest("GET");
      const error = new ApiNetworkError(
        new DOMException("Aborted", "AbortError"),
      );

      expect(shouldExposeRetry(request, error)).toBe(false);
    });

    it("forbids retry for non-idempotent POST", () => {
      const request = createRequest("POST", false);
      const error = new ApiNetworkError(new TypeError("offline"));

      expect(shouldExposeRetry(request, error)).toBe(false);
    });
  });

  describe("getRecoveryAction", () => {
    it("returns offline action for offline errors", () => {
      const error = new ApiNetworkError(new TypeError("offline"));
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(true);
      expect(action.action).toBe("Retry");
    });

    it("returns timeout action for timeout errors", () => {
      const error = new ApiNetworkError(
        new DOMException("Timeout", "TimeoutError"),
      );
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(true);
      expect(action.action).toBe("Try again");
    });

    it("returns server error action for 5xx", () => {
      const error = new ApiNetworkError(new Error("5xx"), { status: 500 });
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(true);
      expect(action.action).toBe("Retry");
    });

    it("returns auth action for 401", () => {
      const error = new ApiNetworkError(new Error("401"), { status: 401 });
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(false);
      expect(action.action).toBe("Log in");
    });

    it("returns validation action for 4xx", () => {
      const error = new ApiNetworkError(new Error("400"), { status: 400 });
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(false);
      expect(action.message).toContain("Invalid input");
    });

    it("surfaces retryAfterMs countdown metadata for a 429 with Retry-After", () => {
      const response = {
        status: 429,
        headers: new Headers({ "Retry-After": "30" }),
      } as Response;
      const error = new ApiNetworkError(new Error("429"), response);
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(true);
      expect(action.retryAfterMs).toBe(30_000);
      expect(action.message).toContain("30s");
    });

    it("omits retryAfterMs when the 5xx response has no Retry-After header", () => {
      const response = { status: 503, headers: new Headers() } as Response;
      const error = new ApiNetworkError(new Error("503"), response);
      const action = getRecoveryAction(error);

      expect(action.canRetry).toBe(true);
      expect(action.retryAfterMs).toBeNull();
    });
  });

  describe("executeWithRetry", () => {
    it("executes request and returns result on success", async () => {
      const execute = jest.fn(async () => "success");
      const request: RetryableRequest = {
        method: "GET",
        hasIdempotencyContract: false,
        execute,
      };

      const result = await executeWithRetry(request);

      expect(result).toBe("success");
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable failures", async () => {
      let attempt = 0;
      const execute = jest.fn(async () => {
        attempt++;
        if (attempt < 2) {
          throw new ApiNetworkError(new TypeError("offline"));
        }
        return "success";
      });

      const request: RetryableRequest = {
        method: "GET",
        hasIdempotencyContract: false,
        execute,
      };

      const result = await executeWithRetry(request, { baseDelayMs: 1 });

      expect(result).toBe("success");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does not retry on auth failure", async () => {
      const execute = jest.fn(async () => {
        throw new ApiNetworkError(new Error("401"), { status: 401 });
      });

      const request: RetryableRequest = {
        method: "GET",
        hasIdempotencyContract: false,
        execute,
      };

      try {
        await executeWithRetry(request);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiNetworkError);
      }

      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("does not retry non-idempotent mutations", async () => {
      const execute = jest.fn(async () => {
        throw new ApiNetworkError(new TypeError("offline"));
      });

      const request: RetryableRequest = {
        method: "POST",
        hasIdempotencyContract: false,
        execute,
      };

      try {
        await executeWithRetry(request);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiNetworkError);
      }

      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("respects maxAttempts", async () => {
      const execute = jest.fn(async () => {
        throw new ApiNetworkError(new TypeError("offline"));
      });

      const request: RetryableRequest = {
        method: "GET",
        hasIdempotencyContract: false,
        execute,
      };

      try {
        await executeWithRetry(request, { maxAttempts: 2, baseDelayMs: 1 });
      } catch {
        // Expected to fail
      }

      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("respects maxDelayMs", async () => {
      let attempt = 0;
      const execute = jest.fn(async () => {
        attempt++;
        if (attempt < 5) {
          throw new ApiNetworkError(new TypeError("offline"));
        }
        return "success";
      });

      const request: RetryableRequest = {
        method: "GET",
        hasIdempotencyContract: false,
        execute,
      };

      const startTime = Date.now();
      await executeWithRetry(request, {
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 10, // Cap at 10ms
      });
      const elapsed = Date.now() - startTime;

      // Should be much faster than 4 * 1000ms due to maxDelayMs
      expect(elapsed).toBeLessThan(500);
    });
  });
});
