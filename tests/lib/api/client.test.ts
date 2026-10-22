/**
 * @jest-environment jsdom
 */

import { apiClient } from "@/lib/api/client";
import { ApiError, ApiResponseContractError } from "@/lib/errors";
import { clearPendingRequests } from "@/lib/network/request-dedup";
import { clearConcurrencyLimiters } from "@/lib/network/concurrency-limiter";

// Mock telemetry and network modules
jest.mock("@/lib/telemetry", () => ({
  categorizeError: jest.fn(() => "network_error"),
  reportClientError: jest.fn(),
}));

jest.mock("@/lib/network", () => {
  // Pull dedupRequest from its own module, not the @/lib/network barrel —
  // the barrel also re-exports React-hook modules (use-network-recovery)
  // that have init-order issues when pulled in via requireActual from
  // inside a jest.mock factory. dedupRequest itself has no such
  // dependency, so importing it directly avoids the problem while still
  // using the REAL implementation (not mocked) for the #330 coalescing
  // tests below.
  const { dedupRequest } = jest.requireActual("@/lib/network/request-dedup");
  return {
    dedupRequest,
    ApiNetworkError: class ApiNetworkError extends Error {
      constructor(error: unknown, public response?: Response) {
        super(error instanceof Error ? error.message : String(error));
        this.name = "ApiNetworkError";
      }
    },
    recordNetworkFailure: jest.fn(),
    recordNetworkSuccess: jest.fn(),
  };
});

// Mock fetch globally
global.fetch = jest.fn();

/** Build a real Response (so client.ts's body-stream/content-type reads work) for a JSON mock. */
function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

describe("apiClient with error references", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("extracts request ID from error response", async () => {
    const errorBody = {
      message: "Resource not found",
      requestId: "req-abc123xyz",
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(errorBody, 404));

    try {
      await apiClient({ path: "/test" });
      fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe("Resource not found");
      expect(apiError.status).toBe(404);
      expect(apiError.requestId).toBe("req-abc123xyz");
    }
  });

  it("does not include sensitive tokens in error", async () => {
    const errorBody = {
      message: "Unauthorized",
      requestId: "Bearer sensitive-token-123",
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(errorBody, 401));

    try {
      await apiClient({ path: "/test" });
      fail("Should have thrown");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.requestId).toBeUndefined();
    }
  });
});

describe("apiClient — response MIME type and size contract (#328)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses a well-formed application/json success response", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const result = await apiClient<{ ok: boolean }>({ path: "/test" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a success response with a missing Content-Type, without parsing the body", async () => {
    const response = new Response("{\"ok\":true}", { status: 200 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    try {
      await apiClient({ path: "/test" });
      fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiResponseContractError);
      expect((error as ApiResponseContractError).reason).toBe("missing_content_type");
    }
  });

  it("rejects an HTML error-page response instead of parsing it as JSON", async () => {
    const htmlBody = "<html><body>502 Bad Gateway</body></html>";
    const response = new Response(htmlBody, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    await expect(apiClient({ path: "/test" })).rejects.toMatchObject({
      name: "ApiResponseContractError",
      reason: "unexpected_content_type",
      contentType: "text/html",
    });
  });

  it("rejects a response whose declared Content-Length exceeds the budget, without reading the body", async () => {
    const response = jsonResponse({ data: "x" }, 200);
    // Lie about the length — simulates a compressed/chunked response whose
    // declared length is itself oversized.
    response.headers.set("content-length", String(10 * 1024 * 1024));
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    await expect(
      apiClient({ path: "/test", maxResponseBytes: 5 * 1024 * 1024 }),
    ).rejects.toMatchObject({
      name: "ApiResponseContractError",
      reason: "content_length_exceeded",
    });
  });

  it("rejects a response whose actual streamed size exceeds the budget even without a declared Content-Length", async () => {
    const bigPayload = JSON.stringify({ data: "x".repeat(200) });
    const response = new Response(bigPayload, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    response.headers.delete("content-length");
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    await expect(
      apiClient({ path: "/test", maxResponseBytes: 50 }),
    ).rejects.toMatchObject({
      name: "ApiResponseContractError",
      reason: "stream_size_exceeded",
    });
  });

  it("accepts a response exactly at the configured byte boundary", async () => {
    const body = JSON.stringify({ a: 1 });
    const byteLength = new TextEncoder().encode(body).byteLength;
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    const result = await apiClient<{ a: number }>({
      path: "/test",
      maxResponseBytes: byteLength,
    });
    expect(result).toEqual({ a: 1 });
  });

  it("rejects an unexpectedly empty success body by default", async () => {
    const response = new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    await expect(apiClient({ path: "/test" })).rejects.toMatchObject({
      name: "ApiResponseContractError",
      reason: "missing_body",
    });
  });

  it("allows an empty success body when the endpoint opts in via allowEmptyBody", async () => {
    const response = new Response(null, { status: 204 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    const result = await apiClient({ path: "/test", allowEmptyBody: true });
    expect(result).toBeUndefined();
  });

  it("does not parse or pass through an oversized error body, but still throws a usable error", async () => {
    const hugeErrorBody = JSON.stringify({ message: "x".repeat(10_000) });
    const response = new Response(hugeErrorBody, {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    await expect(apiClient({ path: "/test", maxResponseBytes: 10 })).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });
});

describe("apiClient — read coalescing and concurrency (#330)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPendingRequests();
    clearConcurrencyLimiters();
  });

  it("coalesces concurrent identical GET requests into a single fetch call", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );

    const p1 = apiClient<{ a: number }>({ path: "/shared" });
    const p2 = apiClient<{ a: number }>({ path: "/shared" });

    // Both calls go through async setup (dedup registration, concurrency
    // acquire) before the mocked fetch is actually invoked — give that a
    // tick before resolving it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFetch(jsonResponse({ a: 1 }, 200));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ a: 1 });
    expect(r2).toEqual({ a: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce GET requests with different Authorization headers", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ user: "a" }, 200))
      .mockResolvedValueOnce(jsonResponse({ user: "b" }, 200));

    const [r1, r2] = await Promise.all([
      apiClient<{ user: string }>({ path: "/me", headers: { Authorization: "Bearer a" } }),
      apiClient<{ user: string }>({ path: "/me", headers: { Authorization: "Bearer b" } }),
    ]);

    expect(r1).toEqual({ user: "a" });
    expect(r2).toEqual({ user: "b" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("never coalesces POST (mutation) requests, even identical ones fired concurrently", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ id: 1 }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 2 }, 201));

    const [r1, r2] = await Promise.all([
      apiClient<{ id: number }>({ path: "/create", method: "POST", body: JSON.stringify({}) }),
      apiClient<{ id: number }>({ path: "/create", method: "POST", body: JSON.stringify({}) }),
    ]);

    expect(r1).toEqual({ id: 1 });
    expect(r2).toEqual({ id: 2 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("allows an individual GET to opt out of coalescing via skipCoalescing", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ v: 1 }, 200))
      .mockResolvedValueOnce(jsonResponse({ v: 2 }, 200));

    const [r1, r2] = await Promise.all([
      apiClient<{ v: number }>({ path: "/shared", skipCoalescing: true }),
      apiClient<{ v: number }>({ path: "/shared", skipCoalescing: true }),
    ]);

    expect(r1).toEqual({ v: 1 });
    expect(r2).toEqual({ v: 2 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
