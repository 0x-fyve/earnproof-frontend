/**
 * @jest-environment jsdom
 */

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/errors";

// Mock telemetry and network modules
jest.mock("@/lib/telemetry", () => ({
  categorizeError: jest.fn(() => "network_error"),
  reportClientError: jest.fn(),
}));

jest.mock("@/lib/network", () => ({
  ApiNetworkError: class ApiNetworkError extends Error {
    constructor(error: unknown, public response?: Response) {
      super(error instanceof Error ? error.message : String(error));
      this.name = "ApiNetworkError";
    }
  },
  recordNetworkFailure: jest.fn(),
  recordNetworkSuccess: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

describe("apiClient with error references", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("extracts request ID from error response", async () => {
    const errorBody = {
      message: "Resource not found",
      requestId: "req-abc123xyz",
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => errorBody,
    });

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

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => errorBody,
    });

    try {
      await apiClient({ path: "/test" });
      fail("Should have thrown");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.requestId).toBeUndefined();
    }
  });
});
