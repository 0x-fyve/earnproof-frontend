import {
  compareCredentialWithPublicState,
  extractImportedCredentialSummary,
  type ImportedCredentialSummary,
} from "../public-state-comparison";
import type { VerifyProofResponse } from "@/components/verification/verification-panel";

function importedCredential(overrides: Partial<ImportedCredentialSummary> = {}): ImportedCredentialSummary {
  return {
    id: "proof-1",
    issuer: "issuer-1",
    schemaVersion: "1.0",
    proofType: "minimum_income",
    expiresAt: "2026-12-31T00:00:00.000Z",
    issuedAt: "2026-01-01T00:00:00.000Z",
    claim: {
      operator: "gte",
      thresholdAmount: "1000",
      assetCode: "USDC",
      assetIssuer: null,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-31T00:00:00.000Z",
      qualifyingPaymentCount: 3,
    },
    ...overrides,
  };
}

function serverResponse(overrides: {
  schemaVersion?: string;
  proofType?: string;
  expiresAt?: string;
  revokedAt?: string | null;
  claim?: Record<string, unknown>;
  noProof?: boolean;
} = {}): VerifyProofResponse {
  if (overrides.noProof) {
    return { result: "UNKNOWN_PROOF", status: "unknown" };
  }

  return {
    result: "VALID",
    status: "valid",
    proof: {
      id: "proof-1",
      type: overrides.proofType ?? "minimum_income",
      schemaVersion: overrides.schemaVersion ?? "1.0",
      network: "testnet",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: overrides.expiresAt ?? "2026-12-31T00:00:00.000Z",
      revokedAt: overrides.revokedAt ?? null,
    },
    credential: {
      id: "proof-1",
      schemaVersion: overrides.schemaVersion ?? "1.0",
      subject: { walletHash: "wh-1" },
      claim: {
        operator: "gte",
        thresholdAmount: "1000",
        assetCode: "USDC",
        assetIssuer: null,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-31T00:00:00.000Z",
        qualifyingPaymentCount: 3,
        ...(overrides.claim ?? {}),
      },
      privacy: { exactIncomeHidden: false, sourceTransactionsHidden: false },
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: overrides.expiresAt ?? "2026-12-31T00:00:00.000Z",
      proof: { type: overrides.proofType ?? "minimum_income", credentialHash: "hash", signature: "sig" },
    },
  };
}

describe("extractImportedCredentialSummary", () => {
  it("extracts id, issuer, schemaVersion, proofType, expiresAt, issuedAt, and claim", () => {
    const summary = extractImportedCredentialSummary({
      id: "proof-1",
      issuer: "issuer-1",
      schemaVersion: "1.0",
      expiresAt: "2026-12-31T00:00:00.000Z",
      issuedAt: "2026-01-01T00:00:00.000Z",
      proof: { type: "minimum_income" },
      claim: { operator: "gte" },
      subject: { walletHash: "should-not-be-extracted" },
    });

    expect(summary).toEqual({
      id: "proof-1",
      issuer: "issuer-1",
      schemaVersion: "1.0",
      proofType: "minimum_income",
      expiresAt: "2026-12-31T00:00:00.000Z",
      issuedAt: "2026-01-01T00:00:00.000Z",
      claim: { operator: "gte" },
    });
    // The extracted summary has no `subject` field at all.
    expect(summary).not.toHaveProperty("subject");
  });

  it("returns null for a malformed (non-object) input", () => {
    expect(extractImportedCredentialSummary("not an object")).toBeNull();
    expect(extractImportedCredentialSummary(null)).toBeNull();
    expect(extractImportedCredentialSummary(["array"])).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(extractImportedCredentialSummary({ issuer: "x" })).toBeNull();
  });

  it("degrades gracefully (nulls) for missing optional fields rather than throwing", () => {
    const summary = extractImportedCredentialSummary({ id: "proof-1" });
    expect(summary).toEqual({
      id: "proof-1",
      issuer: null,
      schemaVersion: null,
      proofType: null,
      expiresAt: null,
      issuedAt: null,
      claim: null,
    });
  });
});

describe("compareCredentialWithPublicState — exact match", () => {
  it("reports exact_match when every compared field agrees", () => {
    const result = compareCredentialWithPublicState(importedCredential(), serverResponse());
    expect(result.outcome).toBe("exact_match");
    expect(result.mismatches).toEqual([]);
  });
});

describe("compareCredentialWithPublicState — field mismatches", () => {
  it("detects a schema version mismatch", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ schemaVersion: "1.0" }),
      serverResponse({ schemaVersion: "1.0" }),
    );
    expect(result.outcome).toBe("exact_match");

    const mismatchResult = compareCredentialWithPublicState(
      importedCredential({ schemaVersion: "1.1" }),
      serverResponse({ schemaVersion: "1.0" }),
    );
    expect(mismatchResult.outcome).toBe("field_mismatch");
    expect(mismatchResult.mismatches.map((m) => m.kind)).toContain("schema_version");
  });

  it("detects a proof type mismatch", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ proofType: "recurring_income" }),
      serverResponse({ proofType: "minimum_income" }),
    );
    expect(result.outcome).toBe("field_mismatch");
    expect(result.mismatches.map((m) => m.kind)).toContain("proof_type");
  });

  it("detects an expiry mismatch", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ expiresAt: "2026-06-30T00:00:00.000Z" }),
      serverResponse({ expiresAt: "2026-12-31T00:00:00.000Z" }),
    );
    expect(result.outcome).toBe("field_mismatch");
    expect(result.mismatches.map((m) => m.kind)).toContain("expires_at");
  });

  it("detects a committed-metadata (claim shape) mismatch", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ claim: { operator: "gte", thresholdAmount: "1000" } }),
      serverResponse({ claim: { operator: "gte", thresholdAmount: "1000", extraField: "x" } }),
    );
    expect(result.outcome).toBe("field_mismatch");
    expect(result.mismatches.map((m) => m.kind)).toContain("committed_metadata");
  });

  it("reports every applicable mismatch, not just the first", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ schemaVersion: "1.1", proofType: "recurring_income" }),
      serverResponse({ schemaVersion: "1.0", proofType: "minimum_income" }),
    );
    expect(result.mismatches.map((m) => m.kind)).toEqual(
      expect.arrayContaining(["schema_version", "proof_type"]),
    );
  });
});

describe("compareCredentialWithPublicState — stale", () => {
  it("reports stale when the public record has expired", () => {
    const result = compareCredentialWithPublicState(
      importedCredential(),
      serverResponse({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect(result.outcome).toBe("stale");
    expect(result.mismatches).toEqual([]);
  });
});

describe("compareCredentialWithPublicState — revoked", () => {
  it("reports revoked when the public record has a revokedAt timestamp", () => {
    const result = compareCredentialWithPublicState(
      importedCredential(),
      serverResponse({ revokedAt: "2026-02-01T00:00:00.000Z" }),
    );
    expect(result.outcome).toBe("revoked");
  });

  it("revocation takes priority over staleness when both apply", () => {
    const result = compareCredentialWithPublicState(
      importedCredential(),
      serverResponse({
        revokedAt: "2026-02-01T00:00:00.000Z",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    expect(result.outcome).toBe("revoked");
  });
});

describe("compareCredentialWithPublicState — superseded", () => {
  it("reports superseded when the public record's schema version has moved forward", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ schemaVersion: "1.0" }),
      serverResponse({ schemaVersion: "2.0" }),
    );
    expect(result.outcome).toBe("superseded");
  });

  it("does not report superseded when schema versions are equal", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ schemaVersion: "1.0" }),
      serverResponse({ schemaVersion: "1.0" }),
    );
    expect(result.outcome).not.toBe("superseded");
  });

  it("does not report superseded when the imported version is newer (fails closed, no reverse-supersession claimed)", () => {
    const result = compareCredentialWithPublicState(
      importedCredential({ schemaVersion: "2.0" }),
      serverResponse({ schemaVersion: "1.0" }),
    );
    expect(result.outcome).not.toBe("superseded");
  });
});

describe("compareCredentialWithPublicState — unknown proof", () => {
  it("reports unknown_proof when the server has no proof record at all", () => {
    const result = compareCredentialWithPublicState(importedCredential(), serverResponse({ noProof: true }));
    expect(result.outcome).toBe("unknown_proof");
    expect(result.currentProof).toBeNull();
  });
});

describe("compareCredentialWithPublicState — signature independence", () => {
  it("never reads response.result or response.status to decide its own outcome", () => {
    // Same field-identical response, but with every possible signature
    // result value — the comparison outcome must not change with it.
    const results: VerifyProofResponse["result"][] = [
      "VALID",
      "EXPIRED",
      "REVOKED",
      "INVALID_SIGNATURE",
      "UNVERIFIED_ISSUER",
    ];

    const outcomes = results.map((signatureResult) => {
      const response = { ...serverResponse(), result: signatureResult };
      return compareCredentialWithPublicState(importedCredential(), response).outcome;
    });

    expect(new Set(outcomes).size).toBe(1);
    expect(outcomes[0]).toBe("exact_match");
  });
});
