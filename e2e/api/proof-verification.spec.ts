import { test, expect } from "@playwright/test";
import { resolveSmokeEnv, redactForArtifact } from "./smoke-env";

test.describe("API contract smoke: proof verification", () => {
  test("GET /proofs/{id}/verify for a clearly-synthetic id returns a non-5xx response", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.get(
      `${resolved.env.apiUrl}/proofs/e2e-smoke-nonexistent-proof-id/verify`,
    );
    // The OpenAPI contract only documents a 200 response for this route,
    // but a nonexistent id is expected to 404 (not found) or similar — the
    // one outcome this check rules out is a 5xx, which would mean the
    // route itself is broken for a built frontend talking to a real
    // deployment, independent of whether this particular id exists.
    expect(response.status()).toBeLessThan(500);

    if (response.status() === 200) {
      const body = await response.json();
      test.info().attach("response-redacted", {
        body: JSON.stringify(redactForArtifact(body), null, 2),
        contentType: "application/json",
      });
      expect(typeof body.result).toBe("string");
    }
  });
});
