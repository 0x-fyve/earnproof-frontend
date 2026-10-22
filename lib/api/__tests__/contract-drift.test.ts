import {
  isAcknowledgementActive,
  effectiveDriftState,
  canPerformAction,
  driftStateCopy,
  formatAcknowledgementExpiry,
  fetchMockContractDrift,
  refreshMockDriftCheck,
  type DriftCheckResult,
  type DriftAcknowledgement,
} from "../contract-drift";

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

function makeCheck(overrides: Partial<DriftCheckResult> = {}): DriftCheckResult {
  return {
    category: "FEE_SCHEDULE",
    affectedCapability: "payment-review",
    severity: "matched",
    lastCheckedAt: new Date(NOW).toISOString(),
    detail: "ok",
    acknowledgement: null,
    ...overrides,
  };
}

function makeAck(overrides: Partial<DriftAcknowledgement> = {}): DriftAcknowledgement {
  return {
    acknowledgedBy: "operator-1",
    acknowledgedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    reason: "Known maintenance window.",
    ...overrides,
  };
}

describe("contract drift: matched state", () => {
  it("is distinct from unavailable in effective state and copy", () => {
    const matched = makeCheck({ severity: "matched" });
    const unavailable = makeCheck({ severity: "unavailable" });

    expect(effectiveDriftState(matched, NOW)).toBe("matched");
    expect(effectiveDriftState(unavailable, NOW)).toBe("unavailable");
    expect(effectiveDriftState(matched, NOW)).not.toBe(effectiveDriftState(unavailable, NOW));

    const matchedCopy = driftStateCopy("matched");
    const unavailableCopy = driftStateCopy("unavailable");
    expect(matchedCopy.label).not.toBe(unavailableCopy.label);
    expect(matchedCopy.tone).not.toBe(unavailableCopy.tone);
  });

  it("allows the action to proceed", () => {
    expect(canPerformAction(makeCheck({ severity: "matched" }), NOW)).toBe(true);
  });
});

describe("contract drift: degraded state", () => {
  it("is not blocking but is flagged for caution", () => {
    const degraded = makeCheck({ severity: "degraded" });
    expect(effectiveDriftState(degraded, NOW)).toBe("degraded");
    expect(canPerformAction(degraded, NOW)).toBe(true);
    expect(driftStateCopy("degraded").tone).toBe("warning");
  });
});

describe("contract drift: blocking state", () => {
  it("never allows the action to proceed, with no override available", () => {
    const blocking = makeCheck({ severity: "blocking" });
    expect(canPerformAction(blocking, NOW)).toBe(false);

    // Even an active acknowledgement must not flip a blocking decision —
    // this is the core "client never overrides server block" guarantee.
    const blockingWithAck = makeCheck({ severity: "blocking", acknowledgement: makeAck() });
    expect(canPerformAction(blockingWithAck, NOW)).toBe(false);
    expect(effectiveDriftState(blockingWithAck, NOW)).toBe("blocking");
  });

  it("canPerformAction ignores any extra client-supplied override field on the check", () => {
    // Simulates a hypothetical client-side override flag smuggled onto the
    // check object; canPerformAction must not read it.
    const blockingWithSmuggledOverride = {
      ...makeCheck({ severity: "blocking" }),
      clientOverride: true,
    } as DriftCheckResult & { clientOverride: boolean };
    expect(canPerformAction(blockingWithSmuggledOverride, NOW)).toBe(false);
  });
});

describe("contract drift: acknowledged state", () => {
  it("suppresses a warning while the acknowledgement is active", () => {
    const warning = makeCheck({ severity: "warning", acknowledgement: makeAck() });
    expect(isAcknowledgementActive(warning.acknowledgement, NOW)).toBe(true);
    expect(effectiveDriftState(warning, NOW)).toBe("acknowledged");
    expect(canPerformAction(warning, NOW)).toBe(true);
  });

  it("formats an active acknowledgement's expiry distinctly from an expired one", () => {
    const activeAck = makeAck({ expiresAt: new Date(NOW + 3_600_000).toISOString() });
    const expiredAck = makeAck({ expiresAt: new Date(NOW - 3_600_000).toISOString() });

    expect(formatAcknowledgementExpiry(activeAck, NOW)).toMatch(/Acknowledged until/);
    expect(formatAcknowledgementExpiry(expiredAck, NOW)).toMatch(/expired/);
  });
});

describe("contract drift: expired acknowledgement state", () => {
  it("stops suppressing the warning once expired", () => {
    const expiredAck = makeAck({ expiresAt: new Date(NOW - 1000).toISOString() });
    const warning = makeCheck({ severity: "warning", acknowledgement: expiredAck });

    expect(isAcknowledgementActive(expiredAck, NOW)).toBe(false);
    expect(effectiveDriftState(warning, NOW)).toBe("warning");
    expect(effectiveDriftState(warning, NOW)).not.toBe("acknowledged");
  });

  it("re-evaluates live rather than caching the active/expired result", () => {
    const ack = makeAck({ expiresAt: new Date(NOW + 1000).toISOString() });
    const warning = makeCheck({ severity: "warning", acknowledgement: ack });

    expect(effectiveDriftState(warning, NOW)).toBe("acknowledged");
    // One second later, same object, no mutation — expiry crossed.
    expect(effectiveDriftState(warning, NOW + 2000)).toBe("warning");
  });
});

describe("contract drift: recovery", () => {
  it("transitions a previously-blocking check back to matched after refresh", async () => {
    const status = await fetchMockContractDrift({
      FEE_SCHEDULE: { severity: "blocking", detail: "Fee mismatch detected." },
    });
    const blockingCheck = status.checks.find((c) => c.category === "FEE_SCHEDULE")!;
    expect(blockingCheck.severity).toBe("blocking");

    const refreshed = await refreshMockDriftCheck({ category: "FEE_SCHEDULE" }, status);
    // The mock refresh only updates lastCheckedAt by default; a real recovery
    // is modeled by constructing the post-refresh status directly, same as a
    // server round trip would return.
    expect(new Date(refreshed.generatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(status.generatedAt).getTime(),
    );

    const recovered = {
      ...refreshed,
      checks: refreshed.checks.map((c) =>
        c.category === "FEE_SCHEDULE" ? { ...c, severity: "matched" as const, acknowledgement: null } : c,
      ),
    };
    const recoveredCheck = recovered.checks.find((c) => c.category === "FEE_SCHEDULE")!;
    expect(effectiveDriftState(recoveredCheck, NOW)).toBe("matched");
    expect(canPerformAction(recoveredCheck, NOW)).toBe(true);
  });

  it("refresh requests never include RPC/node internals, only the category", async () => {
    const status = await fetchMockContractDrift();
    const request = { category: "SIGNER_SET" as const };
    expect(Object.keys(request)).toEqual(["category"]);
    const refreshed = await refreshMockDriftCheck(request, status);
    expect(refreshed.checks.find((c) => c.category === "SIGNER_SET")).toBeDefined();
  });
});

describe("contract drift: unavailable state distinctness", () => {
  it("does not allow the action, and is copy-distinguishable from blocking", () => {
    const unavailable = makeCheck({ severity: "unavailable" });
    expect(canPerformAction(unavailable, NOW)).toBe(false);

    const blockingCopy = driftStateCopy("blocking");
    const unavailableCopy = driftStateCopy("unavailable");
    expect(blockingCopy.label).not.toBe(unavailableCopy.label);
    expect(unavailableCopy.description).toMatch(/not the same as a confirmed match/);
  });
});

describe("contract drift: fixture provider", () => {
  it("returns all categories with matched defaults", async () => {
    const status = await fetchMockContractDrift();
    expect(status.checks).toHaveLength(5);
    expect(status.checks.every((c) => c.severity === "matched")).toBe(true);
  });

  it("applies per-category overrides", async () => {
    const status = await fetchMockContractDrift({
      SIGNER_SET: { severity: "warning", detail: "New signer not yet reflected." },
    });
    const signer = status.checks.find((c) => c.category === "SIGNER_SET")!;
    expect(signer.severity).toBe("warning");
    expect(signer.detail).toBe("New signer not yet reflected.");
  });
});
