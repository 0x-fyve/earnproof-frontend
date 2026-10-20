import {
  archivePolicyProfile,
  createPolicyProfile,
  duplicatePolicyProfile,
  listPolicyProfiles,
  listSelectableProfiles,
  PolicyProfileNotFoundError,
  reactivatePolicyProfile,
  updatePolicyProfile,
} from "../store";

const USER_A = "user-a";
const USER_B = "user-b";

function sampleInput(overrides: Partial<Parameters<typeof createPolicyProfile>[1]> = {}) {
  return {
    name: "Default risk profile",
    description: "Accepts verified issuers only",
    acceptedIssuerIds: ["issuer-1"],
    acceptedSchemaVersions: ["1.0"],
    acceptedProofTypes: ["minimum_income"],
    maxFreshnessSeconds: 3600,
    requiredDisclosureFields: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("verifier policy store — CRUD", () => {
  it("creates and lists a profile", () => {
    createPolicyProfile(USER_A, sampleInput());
    const profiles = listPolicyProfiles(USER_A);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Default risk profile");
    expect(profiles[0].status).toBe("active");
  });

  it("updates an existing profile", () => {
    const created = createPolicyProfile(USER_A, sampleInput());
    const updated = updatePolicyProfile(USER_A, created.id, { name: "Renamed profile" });
    expect(updated.name).toBe("Renamed profile");
    expect(listPolicyProfiles(USER_A)[0].name).toBe("Renamed profile");
  });

  it("throws PolicyProfileNotFoundError when updating a nonexistent profile", () => {
    expect(() => updatePolicyProfile(USER_A, "does-not-exist", { name: "x" })).toThrow(
      PolicyProfileNotFoundError,
    );
  });
});

describe("verifier policy store — duplication", () => {
  it("duplicates a profile as an independent copy", () => {
    const original = createPolicyProfile(USER_A, sampleInput());
    const copy = duplicatePolicyProfile(USER_A, original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Default risk profile (Copy)");
    expect(copy.status).toBe("active");

    // Editing the copy must not mutate the original.
    updatePolicyProfile(USER_A, copy.id, { name: "Edited copy" });
    const refetchedOriginal = listPolicyProfiles(USER_A).find((p) => p.id === original.id);
    expect(refetchedOriginal?.name).toBe("Default risk profile");
  });

  it("can duplicate an archived profile, producing a fresh active copy", () => {
    const original = createPolicyProfile(USER_A, sampleInput());
    archivePolicyProfile(USER_A, original.id);

    const copy = duplicatePolicyProfile(USER_A, original.id);
    expect(copy.status).toBe("active");
  });
});

describe("verifier policy store — archive lifecycle", () => {
  it("archived profiles are excluded from listSelectableProfiles", () => {
    const profile = createPolicyProfile(USER_A, sampleInput());
    expect(listSelectableProfiles(USER_A)).toHaveLength(1);

    archivePolicyProfile(USER_A, profile.id);
    expect(listSelectableProfiles(USER_A)).toHaveLength(0);
    // Still visible in the full list, just not selectable.
    expect(listPolicyProfiles(USER_A)).toHaveLength(1);
  });

  it("reactivating an archived profile makes it selectable again", () => {
    const profile = createPolicyProfile(USER_A, sampleInput());
    archivePolicyProfile(USER_A, profile.id);
    reactivatePolicyProfile(USER_A, profile.id);
    expect(listSelectableProfiles(USER_A)).toHaveLength(1);
  });
});

describe("verifier policy store — tenant isolation", () => {
  it("one user's profiles are never visible to another user", () => {
    createPolicyProfile(USER_A, sampleInput({ name: "User A's profile" }));
    createPolicyProfile(USER_B, sampleInput({ name: "User B's profile" }));

    const aProfiles = listPolicyProfiles(USER_A);
    const bProfiles = listPolicyProfiles(USER_B);

    expect(aProfiles).toHaveLength(1);
    expect(bProfiles).toHaveLength(1);
    expect(aProfiles[0].name).toBe("User A's profile");
    expect(bProfiles[0].name).toBe("User B's profile");
  });

  it("archiving one user's profile does not affect another user's profile with the same id collision risk", () => {
    const aProfile = createPolicyProfile(USER_A, sampleInput());
    createPolicyProfile(USER_B, sampleInput());

    archivePolicyProfile(USER_A, aProfile.id);

    expect(listSelectableProfiles(USER_A)).toHaveLength(0);
    expect(listSelectableProfiles(USER_B)).toHaveLength(1);
  });
});
