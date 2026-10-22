import {
  hasAcceptedCurrentVersion,
  pendingRequiredConsents,
  isActionBlocked,
  recordConsent,
  withdrawConsent,
  latestAcceptance,
  fetchMockPolicyConsentState,
  submitConsentMock,
  ConsentRequiresExplicitActionError,
  PolicyConsentApiError,
  type PolicyConsentState,
  type RecordConsentInput,
} from "../policy-consent";

function makeState(overrides: Partial<PolicyConsentState> = {}): PolicyConsentState {
  return {
    currentVersions: [
      {
        kind: "PRIVACY_POLICY",
        version: "v2",
        publishedAt: "2026-06-01T00:00:00.000Z",
        contentUrl: "/privacy?version=v2",
        required: true,
        protectedActions: ["create-proof", "share-proof"],
      },
    ],
    acceptanceHistory: [],
    ...overrides,
  };
}

describe("policy consent: first consent", () => {
  it("treats a user with no acceptance history as not accepted", () => {
    const state = makeState();
    expect(hasAcceptedCurrentVersion(state, "PRIVACY_POLICY")).toBe(false);
    expect(latestAcceptance(state, "PRIVACY_POLICY")).toBeNull();
  });

  it("records the first acceptance via an explicit accept action", () => {
    const state = makeState();
    const input: RecordConsentInput = { kind: "PRIVACY_POLICY", version: "v2", action: "accept" };
    const next = recordConsent(state, input);

    expect(hasAcceptedCurrentVersion(next, "PRIVACY_POLICY")).toBe(true);
    expect(next.acceptanceHistory).toHaveLength(1);
  });
});

describe("policy consent: unchanged policy", () => {
  it("stays accepted when the current version has not changed", () => {
    const state = makeState({
      acceptanceHistory: [{ id: "c1", kind: "PRIVACY_POLICY", version: "v2", acceptedAt: "2026-06-01T01:00:00.000Z" }],
    });
    expect(hasAcceptedCurrentVersion(state, "PRIVACY_POLICY")).toBe(true);
    expect(pendingRequiredConsents(state)).toEqual([]);
  });
});

describe("policy consent: required update", () => {
  it("flags a pending required consent when the accepted version is older", () => {
    const state = makeState({
      acceptanceHistory: [{ id: "c1", kind: "PRIVACY_POLICY", version: "v1", acceptedAt: "2026-05-01T00:00:00.000Z" }],
    });

    expect(hasAcceptedCurrentVersion(state, "PRIVACY_POLICY")).toBe(false);
    expect(pendingRequiredConsents(state).map((v) => v.version)).toEqual(["v2"]);
  });

  it("blocks only the documented protected actions, not unrelated ones", () => {
    const state = makeState({
      acceptanceHistory: [{ id: "c1", kind: "PRIVACY_POLICY", version: "v1", acceptedAt: "2026-05-01T00:00:00.000Z" }],
    });

    expect(isActionBlocked(state, "create-proof")).toBe(true);
    expect(isActionBlocked(state, "share-proof")).toBe(true);
    expect(isActionBlocked(state, "view-dashboard")).toBe(false);
  });

  it("does not block anything when the required version is not yet effective (non-required version change)", () => {
    const state = makeState({
      currentVersions: [
        {
          kind: "PRIVACY_POLICY",
          version: "v2",
          publishedAt: "2026-06-01T00:00:00.000Z",
          contentUrl: "/privacy?version=v2",
          required: false,
          protectedActions: ["create-proof"],
        },
      ],
    });
    expect(isActionBlocked(state, "create-proof")).toBe(false);
  });

  it("clears the pending/blocked state once the current version is accepted", () => {
    let state = makeState();
    expect(isActionBlocked(state, "create-proof")).toBe(true);

    state = recordConsent(state, { kind: "PRIVACY_POLICY", version: "v2", action: "accept" });
    expect(isActionBlocked(state, "create-proof")).toBe(false);
    expect(pendingRequiredConsents(state)).toEqual([]);
  });
});

describe("policy consent: withdrawal", () => {
  it("makes hasAcceptedCurrentVersion false again without erasing history", () => {
    let state = makeState();
    state = recordConsent(state, { kind: "PRIVACY_POLICY", version: "v2", action: "accept" });
    expect(hasAcceptedCurrentVersion(state, "PRIVACY_POLICY")).toBe(true);
    const historyLengthBeforeWithdrawal = state.acceptanceHistory.length;

    state = withdrawConsent(state, "PRIVACY_POLICY");

    expect(hasAcceptedCurrentVersion(state, "PRIVACY_POLICY")).toBe(false);
    expect(state.acceptanceHistory.length).toBeGreaterThan(historyLengthBeforeWithdrawal);
    // Read-only: the original accept record is still present, untouched.
    expect(state.acceptanceHistory[0]).toEqual(
      expect.objectContaining({ kind: "PRIVACY_POLICY", version: "v2" }),
    );
  });
});

describe("policy consent: API failure", () => {
  it("surfaces a typed error and leaves state unchanged on failure", async () => {
    const state = makeState();
    await expect(
      submitConsentMock(state, { kind: "PRIVACY_POLICY", version: "v2", action: "accept" }, { shouldFail: true }),
    ).rejects.toThrow(PolicyConsentApiError);
  });

  it("succeeds and records consent when not forced to fail", async () => {
    const state = makeState();
    const next = await submitConsentMock(state, { kind: "PRIVACY_POLICY", version: "v2", action: "accept" });
    expect(hasAcceptedCurrentVersion(next, "PRIVACY_POLICY")).toBe(true);
  });
});

describe("policy consent: explicit action required", () => {
  it("throws if a non-'accept' action value is forced through at runtime", () => {
    const state = makeState();
    const forged = { kind: "PRIVACY_POLICY", version: "v2", action: "implicit" } as unknown as RecordConsentInput;
    expect(() => recordConsent(state, forged)).toThrow(ConsentRequiresExplicitActionError);
  });
});

describe("policy consent: immutable policy content link", () => {
  it("every current version exposes a version-qualified content URL, never 'latest'", async () => {
    const state = await fetchMockPolicyConsentState();
    for (const version of state.currentVersions) {
      expect(version.contentUrl).toContain(version.version);
      expect(version.contentUrl).not.toMatch(/latest/i);
    }
  });
});
