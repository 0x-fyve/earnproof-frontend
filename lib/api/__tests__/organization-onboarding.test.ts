import {
  countIncompleteRequired,
  fetchMockOnboardingChecklist,
  fetchMockOnboardingChecklistForViewer,
  isChecklistReady,
  visibleChecks,
} from "../organization-onboarding";

describe("organization-onboarding: new organization", () => {
  it("has no complete checks and is not ready", async () => {
    const checklist = await fetchMockOnboardingChecklist("org-new");
    expect(checklist.state).toBe("new");
    expect(isChecklistReady(checklist)).toBe(false);
    expect(checklist.checks.every((check) => check.status === "incomplete")).toBe(true);
    expect(countIncompleteRequired(checklist)).toBeGreaterThan(0);
  });
});

describe("organization-onboarding: partial organization", () => {
  it("is not ready while required checks remain incomplete", async () => {
    const checklist = await fetchMockOnboardingChecklist("org-partial");
    expect(checklist.state).toBe("partial");
    expect(isChecklistReady(checklist)).toBe(false);
    expect(countIncompleteRequired(checklist)).toBeGreaterThan(0);
  });
});

describe("organization-onboarding: ready organization", () => {
  it("is ready once every required check is complete", async () => {
    const checklist = await fetchMockOnboardingChecklist("org-ready");
    expect(checklist.state).toBe("ready");
    expect(isChecklistReady(checklist)).toBe(true);
    expect(countIncompleteRequired(checklist)).toBe(0);
  });
});

describe("organization-onboarding: degraded organization", () => {
  it("is not ready when a required check regresses to incomplete", async () => {
    const checklist = await fetchMockOnboardingChecklist("org-degraded");
    expect(checklist.state).toBe("degraded");
    expect(isChecklistReady(checklist)).toBe(false);
    const assetCheck = checklist.checks.find((check) => check.id === "asset-setup");
    expect(assetCheck?.status).toBe("incomplete");
  });
});

describe("organization-onboarding: archived organization", () => {
  it("marks credential-related checks unavailable rather than incomplete", async () => {
    const checklist = await fetchMockOnboardingChecklist("org-archived");
    expect(checklist.state).toBe("archived");
    const keyCheck = checklist.checks.find((check) => check.id === "key-creation");
    expect(keyCheck?.status).toBe("unavailable");
    // Readiness only looks at required checks that are explicitly incomplete;
    // an "unavailable" required check does not count as ready either.
    expect(isChecklistReady(checklist)).toBe(false);
  });
});

describe("organization-onboarding: authorization", () => {
  it("hides checks a MEMBER is not authorized to see, instead of marking them incomplete", async () => {
    const checklist = await fetchMockOnboardingChecklistForViewer("org-new", "MEMBER");
    const keyCheck = checklist.checks.find((check) => check.id === "key-creation");
    expect(keyCheck?.authorized).toBe(false);
    expect(keyCheck?.actionHref).toBeNull();

    const visible = visibleChecks(checklist);
    expect(visible.some((check) => check.id === "key-creation")).toBe(false);
  });

  it("shows every check to an OWNER", async () => {
    const checklist = await fetchMockOnboardingChecklistForViewer("org-new", "OWNER");
    expect(checklist.checks.every((check) => check.authorized)).toBe(true);
  });

  it("hides the same checks for a VIEWER as for a MEMBER", async () => {
    const checklist = await fetchMockOnboardingChecklistForViewer("org-new", "VIEWER");
    const webhookCheck = checklist.checks.find((check) => check.id === "webhook-setup");
    expect(webhookCheck?.authorized).toBe(false);
  });
});

describe("organization-onboarding: incomplete checks link to the resolving page", () => {
  it("gives each incomplete required check a real actionHref", async () => {
    const checklist = await fetchMockOnboardingChecklist("org-new");
    const requiredIncomplete = checklist.checks.filter(
      (check) => check.required && check.status === "incomplete",
    );
    expect(requiredIncomplete.length).toBeGreaterThan(0);
    for (const check of requiredIncomplete) {
      expect(check.actionHref).toMatch(/^\//);
    }
  });
});

describe("organization-onboarding: abort handling", () => {
  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchMockOnboardingChecklist("org-new", { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
