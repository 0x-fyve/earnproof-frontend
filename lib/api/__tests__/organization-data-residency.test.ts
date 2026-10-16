import {
  DATA_RESIDENCY_POLICY_SCHEMA_VERSION,
  applyResidencyUpdate,
  compareResidencyVersions,
  computeComplianceStatus,
  computeMigrationBlockers,
  defaultDataResidencyPolicy,
  fetchMockDataResidencyPolicy,
  getRegionCapability,
  isRegionSupportedForClass,
  isResidencyPolicyValid,
  summarizeResidencyImpact,
  validateResidencyPolicy,
  type DataResidencyPolicy,
} from "../organization-data-residency";

function policy(overrides: Partial<DataResidencyPolicy> = {}): DataResidencyPolicy {
  return { ...defaultDataResidencyPolicy(), ...overrides };
}

describe("data-residency: region capability checks", () => {
  it("exposes a capability document per region", () => {
    expect(getRegionCapability("eu-west")?.supportedDataClasses).toContain("payment-records");
  });

  it("rejects a region that does not support the data class", () => {
    // us-west supports proofs/audit-logs/backups, but not personal-data.
    expect(isRegionSupportedForClass("us-west", "personal-data")).toBe(false);
    expect(isRegionSupportedForClass("us-west", "proofs")).toBe(true);
  });

  it("rejects deprecated regions even for a supported class", () => {
    // ap-northeast supports proofs but is deprecated.
    expect(isRegionSupportedForClass("ap-northeast", "proofs")).toBe(false);
  });
});

describe("data-residency: validation", () => {
  it("accepts the default policy", () => {
    expect(validateResidencyPolicy(policy())).toEqual([]);
    expect(isResidencyPolicyValid(policy())).toBe(true);
  });

  it("fails closed for an unsupported schema version", () => {
    const issues = validateResidencyPolicy(policy({ schemaVersion: 999 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "schemaVersion", severity: "error" });
  });

  it("requires at least one region per data class", () => {
    const invalid = policy({ placements: { ...policy().placements, backups: [] } });
    expect(isResidencyPolicyValid(invalid)).toBe(false);
    expect(
      validateResidencyPolicy(invalid).some((issue) => issue.field === "placements.backups"),
    ).toBe(true);
  });

  it("rejects selecting an unsupported region for a class", () => {
    const invalid = policy({
      placements: { ...policy().placements, "personal-data": ["us-west"] },
    });
    expect(
      validateResidencyPolicy(invalid).some((issue) =>
        /cannot store personal-data/.test(issue.message),
      ),
    ).toBe(true);
  });

  it("rejects a missing or deprecated background-job region", () => {
    expect(isResidencyPolicyValid(policy({ backgroundJobRegion: null }))).toBe(false);
    expect(isResidencyPolicyValid(policy({ backgroundJobRegion: "ap-northeast" }))).toBe(false);
  });
});

describe("data-residency: compliance status", () => {
  it("reports compliant only when validated, migrated and rolled out", () => {
    expect(computeComplianceStatus(policy()).status).toBe("compliant");
  });

  it("does not imply compliance before server validation", () => {
    const status = computeComplianceStatus(policy({ serverValidation: "pending" }));
    expect(status.status).toBe("awaiting-server-validation");
  });

  it("does not imply compliance while a migration is incomplete", () => {
    const status = computeComplianceStatus(
      policy({ migration: { ...policy().migration, proofs: "in-progress" } }),
    );
    expect(status.status).toBe("migration-incomplete");
    expect(status.reasons.join(" ")).toMatch(/proofs/);
  });

  it("does not imply compliance while the rollout is incomplete", () => {
    const status = computeComplianceStatus(
      policy({ rollout: { status: "in-progress" } }),
    );
    expect(status.status).toBe("migration-incomplete");
    expect(status.reasons.join(" ")).toMatch(/rollout/i);
  });

  it("reports invalid selections as invalid, not compliant", () => {
    const status = computeComplianceStatus(
      policy({ placements: { ...policy().placements, "personal-data": ["us-west"] } }),
    );
    expect(status.status).toBe("invalid");
  });
});

describe("data-residency: migration blockers", () => {
  it("blocks a placement change while the class is still migrating", () => {
    const current = policy({ migration: { ...policy().migration, proofs: "in-progress" } });
    const next = policy({
      ...current,
      placements: { ...current.placements, proofs: ["us-east"] },
    });
    const blockers = computeMigrationBlockers(current, next);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].dataClass).toBe("proofs");
  });

  it("allows a placement change once migration is complete", () => {
    const current = policy();
    const next = policy({
      ...current,
      placements: { ...current.placements, proofs: ["us-east"] },
    });
    expect(computeMigrationBlockers(current, next)).toEqual([]);
  });
});

describe("data-residency: fail-closed apply", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("applies a valid change, increments the version and re-pends validation", () => {
    const current = policy({ policyVersion: 2 });
    const draft = policy({
      policyVersion: 2,
      placements: { ...current.placements, proofs: ["us-east", "eu-west", "ap-southeast"] },
    });
    const outcome = applyResidencyUpdate({ current, draft, expectedVersion: 2, now });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.policy.policyVersion).toBe(3);
      expect(outcome.policy.serverValidation).toBe("pending");
      expect(outcome.policy.rollout.status).toBe("not-started");
    }
  });

  it("fails closed on a stale/replayed version", () => {
    const outcome = applyResidencyUpdate({
      current: policy({ policyVersion: 5 }),
      draft: policy({ policyVersion: 4 }),
      expectedVersion: 4,
      now,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("stale");
    }
  });

  it("fails closed on a forward version conflict", () => {
    const outcome = applyResidencyUpdate({
      current: policy({ policyVersion: 1 }),
      draft: policy({ policyVersion: 2 }),
      expectedVersion: 2,
      now,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("conflict");
    }
  });

  it("rejects an unsupported region selection as invalid", () => {
    const current = policy();
    const outcome = applyResidencyUpdate({
      current,
      draft: policy({ placements: { ...current.placements, "personal-data": ["us-west"] } }),
      expectedVersion: current.policyVersion,
      now,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("invalid");
    }
  });

  it("blocks a change while a migration is incomplete", () => {
    const current = policy({
      migration: { ...policy().migration, "audit-logs": "in-progress" },
    });
    const outcome = applyResidencyUpdate({
      current,
      draft: policy({
        ...current,
        placements: { ...current.placements, "audit-logs": ["us-east", "eu-central"] },
      }),
      expectedVersion: current.policyVersion,
      now,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("blocked");
    }
  });
});

describe("data-residency: impact + version comparison", () => {
  it("summarizes added and removed placements", () => {
    const current = policy();
    const next = policy({
      ...current,
      placements: { ...current.placements, backups: ["us-west", "eu-west"] },
    });
    const impact = summarizeResidencyImpact(current, next);
    expect(impact.addedPlacements).toContainEqual({ dataClass: "backups", region: "eu-west" });
    expect(impact.notes.join(" ")).toMatch(/eu-west will additionally store backups/);
  });

  it("reports no effective change as such", () => {
    const current = policy();
    expect(summarizeResidencyImpact(current, { ...current }).notes).toEqual([
      "No effective change.",
    ]);
  });

  it("compares placements field by field", () => {
    const before = policy({ policyVersion: 1 });
    const after = policy({
      policyVersion: 2,
      placements: { ...before.placements, proofs: ["us-east"] },
    });
    const changes = compareResidencyVersions(before, after);
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "policyVersion", before: "1", after: "2" },
        { field: "placements.proofs", before: "eu-west, us-east", after: "us-east" },
      ]),
    );
  });

  it("returns no changes for an identical policy", () => {
    expect(compareResidencyVersions(policy(), policy())).toEqual([]);
  });
});

describe("data-residency: fixture", () => {
  it("returns the default policy", async () => {
    const response = await fetchMockDataResidencyPolicy();
    expect(response.policy.schemaVersion).toBe(DATA_RESIDENCY_POLICY_SCHEMA_VERSION);
    expect(response.history).toEqual([]);
  });

  it("honors overrides", async () => {
    const response = await fetchMockDataResidencyPolicy({ policyVersion: 7 });
    expect(response.policy.policyVersion).toBe(7);
  });
});
