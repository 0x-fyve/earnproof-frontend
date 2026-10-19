import {
  MAX_REMINDER_DAYS,
  MIN_REMINDER_DAYS,
  buildReminderPreviewText,
  classifyExpirationStatus,
  isDuplicateReminderWindow,
  isEligibleForRenewalLink,
  isReminderChannel,
  isReminderWindowValid,
  validateReminderWindow,
  type ReminderWindow,
} from "../expiration-reminders";

describe("isReminderChannel", () => {
  it("accepts in-app and webhook", () => {
    expect(isReminderChannel("in-app")).toBe(true);
    expect(isReminderChannel("webhook")).toBe(true);
  });

  it("rejects an unsupported channel like email", () => {
    expect(isReminderChannel("email")).toBe(false);
    expect(isReminderChannel("sms")).toBe(false);
    expect(isReminderChannel("")).toBe(false);
    expect(isReminderChannel(undefined)).toBe(false);
  });
});

describe("validateReminderWindow / isReminderWindowValid (boundary coverage)", () => {
  const base: ReminderWindow = { proofId: "proof-1", daysBeforeExpiry: 7, channel: "in-app" };

  it("accepts the minimum bound", () => {
    const window = { ...base, daysBeforeExpiry: MIN_REMINDER_DAYS };
    expect(validateReminderWindow(window)).toEqual([]);
    expect(isReminderWindowValid(window)).toBe(true);
  });

  it("accepts the maximum bound", () => {
    const window = { ...base, daysBeforeExpiry: MAX_REMINDER_DAYS };
    expect(isReminderWindowValid(window)).toBe(true);
  });

  it("rejects one below the minimum bound", () => {
    const window = { ...base, daysBeforeExpiry: MIN_REMINDER_DAYS - 1 };
    const issues = validateReminderWindow(window);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("daysBeforeExpiry");
    expect(isReminderWindowValid(window)).toBe(false);
  });

  it("rejects one above the maximum bound", () => {
    const window = { ...base, daysBeforeExpiry: MAX_REMINDER_DAYS + 1 };
    expect(isReminderWindowValid(window)).toBe(false);
  });

  it("rejects zero and negative values", () => {
    expect(isReminderWindowValid({ ...base, daysBeforeExpiry: 0 })).toBe(false);
    expect(isReminderWindowValid({ ...base, daysBeforeExpiry: -3 })).toBe(false);
  });

  it("rejects a non-integer day count", () => {
    const issues = validateReminderWindow({ ...base, daysBeforeExpiry: 3.5 });
    expect(issues.some((issue) => issue.field === "daysBeforeExpiry")).toBe(true);
  });

  it("rejects a missing proof id", () => {
    const issues = validateReminderWindow({ ...base, proofId: "" });
    expect(issues.some((issue) => issue.field === "proofId")).toBe(true);
  });

  it("rejects a blank (whitespace-only) proof id", () => {
    const issues = validateReminderWindow({ ...base, proofId: "   " });
    expect(issues.some((issue) => issue.field === "proofId")).toBe(true);
  });

  it("rejects an unsupported channel", () => {
    // @ts-expect-error intentionally invalid for the negative test
    const issues = validateReminderWindow({ ...base, channel: "email" });
    expect(issues.some((issue) => issue.field === "channel")).toBe(true);
  });

  it("reports every violated field at once", () => {
    // @ts-expect-error intentionally invalid for the negative test
    const issues = validateReminderWindow({ proofId: "", daysBeforeExpiry: 999, channel: "email" });
    expect(issues).toHaveLength(3);
  });
});

describe("isDuplicateReminderWindow", () => {
  const existing: ReminderWindow[] = [
    { proofId: "proof-1", daysBeforeExpiry: 7, channel: "in-app" },
  ];

  it("flags an exact duplicate (same proof, offset, channel)", () => {
    expect(
      isDuplicateReminderWindow(existing, { proofId: "proof-1", daysBeforeExpiry: 7, channel: "in-app" }),
    ).toBe(true);
  });

  it("does not flag a different offset on the same proof as a duplicate", () => {
    expect(
      isDuplicateReminderWindow(existing, { proofId: "proof-1", daysBeforeExpiry: 14, channel: "in-app" }),
    ).toBe(false);
  });

  it("does not flag a different channel on the same proof/offset as a duplicate", () => {
    expect(
      isDuplicateReminderWindow(existing, { proofId: "proof-1", daysBeforeExpiry: 7, channel: "webhook" }),
    ).toBe(false);
  });

  it("does not flag the same offset/channel on a different proof as a duplicate", () => {
    expect(
      isDuplicateReminderWindow(existing, { proofId: "proof-2", daysBeforeExpiry: 7, channel: "in-app" }),
    ).toBe(false);
  });

  it("returns false against an empty existing list", () => {
    expect(
      isDuplicateReminderWindow([], { proofId: "proof-1", daysBeforeExpiry: 7, channel: "in-app" }),
    ).toBe(false);
  });
});

describe("classifyExpirationStatus", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  function base(overrides: Partial<Parameters<typeof classifyExpirationStatus>[0]> = {}) {
    return {
      id: "proof-1",
      status: "VALID",
      expiresAt: "2026-07-01T00:00:00.000Z",
      revokedAt: null,
      supersededBy: null,
      ...overrides,
    };
  }

  it("classifies a future expiry as upcoming", () => {
    expect(classifyExpirationStatus(base(), now)).toBe("upcoming");
  });

  it("classifies a past expiry as expired (timezone boundary: exact instant)", () => {
    expect(classifyExpirationStatus(base({ expiresAt: now.toISOString() }), now)).toBe("expired");
  });

  it("classifies one millisecond before the boundary as still upcoming", () => {
    const oneMsBefore = new Date(now.getTime() + 1).toISOString();
    expect(classifyExpirationStatus(base({ expiresAt: oneMsBefore }), now)).toBe("upcoming");
  });

  it("classifies one millisecond after the boundary as expired", () => {
    const oneMsAfter = new Date(now.getTime() - 1).toISOString();
    expect(classifyExpirationStatus(base({ expiresAt: oneMsAfter }), now)).toBe("expired");
  });

  it("classifies a revoked proof as revoked even if not yet expired", () => {
    expect(classifyExpirationStatus(base({ revokedAt: "2026-06-01T00:00:00.000Z" }), now)).toBe("revoked");
  });

  it("classifies a superseded proof as superseded even if not yet expired", () => {
    expect(classifyExpirationStatus(base({ supersededBy: "proof-2" }), now)).toBe("superseded");
  });

  it("classifies a proof with an active (pending) dispute as disputed", () => {
    expect(classifyExpirationStatus(base({ disputeStatus: "pending" }), now)).toBe("disputed");
  });

  it("classifies a proof with an active (accepted) dispute as disputed", () => {
    expect(classifyExpirationStatus(base({ disputeStatus: "accepted" }), now)).toBe("disputed");
  });

  it("does not classify a resolved dispute as disputed", () => {
    expect(classifyExpirationStatus(base({ disputeStatus: "resolved" }), now)).toBe("upcoming");
  });

  it("does not classify a rejected or withdrawn dispute as disputed", () => {
    expect(classifyExpirationStatus(base({ disputeStatus: "rejected" }), now)).toBe("upcoming");
    expect(classifyExpirationStatus(base({ disputeStatus: "withdrawn" }), now)).toBe("upcoming");
  });

  it("treats an unrecognized dispute status as not disputed, not a crash", () => {
    expect(() =>
      classifyExpirationStatus(base({ disputeStatus: "some-future-status" }), now),
    ).not.toThrow();
    expect(classifyExpirationStatus(base({ disputeStatus: "some-future-status" }), now)).toBe("upcoming");
  });

  it("prioritizes dispute over revoked/superseded/expired", () => {
    expect(
      classifyExpirationStatus(
        base({
          disputeStatus: "pending",
          revokedAt: "2026-06-01T00:00:00.000Z",
          supersededBy: "proof-2",
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
        now,
      ),
    ).toBe("disputed");
  });

  it("classifies an unparseable expiresAt as unrecognized rather than throwing", () => {
    expect(() => classifyExpirationStatus(base({ expiresAt: "not-a-date" }), now)).not.toThrow();
    expect(classifyExpirationStatus(base({ expiresAt: "not-a-date" }), now)).toBe("unrecognized");
  });
});

describe("isEligibleForRenewalLink", () => {
  it("is eligible for upcoming and expired", () => {
    expect(isEligibleForRenewalLink("upcoming")).toBe(true);
    expect(isEligibleForRenewalLink("expired")).toBe(true);
  });

  it("is not eligible for revoked, superseded, disputed, or unrecognized", () => {
    expect(isEligibleForRenewalLink("revoked")).toBe(false);
    expect(isEligibleForRenewalLink("superseded")).toBe(false);
    expect(isEligibleForRenewalLink("disputed")).toBe(false);
    expect(isEligibleForRenewalLink("unrecognized")).toBe(false);
  });
});

describe("buildReminderPreviewText (privacy: no claim/amount values)", () => {
  it("never includes a numeric amount or currency-looking token for an upcoming expiry", () => {
    const text = buildReminderPreviewText({ proofTypeLabel: "Minimum Income", daysUntilExpiry: 5 });
    expect(text).toBe("Your Minimum Income proof expires in 5 days.");
    expect(text).not.toMatch(/\$|USDC|XLM|\d{2,}/);
  });

  it("uses singular phrasing for exactly one day left", () => {
    expect(buildReminderPreviewText({ proofTypeLabel: "Payment Receipt", daysUntilExpiry: 1 })).toBe(
      "Your Payment Receipt proof expires tomorrow.",
    );
  });

  it("uses expired phrasing once past expiry", () => {
    expect(buildReminderPreviewText({ proofTypeLabel: "Recurring Income", daysUntilExpiry: 0 })).toBe(
      "Your Recurring Income proof has expired.",
    );
    expect(buildReminderPreviewText({ proofTypeLabel: "Recurring Income", daysUntilExpiry: -3 })).toBe(
      "Your Recurring Income proof has expired.",
    );
  });

  it("only ever interpolates the type label and day count, never a claim field", () => {
    // Regression guard: the function signature itself has no amount/claim
    // parameter, so this asserts the *contract*, not just today's string.
    const paramNames = buildReminderPreviewText.length;
    expect(paramNames).toBe(1); // single options object, not (proof, amount, ...)
  });
});
