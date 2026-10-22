/**
 * Unit coverage for e2e/api/smoke-env.ts's pure logic (env gating,
 * production-host refusal, redaction). This runs under jest, not
 * Playwright — the functions themselves have no Playwright dependency,
 * and this is what gives fast, deterministic coverage of the suite's
 * safety gates without actually spinning up a browser/backend.
 */

import {
  resolveSmokeEnv,
  redactForArtifact,
  summarizeShape,
} from "../../e2e/api/smoke-env";

describe("resolveSmokeEnv", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EARNPROOF_API_SMOKE_URL;
    delete process.env.EARNPROOF_API_SMOKE_TOKEN;
    delete process.env.EARNPROOF_API_SMOKE_ALLOW_PROD;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("skips with a clear reason when EARNPROOF_API_SMOKE_URL is unset", () => {
    const result = resolveSmokeEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipReason).toContain("EARNPROOF_API_SMOKE_URL");
    }
  });

  it("skips with a clear reason when the URL is malformed", () => {
    process.env.EARNPROOF_API_SMOKE_URL = "not a url";
    const result = resolveSmokeEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipReason).toContain("not a valid URL");
    }
  });

  it("resolves successfully for a valid staging-looking URL", () => {
    process.env.EARNPROOF_API_SMOKE_URL =
      "https://api-staging.example.com/api/v1";
    const result = resolveSmokeEnv();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.apiUrl).toBe("https://api-staging.example.com/api/v1");
      expect(result.env.authToken).toBeUndefined();
    }
  });

  it("strips a trailing slash from the resolved apiUrl", () => {
    process.env.EARNPROOF_API_SMOKE_URL =
      "https://api-staging.example.com/api/v1/";
    const result = resolveSmokeEnv();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.apiUrl).toBe("https://api-staging.example.com/api/v1");
    }
  });

  it("refuses a production-looking host without EARNPROOF_API_SMOKE_ALLOW_PROD", () => {
    process.env.EARNPROOF_API_SMOKE_URL = "https://api.earnproof.com/api/v1";
    const result = resolveSmokeEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipReason).toContain("production");
    }
  });

  it("allows a production-looking host when EARNPROOF_API_SMOKE_ALLOW_PROD is set", () => {
    process.env.EARNPROOF_API_SMOKE_URL = "https://api.earnproof.com/api/v1";
    process.env.EARNPROOF_API_SMOKE_ALLOW_PROD = "1";
    const result = resolveSmokeEnv();
    expect(result.ok).toBe(true);
  });

  it("requires EARNPROOF_API_SMOKE_TOKEN when requireAuth is set, with a clear skip reason", () => {
    process.env.EARNPROOF_API_SMOKE_URL =
      "https://api-staging.example.com/api/v1";
    const result = resolveSmokeEnv({ requireAuth: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipReason).toContain("EARNPROOF_API_SMOKE_TOKEN");
    }
  });

  it("resolves successfully with requireAuth when the token is present", () => {
    process.env.EARNPROOF_API_SMOKE_URL =
      "https://api-staging.example.com/api/v1";
    process.env.EARNPROOF_API_SMOKE_TOKEN = "synthetic-smoke-token";
    const result = resolveSmokeEnv({ requireAuth: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.authToken).toBe("synthetic-smoke-token");
    }
  });
});

describe("redactForArtifact", () => {
  it("redacts every field of an object, keyed or not", () => {
    const redacted = redactForArtifact({
      id: "proof-123",
      token: "secret-token",
      walletSignature: "sig-abc",
      amount: 500,
    }) as Record<string, unknown>;

    expect(redacted.id).toBe("[redacted]");
    expect(redacted.token).toBe("[redacted]");
    expect(redacted.walletSignature).toBe("[redacted]");
    expect(redacted.amount).toBe("[redacted]");
  });

  it("redacts an array to a length-only placeholder, never its contents", () => {
    const redacted = redactForArtifact([
      { id: "a", token: "t1" },
      { id: "b", token: "t2" },
    ]);
    expect(redacted).toEqual(["[redacted array, length 2]"]);
  });

  it("passes through non-string, non-object primitives unredacted (status codes, counts)", () => {
    expect(redactForArtifact(200)).toBe(200);
    expect(redactForArtifact(true)).toBe(true);
    expect(redactForArtifact(null)).toBeNull();
  });

  it("redacts a bare string value", () => {
    expect(redactForArtifact("some-secret-looking-string")).toBe("[redacted]");
  });
});

describe("summarizeShape", () => {
  it("summarizes an object to field name -> type, never values", () => {
    const summary = summarizeShape({
      id: "proof-123",
      amount: 500,
      verified: true,
      tags: ["a", "b"],
      meta: null,
    }) as Record<string, string>;

    expect(summary).toEqual({
      id: "string",
      amount: "number",
      verified: "boolean",
      tags: "array",
      meta: "null",
    });
    expect(JSON.stringify(summary)).not.toContain("proof-123");
  });

  it("summarizes an array by its first element's shape", () => {
    const summary = summarizeShape([{ id: "a" }, { id: "b" }]);
    expect(summary).toEqual([{ id: "string" }]);
  });

  it("summarizes an empty array as empty", () => {
    expect(summarizeShape([])).toEqual([]);
  });
});
