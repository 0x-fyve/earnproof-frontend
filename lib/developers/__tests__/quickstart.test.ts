import {
  QUICKSTART_STEPS,
  SECRET_PLACEHOLDER,
  classifyVerificationOutcome,
  createEmptyChecklistState,
  exampleContainsNoSecretInUrl,
  generateVerificationExample,
  getActiveApiVersion,
  getVerificationRoute,
  isChecklistComplete,
  markStepComplete,
  unknownScopes,
} from "../quickstart";

describe("getActiveApiVersion", () => {
  it("returns the OpenAPI fixture's exact version string", () => {
    // Hardcoded literal from lib/api/openapi/earnproof-api.v1.json's info.version,
    // not read back from the implementation's own import.
    expect(getActiveApiVersion()).toBe("1.0.0");
  });
});

describe("getVerificationRoute", () => {
  it("returns the verify-proof route template", () => {
    expect(getVerificationRoute()).toContain("/verify");
    expect(getVerificationRoute()).toContain("{id}");
  });
});

describe("unknownScopes", () => {
  it("returns an empty array when every scope is recognized", () => {
    expect(unknownScopes(["verification:read", "proofs:read"])).toEqual([]);
  });

  it("flags unrecognized scopes (negative case)", () => {
    expect(unknownScopes(["verification:read", "admin:delete-everything"])).toEqual([
      "admin:delete-everything",
    ]);
  });

  it("flags every scope when none are recognized (boundary case)", () => {
    expect(unknownScopes(["made:up", "also:fake"])).toEqual(["made:up", "also:fake"]);
  });
});

describe("generateVerificationExample", () => {
  const baseOptions = {
    organizationId: "org-123",
    apiBaseUrl: "https://api.earnproof.test/v1",
  };

  it.each(["curl", "node", "python"] as const)(
    "never embeds a real-looking secret, only the placeholder, for %s",
    (runtime) => {
      const example = generateVerificationExample({ ...baseOptions, runtime });
      expect(example).toContain(SECRET_PLACEHOLDER);
      expect(exampleContainsNoSecretInUrl(example)).toBe(true);
    },
  );

  it("marks every example as synthetic", () => {
    for (const runtime of ["curl", "node", "python"] as const) {
      const example = generateVerificationExample({ ...baseOptions, runtime });
      expect(example.toLowerCase()).toContain("synthetic");
    }
  });

  it("includes the organization id as a header, not in the URL, when provided", () => {
    const example = generateVerificationExample({ ...baseOptions, runtime: "curl" });
    expect(example).toContain("X-Organization-Id: org-123");
    const urlLine = example.split("\n").find((line) => line.includes("curl -X GET"));
    expect(urlLine).not.toContain("org-123");
  });

  it("omits the organization header entirely when no organization is active (boundary case)", () => {
    const example = generateVerificationExample({
      runtime: "curl",
      organizationId: null,
      apiBaseUrl: "https://api.earnproof.test/v1",
    });
    expect(example).not.toContain("X-Organization-Id");
  });

  it("targets a clearly-fake proof id by default", () => {
    const example = generateVerificationExample({ ...baseOptions, runtime: "node" });
    expect(example).toContain("SYNTHETIC-TEST-PROOF");
  });

  it("stamps the active API contract version into the example", () => {
    const example = generateVerificationExample({ ...baseOptions, runtime: "python" });
    expect(example).toContain("1.0.0");
  });
});

describe("exampleContainsNoSecretInUrl", () => {
  it("fails closed if a future regression leaks the placeholder into a URL line", () => {
    const regressed = `curl -X GET "https://api.example.com/verify?token=${SECRET_PLACEHOLDER}"`;
    expect(exampleContainsNoSecretInUrl(regressed)).toBe(false);
  });
});

describe("markStepComplete / isChecklistComplete", () => {
  it("completes steps in order", () => {
    let state = createEmptyChecklistState();
    for (const step of QUICKSTART_STEPS) {
      state = markStepComplete(state, step);
      expect(state.completedSteps).toContain(step);
    }
    expect(isChecklistComplete(state)).toBe(true);
  });

  it("refuses to complete a step out of order (negative/authorization-shaped case)", () => {
    const state = createEmptyChecklistState();
    const outOfOrder = markStepComplete(state, "test-request");
    expect(outOfOrder.completedSteps).toEqual([]);
    expect(outOfOrder).toBe(state);
  });

  it("is idempotent when a step is already complete", () => {
    let state = createEmptyChecklistState();
    state = markStepComplete(state, "select-scopes");
    const again = markStepComplete(state, "select-scopes");
    expect(again.completedSteps).toEqual(["select-scopes"]);
  });

  it("an empty checklist is never reported complete (boundary case)", () => {
    expect(isChecklistComplete(createEmptyChecklistState())).toBe(false);
  });
});

describe("classifyVerificationOutcome", () => {
  it("classifies a null error as success", () => {
    expect(classifyVerificationOutcome(null)).toBe("success");
  });

  it("classifies 403 as missing-scope", () => {
    expect(classifyVerificationOutcome({ status: 403 })).toBe("missing-scope");
  });

  it("classifies 401 as expired-key", () => {
    expect(classifyVerificationOutcome({ status: 401 })).toBe("expired-key");
  });

  it("classifies 409 as version-mismatch", () => {
    expect(classifyVerificationOutcome({ status: 409 })).toBe("version-mismatch");
  });

  it("classifies any other status as unknown-error (regression case)", () => {
    expect(classifyVerificationOutcome({ status: 500 })).toBe("unknown-error");
  });
});
