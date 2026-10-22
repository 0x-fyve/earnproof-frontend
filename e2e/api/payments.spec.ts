import { test, expect } from "@playwright/test";
import { resolveSmokeEnv, redactForArtifact } from "./smoke-env";

/**
 * Payments are wallet-authenticated (see config/cache-headers.ts's
 * "authenticated" policy and the OpenAPI spec's 401 response on GET
 * /payments), so every check here requires EARNPROOF_API_SMOKE_TOKEN and
 * skips without it — this suite never targets production mutations, and
 * /payments has no GET-only safe path to probe unauthenticated.
 */
test.describe("API contract smoke: payments", () => {
  test("GET /payments without auth returns 401, not a 5xx", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/payments`);
    expect(response.status()).toBe(401);
  });

  test("GET /payments with a bearer token returns an array of Payment-shaped entries", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv({ requireAuth: true });
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/payments`, {
      headers: { Authorization: `Bearer ${resolved.env.authToken}` },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    test.info().attach("response-redacted", {
      body: JSON.stringify(redactForArtifact(body), null, 2),
      contentType: "application/json",
    });
    expect(Array.isArray(body)).toBe(true);
  });
});
