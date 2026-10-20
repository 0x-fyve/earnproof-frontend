import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  dedupRequest,
  cancelPendingRequests,
  clearPendingRequests,
  isPending,
} from "../request-dedup";

describe("request-dedup", () => {
  beforeEach(() => {
    clearPendingRequests();
  });

  afterEach(() => {
    clearPendingRequests();
  });

  describe("dedupRequest", () => {
    it("executes a request and returns the result", async () => {
      const execute = vi.fn(async () => "result");
      const result = await dedupRequest("GET", "/api/test", execute);

      expect(result).toBe("result");
      expect(execute).toHaveBeenCalledOnce();
    });

    it("deduplicates concurrent identical requests", async () => {
      const execute = vi.fn(async (_signal: AbortSignal) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "result";
      });

      const promise1 = dedupRequest("GET", "/api/test", execute);
      const promise2 = dedupRequest("GET", "/api/test", execute);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe("result");
      expect(result2).toBe("result");
      expect(execute).toHaveBeenCalledOnce(); // Same promise shared
    });

    it("does not deduplicate different URLs", async () => {
      const execute1 = vi.fn(async () => "result1");
      const execute2 = vi.fn(async () => "result2");

      const result1 = await dedupRequest("GET", "/api/test1", execute1);
      const result2 = await dedupRequest("GET", "/api/test2", execute2);

      expect(result1).toBe("result1");
      expect(result2).toBe("result2");
      expect(execute1).toHaveBeenCalledOnce();
      expect(execute2).toHaveBeenCalledOnce();
    });

    it("does not deduplicate different methods", async () => {
      const execute1 = vi.fn(async () => "get");
      const execute2 = vi.fn(async () => "post");

      const result1 = await dedupRequest("GET", "/api/test", execute1);
      const result2 = await dedupRequest("POST", "/api/test", execute2);

      expect(result1).toBe("get");
      expect(result2).toBe("post");
      expect(execute1).toHaveBeenCalledOnce();
      expect(execute2).toHaveBeenCalledOnce();
    });

    it("clears pending request after success", async () => {
      const execute = vi.fn(async () => "result");

      expect(isPending("GET", "/api/test")).toBe(false);
      const promise = dedupRequest("GET", "/api/test", execute);
      expect(isPending("GET", "/api/test")).toBe(true);

      await promise;
      expect(isPending("GET", "/api/test")).toBe(false);
    });

    it("clears pending request after error", async () => {
      const error = new Error("test error");
      const execute = vi.fn(async () => {
        throw error;
      });

      expect(isPending("GET", "/api/test")).toBe(false);
      const promise = dedupRequest("GET", "/api/test", execute);
      expect(isPending("GET", "/api/test")).toBe(true);

      try {
        await promise;
      } catch {
        // Expected
      }
      expect(isPending("GET", "/api/test")).toBe(false);
    });

    it("respects caller's AbortSignal", async () => {
      const execute = vi.fn(async (signal: AbortSignal) => {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return "result";
      });

      const controller = new AbortController();
      const promise = dedupRequest("GET", "/api/test", execute, controller.signal);

      setTimeout(() => controller.abort(), 5);

      try {
        await promise;
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException);
      }

      expect(execute).toHaveBeenCalled();
    });
  });

  describe("cancelPendingRequests", () => {
    it("cancels all pending requests when called with no args", async () => {
      const execute1 = vi.fn(async (signal: AbortSignal) => {
        await new Promise((resolve) => {
          const listener = () => {
            resolve(undefined);
          };
          signal.addEventListener("abort", listener);
        });
        throw new DOMException("Aborted", "AbortError");
      });

      const promise = dedupRequest("GET", "/api/test1", execute1);
      expect(isPending("GET", "/api/test1")).toBe(true);

      cancelPendingRequests();
      expect(isPending("GET", "/api/test1")).toBe(false);

      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it("cancels requests matching a pattern", async () => {
      const execute1 = vi.fn(async (signal: AbortSignal) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await new Promise((resolve) => signal.addEventListener("abort", resolve as any));
        throw new DOMException("Aborted", "AbortError");
      });

      const execute2 = vi.fn(async () => "result");

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const promise1 = dedupRequest("GET", "/api/payments", execute1);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const promise2 = dedupRequest("GET", "/api/other", execute2);

      cancelPendingRequests("payments");

      expect(isPending("GET", "/api/payments")).toBe(false);
      expect(isPending("GET", "/api/other")).toBe(true);
    });
  });

  describe("clearPendingRequests", () => {
    it("clears all pending requests", async () => {
      const execute1 = vi.fn(async () => "result1");
      const execute2 = vi.fn(async () => "result2");

      await dedupRequest("GET", "/api/test1", execute1);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const promise2 = dedupRequest("GET", "/api/test2", execute2);

      expect(isPending("GET", "/api/test1")).toBe(false);
      expect(isPending("GET", "/api/test2")).toBe(true);

      clearPendingRequests();

      expect(isPending("GET", "/api/test1")).toBe(false);
      expect(isPending("GET", "/api/test2")).toBe(false);
    });
  });
});
