/**
 * @jest-environment jsdom
 */

import { z } from "zod";
import { apiClient } from "../client";
import { ApiResponseValidationError } from "@/lib/validation/runtime-response";

/**
 * Builds a real `Response` so the client's bounded-read/content-type
 * contract (#328) is exercised the same way it is in production, instead
 * of a partial mock that bypasses it.
 */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? (init?.ok === false ? 500 : 200),
    headers: { "content-type": "application/json" },
  });
}

describe("apiClient responseSchema validation (#327)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const schema = z.object({ id: z.string(), count: z.number() });

  it("returns the parsed body unchanged when no responseSchema is given (default, existing behavior)", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: "abc", count: 1 }));

    const result = await apiClient<{ id: string; count: number }>({ path: "/thing" });
    expect(result).toEqual({ id: "abc", count: 1 });
  });

  it("returns the validated body when it matches responseSchema", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: "abc", count: 1 }));

    const result = await apiClient({ path: "/thing", responseSchema: schema });
    expect(result).toEqual({ id: "abc", count: 1 });
  });

  it("throws ApiResponseValidationError, not the raw body, when the 200 response doesn't match responseSchema", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: "abc", count: "not-a-number" }));

    await expect(apiClient({ path: "/thing", responseSchema: schema })).rejects.toBeInstanceOf(
      ApiResponseValidationError,
    );
  });

  it("keeps a validation failure distinguishable from a transport/network failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    let networkError: unknown;
    try {
      await apiClient({ path: "/thing", responseSchema: schema });
    } catch (error) {
      networkError = error;
    }

    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: "abc", count: "not-a-number" }));

    let validationError: unknown;
    try {
      await apiClient({ path: "/thing", responseSchema: schema });
    } catch (error) {
      validationError = error;
    }

    expect(networkError).not.toBeInstanceOf(ApiResponseValidationError);
    expect(validationError).toBeInstanceOf(ApiResponseValidationError);
  });

  it("never includes the raw response body in the thrown validation error", async () => {
    const secretValue = "super-secret-response-value-should-not-leak";
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: secretValue, count: "not-a-number" }));

    try {
      await apiClient({ path: "/thing", responseSchema: schema });
      throw new Error("expected apiClient to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiResponseValidationError);
      expect(JSON.stringify((error as ApiResponseValidationError).issues)).not.toContain(secretValue);
      expect((error as Error).message).not.toContain(secretValue);
    }
  });

  it("does not run schema validation on a non-ok response (error path takes precedence)", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ message: "server error" }, { ok: false, status: 500 }));

    await expect(apiClient({ path: "/thing", responseSchema: schema })).rejects.not.toBeInstanceOf(
      ApiResponseValidationError,
    );
  });
});
