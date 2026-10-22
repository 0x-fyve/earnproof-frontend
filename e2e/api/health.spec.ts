import { test, expect } from "@playwright/test";
import { resolveSmokeEnv, summarizeShape } from "./smoke-env";

test.describe("API contract smoke: health", () => {
  test("GET /health returns the documented HealthResponse shape", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/health`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    test.info().attach("response-shape", {
      body: JSON.stringify(summarizeShape(body), null, 2),
      contentType: "application/json",
    });

    expect(typeof body.status).toBe("string");
    expect(typeof body.service).toBe("string");
    expect(typeof body.database).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    // ISO 8601 — exact format isn't contractually guaranteed beyond this.
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });
});
