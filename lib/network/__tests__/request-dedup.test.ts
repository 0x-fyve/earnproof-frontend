import {
  dedupRequest,
  cancelPendingRequests,
  clearPendingRequests,
  isPending,
} from "../request-dedup";

// This file previously imported describe/it/expect/vi from "vitest", a
// dependency this project does not have (it uses jest exclusively — see
// package.json's "test" script and jest.config.mjs). That made the whole
// suite fail to even load under `npm test`, so none of its assertions
// actually ran. Jest's own globals (describe/it/expect) and jest.fn/
// jest.spyOn are available without an import.
const vi = jest;

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
      expect(execute).toHaveBeenCalledTimes(1);
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
      expect(execute).toHaveBeenCalledTimes(1); // Same promise shared
    });

    it("does not deduplicate different URLs", async () => {
      const execute1 = vi.fn(async () => "result1");
      const execute2 = vi.fn(async () => "result2");

      const result1 = await dedupRequest("GET", "/api/test1", execute1);
      const result2 = await dedupRequest("GET", "/api/test2", execute2);

      expect(result1).toBe("result1");
      expect(result2).toBe("result2");
      expect(execute1).toHaveBeenCalledTimes(1);
      expect(execute2).toHaveBeenCalledTimes(1);
    });

    it("does not deduplicate different methods", async () => {
      const execute1 = vi.fn(async () => "get");
      const execute2 = vi.fn(async () => "post");

      const result1 = await dedupRequest("GET", "/api/test", execute1);
      const result2 = await dedupRequest("POST", "/api/test", execute2);

      expect(result1).toBe("get");
      expect(result2).toBe("post");
      expect(execute1).toHaveBeenCalledTimes(1);
      expect(execute2).toHaveBeenCalledTimes(1);
    });

    describe("header discrimination (#330)", () => {
      it("does not coalesce requests with different Authorization headers", async () => {
        const execute1 = vi.fn(async () => "user-a-data");
        const execute2 = vi.fn(async () => "user-b-data");

        const [result1, result2] = await Promise.all([
          dedupRequest("GET", "/api/profile", execute1, undefined, { Authorization: "Bearer token-a" }),
          dedupRequest("GET", "/api/profile", execute2, undefined, { Authorization: "Bearer token-b" }),
        ]);

        expect(result1).toBe("user-a-data");
        expect(result2).toBe("user-b-data");
        expect(execute1).toHaveBeenCalledTimes(1);
        expect(execute2).toHaveBeenCalledTimes(1);
      });

      it("does not coalesce requests with different tenant/organization headers", async () => {
        const execute1 = vi.fn(async () => "org-a-data");
        const execute2 = vi.fn(async () => "org-b-data");

        const [result1, result2] = await Promise.all([
          dedupRequest("GET", "/api/usage", execute1, undefined, { "X-Organization-Id": "org-a" }),
          dedupRequest("GET", "/api/usage", execute2, undefined, { "X-Organization-Id": "org-b" }),
        ]);

        expect(result1).toBe("org-a-data");
        expect(result2).toBe("org-b-data");
        expect(execute1).toHaveBeenCalledTimes(1);
        expect(execute2).toHaveBeenCalledTimes(1);
      });

      it("does not coalesce requests with different network headers", async () => {
        const execute1 = vi.fn(async () => "testnet-data");
        const execute2 = vi.fn(async () => "mainnet-data");

        const [result1, result2] = await Promise.all([
          dedupRequest("GET", "/api/issuers", execute1, undefined, { "X-Stellar-Network": "testnet" }),
          dedupRequest("GET", "/api/issuers", execute2, undefined, { "X-Stellar-Network": "mainnet" }),
        ]);

        expect(result1).toBe("testnet-data");
        expect(result2).toBe("mainnet-data");
        expect(execute1).toHaveBeenCalledTimes(1);
        expect(execute2).toHaveBeenCalledTimes(1);
      });

      it("still coalesces requests with identical discriminating headers", async () => {
        const execute = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return "shared";
        });

        const headers = { Authorization: "Bearer token-a", "X-Organization-Id": "org-a" };
        const [result1, result2] = await Promise.all([
          dedupRequest("GET", "/api/profile", execute, undefined, headers),
          dedupRequest("GET", "/api/profile", execute, undefined, { ...headers }),
        ]);

        expect(result1).toBe("shared");
        expect(result2).toBe("shared");
        expect(execute).toHaveBeenCalledTimes(1);
      });

      it("accepts headers as a Headers instance, not just a plain object", async () => {
        const execute1 = vi.fn(async () => "a");
        const execute2 = vi.fn(async () => "b");

        const [result1, result2] = await Promise.all([
          dedupRequest("GET", "/api/profile", execute1, undefined, new Headers({ Authorization: "Bearer a" })),
          dedupRequest("GET", "/api/profile", execute2, undefined, new Headers({ Authorization: "Bearer b" })),
        ]);

        expect(result1).toBe("a");
        expect(result2).toBe("b");
        expect(execute1).toHaveBeenCalledTimes(1);
        expect(execute2).toHaveBeenCalledTimes(1);
      });

      it("isPending respects the same header discrimination as dedupRequest", async () => {
        const execute = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "result";
        });

        const promise = dedupRequest("GET", "/api/profile", execute, undefined, {
          Authorization: "Bearer token-a",
        });

        expect(isPending("GET", "/api/profile", { Authorization: "Bearer token-a" })).toBe(true);
        expect(isPending("GET", "/api/profile", { Authorization: "Bearer token-b" })).toBe(false);
        expect(isPending("GET", "/api/profile")).toBe(false);

        await promise;
      });

      it("ignores non-discriminating headers (e.g. a tracing header) for coalescing purposes", async () => {
        const execute = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return "shared";
        });

        const [result1, result2] = await Promise.all([
          dedupRequest("GET", "/api/profile", execute, undefined, { "X-Trace-Id": "trace-1" }),
          dedupRequest("GET", "/api/profile", execute, undefined, { "X-Trace-Id": "trace-2" }),
        ]);

        expect(result1).toBe("shared");
        expect(result2).toBe("shared");
        expect(execute).toHaveBeenCalledTimes(1);
      });
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
