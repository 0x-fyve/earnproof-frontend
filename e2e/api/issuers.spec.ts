import { test, expect } from "@playwright/test";
import { resolveSmokeEnv, redactForArtifact } from "./smoke-env";

test.describe("API contract smoke: issuers", () => {
  test("GET /issuers returns an array", async ({ request }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/issuers`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    test.info().attach("response-redacted", {
      body: JSON.stringify(redactForArtifact(body), null, 2),
      contentType: "application/json",
    });
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /issuers/{id} for a clearly-synthetic id returns 404, not a 5xx", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(
      `${resolved.env.apiUrl}/issuers/e2e-smoke-nonexistent-issuer-id`,
    );
    expect(response.status()).toBe(404);
  });
});
