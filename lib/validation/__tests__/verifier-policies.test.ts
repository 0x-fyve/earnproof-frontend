import { findStaleIssuerReferences, validatePolicyProfileForm } from "../verifier-policies";
import type { Issuer } from "@/lib/api/generated/v1";

describe("validatePolicyProfileForm", () => {
  const validInput = {
    name: "My profile",
    description: "",
    acceptedIssuerIds: ["issuer-1"],
    acceptedSchemaVersions: ["1.0"],
    acceptedProofTypes: ["minimum_income"],
    maxFreshnessSeconds: 3600,
    requiredDisclosureFields: [],
  };

  it("accepts a well-formed profile", () => {
    const result = validatePolicyProfileForm(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects a name shorter than 3 characters", () => {
    const result = validatePolicyProfileForm({ ...validInput, name: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty accepted-issuers list (would accept no issuers, but must be explicit)", () => {
    const result = validatePolicyProfileForm({ ...validInput, acceptedIssuerIds: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/issuer/i);
    }
  });

  it("rejects an empty accepted-schema-versions list", () => {
    const result = validatePolicyProfileForm({ ...validInput, acceptedSchemaVersions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty accepted-proof-types list", () => {
    const result = validatePolicyProfileForm({ ...validInput, acceptedProofTypes: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a freshness value below the minimum", () => {
    const result = validatePolicyProfileForm({ ...validInput, maxFreshnessSeconds: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects a freshness value above the maximum", () => {
    const result = validatePolicyProfileForm({ ...validInput, maxFreshnessSeconds: 999_999_999 });
    expect(result.success).toBe(false);
  });
});

describe("findStaleIssuerReferences", () => {
  const knownIssuers: Issuer[] = [
    { id: "issuer-active", name: "Active Issuer", status: "ACTIVE" },
    { id: "issuer-revoked", name: "Revoked Issuer", status: "REVOKED" },
  ];

  it("returns no stale references when all accepted issuers are active", () => {
    const stale = findStaleIssuerReferences(["issuer-active"], knownIssuers);
    expect(stale).toEqual([]);
  });

  it("flags an accepted issuer that has since been revoked", () => {
    const stale = findStaleIssuerReferences(["issuer-active", "issuer-revoked"], knownIssuers);
    expect(stale).toEqual(["issuer-revoked"]);
  });

  it("flags an accepted issuer that no longer exists on the server at all", () => {
    const stale = findStaleIssuerReferences(["issuer-deleted"], knownIssuers);
    expect(stale).toEqual(["issuer-deleted"]);
  });
});
