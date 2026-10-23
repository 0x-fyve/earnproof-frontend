import { test, expect } from "@playwright/test";
import {
  resolveSmokeEnv,
  redactForArtifact,
  summarizeShape,
} from "./smoke-env";

/** 56-char Stellar-shaped address, obviously synthetic, never a real wallet. */
const SYNTHETIC_SMOKE_WALLET = "GSYNTHETICAPISMOKEWALLET" + "A".repeat(32);

test.describe("API contract smoke: auth challenge", () => {
  test("POST /auth/challenge issues a challenge for a synthetic wallet address", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.post(
      `${resolved.env.apiUrl}/auth/challenge`,
      {
        data: { walletAddress: SYNTHETIC_SMOKE_WALLET },
      },
    );
    expect(response.status()).toBe(201);

    const body = await response.json();
    test.info().attach("response-shape", {
      body: JSON.stringify(summarizeShape(body), null, 2),
      contentType: "application/json",
    });
    // Never attach the challenge message/id verbatim — redact before any
    // artifact, per this suite's "redact tokens/signatures/bodies" rule.
    test.info().attach("response-redacted", {
      body: JSON.stringify(redactForArtifact(body), null, 2),
      contentType: "application/json",
    });

    expect(typeof body.id).toBe("string");
    expect(typeof body.message).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
    expect(() => new Date(body.expiresAt).toISOString()).not.toThrow();
    // The challenge must expire in the future relative to issuance.
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("POST /auth/challenge without a walletAddress returns 400", async ({
    request,
  }) => {
    const resolved = resolveSmokeEnv();
    test.skip(!resolved.ok, resolved.ok ? "" : resolved.skipReason);
    if (!resolved.ok) return;

    const response = await request.post(
      `${resolved.env.apiUrl}/auth/challenge`,
      {
        data: {},
      },
    );
    expect(response.status()).toBe(400);
  });
});
