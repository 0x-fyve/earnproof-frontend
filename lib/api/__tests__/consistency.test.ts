import {
  DEFAULT_CONSISTENCY_WINDOW_MS,
  MAX_CONSISTENCY_WINDOW_MS,
  sanitizeCorrelationId,
  validateConsistencyToken,
} from "../consistency";

const ORG_A = "org-alpha";
const ORG_B = "org-beta";

describe("Consistency token parsing and validation (#256)", () => {
  const baseNow = 1_700_000_000_000;

  it("validates well-formed consistency tokens matching tenant and resource", () => {
    const candidate = {
      token: "raw-token-12345",
      organizationId: ORG_A,
      resourceType: "organization-policy",
      resourceId: "policy-data-residency",
      expectedVersion: 4,
      issuedAt: new Date(baseNow).toISOString(),
      expiresAt: new Date(baseNow + 15_000).toISOString(),
      correlationId: "CORR-9988-77",
    };

    const result = validateConsistencyToken(candidate, {
      viewerOrganizationId: ORG_A,
      expectedResourceType: "organization-policy",
      expectedResourceId: "policy-data-residency",
      nowMs: baseNow,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.expectedVersion).toBe(4);
      expect(result.token.correlationId).toBe("CORR-9988-77");
    }
  });

  it("rejects cross-tenant consistency tokens", () => {
    const candidate = {
      token: "tok-1",
      organizationId: ORG_B, // Cross-tenant!
      resourceType: "organization-policy",
      resourceId: "policy-1",
      expectedVersion: 2,
    };

    const result = validateConsistencyToken(candidate, {
      viewerOrganizationId: ORG_A,
      expectedResourceType: "organization-policy",
      expectedResourceId: "policy-1",
      nowMs: baseNow,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross-tenant-token");
    }
  });

  it("rejects mismatched-resource consistency tokens", () => {
    const candidate = {
      token: "tok-2",
      organizationId: ORG_A,
      resourceType: "issuer", // Mismatched!
      resourceId: "issuer-1",
      expectedVersion: 3,
    };

    const result = validateConsistencyToken(candidate, {
      viewerOrganizationId: ORG_A,
      expectedResourceType: "organization-policy",
      expectedResourceId: "policy-1",
      nowMs: baseNow,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("mismatched-resource");
    }
  });

  it("bounds consistency window to MAX_CONSISTENCY_WINDOW_MS", () => {
    const candidate = {
      token: "tok-3",
      organizationId: ORG_A,
      resourceType: "policy",
      resourceId: "p1",
      expectedVersion: 1,
      issuedAt: new Date(baseNow).toISOString(),
      expiresAt: new Date(baseNow + 10 * 60_000).toISOString(), // 10 minutes requested
    };

    const result = validateConsistencyToken(candidate, {
      viewerOrganizationId: ORG_A,
      expectedResourceType: "policy",
      expectedResourceId: "p1",
      nowMs: baseNow,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const maxExpiry = baseNow + MAX_CONSISTENCY_WINDOW_MS;
      expect(new Date(result.token.expiresAt).getTime()).toBeLessThanOrEqual(
        maxExpiry,
      );
    }
  });

  it("sanitizes safe correlation IDs and rejects malicious injection", () => {
    expect(sanitizeCorrelationId("CORR_123-abc")).toBe("CORR_123-abc");
    expect(sanitizeCorrelationId("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeCorrelationId("")).toBeNull();
  });
});
