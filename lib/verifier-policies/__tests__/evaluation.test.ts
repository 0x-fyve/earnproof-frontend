import { evaluateProfile } from "../evaluation";
import type { VerifierPolicyProfile } from "../store";
import type { VerifyProofResponse } from "@/lib/api/generated/v1";

function baseProfile(overrides: Partial<VerifierPolicyProfile> = {}): VerifierPolicyProfile {
  return {
    id: "profile-1",
    name: "Test profile",
    description: "",
    status: "active",
    acceptedIssuerIds: ["issuer-known"],
    acceptedSchemaVersions: ["1.0"],
    acceptedProofTypes: ["minimum_income"],
    maxFreshnessSeconds: 3600,
    requiredDisclosureFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validResponse(overrides: {
  issuer?: string;
  schemaVersion?: string;
  type?: string;
  operator?: string;
  issuedAt?: string;
  claimExtra?: Record<string, unknown>;
} = {}): VerifyProofResponse {
  return {
    result: "VALID",
    status: "valid",
    credential: {
      id: "cred-1",
      type: overrides.type ?? "minimum_income",
      schemaVersion: overrides.schemaVersion ?? "1.0",
      issuer: overrides.issuer ?? "issuer-known",
      subject: { walletHash: "wh-1" },
      claim: {
        operator: (overrides.operator ?? "gte") as "gte",
        thresholdAmount: "1000",
        assetCode: "USDC",
        ...overrides.claimExtra,
      },
    } as VerifyProofResponse["credential"],
    proof: {
      id: "proof-1",
      type: overrides.type ?? "minimum_income",
      schemaVersion: overrides.schemaVersion ?? "1.0",
      network: "testnet",
      issuedAt: overrides.issuedAt ?? new Date(Date.now() - 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  };
}

describe("evaluateProfile — cryptographic outcome is never overridden", () => {
  it.each(["EXPIRED", "REVOKED", "INVALID_SIGNATURE", "UNKNOWN_PROOF", "UNVERIFIED_ISSUER"] as const)(
    "rejects a %s result unconditionally, even if every other field would otherwise match",
    (result) => {
      const profile = baseProfile();
      const response: VerifyProofResponse = { ...validResponse(), result, status: "invalid" };

      const evaluation = evaluateProfile(profile, response);

      expect(evaluation.accepted).toBe(false);
      expect(evaluation.failureReasons).toEqual(["cryptographic_verification_failed"]);
    },
  );

  it("never evaluates profile-specific rules for a non-VALID result (short-circuits immediately)", () => {
    // A profile that would reject on every other axis too — the point is
    // the function returns a single, specific reason rather than piling
    // on reasons that were never actually checked.
    const profile = baseProfile({ acceptedIssuerIds: [], acceptedSchemaVersions: [] });
    const response: VerifyProofResponse = { result: "EXPIRED", status: "expired" };

    const evaluation = evaluateProfile(profile, response);
    expect(evaluation.failureReasons).toEqual(["cryptographic_verification_failed"]);
  });
});

describe("evaluateProfile — accepts a matching VALID proof", () => {
  it("accepts when issuer, schema, proof type, operator, and freshness all match", () => {
    const profile = baseProfile();
    const evaluation = evaluateProfile(profile, validResponse());
    expect(evaluation.accepted).toBe(true);
    expect(evaluation.failureReasons).toEqual([]);
  });
});

describe("evaluateProfile — fails closed on unknowns", () => {
  it("rejects an issuer not in the accepted list", () => {
    const profile = baseProfile();
    const evaluation = evaluateProfile(profile, validResponse({ issuer: "issuer-unknown" }));
    expect(evaluation.accepted).toBe(false);
    expect(evaluation.failureReasons).toContain("unknown_issuer");
  });

  it("rejects everything when acceptedIssuerIds is empty (empty means reject-all, not accept-all)", () => {
    const profile = baseProfile({ acceptedIssuerIds: [] });
    const evaluation = evaluateProfile(profile, validResponse());
    expect(evaluation.accepted).toBe(false);
    expect(evaluation.failureReasons).toContain("unknown_issuer");
  });

  it("rejects a schema version not in the accepted list", () => {
    const profile = baseProfile();
    const evaluation = evaluateProfile(profile, validResponse({ schemaVersion: "3.0" }));
    expect(evaluation.failureReasons).toContain("unknown_schema_version");
  });

  it("rejects a proof type not in the accepted list", () => {
    const profile = baseProfile();
    const evaluation = evaluateProfile(profile, validResponse({ type: "recurring_income" }));
    expect(evaluation.failureReasons).toContain("unknown_proof_type");
  });

  it("rejects an unrecognized claim operator", () => {
    const profile = baseProfile();
    const evaluation = evaluateProfile(profile, validResponse({ operator: "lte" }));
    expect(evaluation.failureReasons).toContain("unknown_claim_operator");
  });

  it("rejects when the credential has no issuer at all", () => {
    const profile = baseProfile();
    const response = validResponse();
    if (response.credential) response.credential.issuer = undefined;
    const evaluation = evaluateProfile(profile, response);
    expect(evaluation.failureReasons).toContain("unknown_issuer");
  });
});

describe("evaluateProfile — freshness", () => {
  it("accepts a proof within the freshness window", () => {
    const profile = baseProfile({ maxFreshnessSeconds: 3600 });
    const evaluation = evaluateProfile(
      profile,
      validResponse({ issuedAt: new Date(Date.now() - 60 * 1000).toISOString() }),
    );
    expect(evaluation.failureReasons).not.toContain("stale_proof");
  });

  it("rejects a proof older than the freshness window", () => {
    const profile = baseProfile({ maxFreshnessSeconds: 60 });
    const evaluation = evaluateProfile(
      profile,
      validResponse({ issuedAt: new Date(Date.now() - 3600 * 1000).toISOString() }),
    );
    expect(evaluation.failureReasons).toContain("stale_proof");
  });

  it("fails closed when issuedAt is missing (cannot confirm freshness)", () => {
    const profile = baseProfile();
    const response = validResponse();
    if (response.proof) (response.proof as { issuedAt?: string }).issuedAt = undefined;
    const evaluation = evaluateProfile(profile, response);
    expect(evaluation.failureReasons).toContain("stale_proof");
  });
});

describe("evaluateProfile — required disclosure fields", () => {
  it("accepts when all required disclosure fields are present", () => {
    const profile = baseProfile({ requiredDisclosureFields: ["thresholdAmount", "assetCode"] });
    const evaluation = evaluateProfile(profile, validResponse());
    expect(evaluation.failureReasons).not.toContain("missing_disclosure_field");
  });

  it("rejects when a required disclosure field is missing from the claim", () => {
    const profile = baseProfile({ requiredDisclosureFields: ["counterpartyWallet"] });
    const evaluation = evaluateProfile(profile, validResponse());
    expect(evaluation.failureReasons).toContain("missing_disclosure_field");
  });
});

describe("evaluateProfile — multiple simultaneous failures", () => {
  it("reports every applicable failure reason, not just the first", () => {
    const profile = baseProfile({ acceptedIssuerIds: ["someone-else"], acceptedSchemaVersions: ["9.9"] });
    const evaluation = evaluateProfile(profile, validResponse());
    expect(evaluation.accepted).toBe(false);
    expect(evaluation.failureReasons).toContain("unknown_issuer");
    expect(evaluation.failureReasons).toContain("unknown_schema_version");
  });
});
