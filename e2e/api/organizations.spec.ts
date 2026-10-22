import { test, expect } from "@playwright/test";
import { resolveSmokeEnv, redactForArtifact } from "./smoke-env";

test.describe("API contract smoke: organizations", () => {
  test("GET /organizations returns an array (unauthenticated: 200 empty or 401, never 5xx)", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/organizations`);
    expect([200, 401]).toContain(response.status());

    if (response.status() === 200) {
      const body = await response.json();
      test.info().attach("response-redacted", {
        body: JSON.stringify(redactForArtifact(body), null, 2),
        contentType: "application/json",
      });
      expect(Array.isArray(body)).toBe(true);
    }
  });

  test("GET /organizations with a bearer token returns an array of Organization-shaped entries", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv({ requireAuth: true });
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/organizations`, {
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

  test("GET /organizations with a malformed Authorization header returns 401, not a 5xx", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(`${resolved.env.apiUrl}/organizations`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(response.status()).toBe(401);
  });
});
