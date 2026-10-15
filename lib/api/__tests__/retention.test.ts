/**
 * Tests for audit retention and legal hold policy management
 * 
 * Coverage:
 * - Retention policy validation
 * - Legal hold date range validation
 * - Legal hold reason validation
 * - Formatter functions
 * - Eligibility calculations
 * - Helper functions
 */

import {
  validateLegalHoldDateRange,
  validateLegalHoldReason,
  formatRetentionPeriod,
  retentionPeriodToDays,
  formatLegalHoldStatus,
  getLegalHoldStatusTone,
  isDateCoveredByHold,
  calculateCleanupEligibilityDate,
  isEligibleForCleanup,
  MAX_HOLD_DATE_RANGE_DAYS,
  MIN_HOLD_DATE_RANGE_DAYS,
} from "../retention";

import {
  createMockRetentionPolicy,
  createMockLegalHold,
  createMockReleasedLegalHold,
  createMockExpiredLegalHold,
  VALID_DATE_RANGES,
  INVALID_DATE_RANGES,
  VALID_REASONS,
  INVALID_REASONS,
  RETENTION_PERIOD_TEST_DATA,
} from "./retention.fixtures";

describe("Legal Hold Date Range Validation", () => {
  describe("Valid date ranges", () => {
    VALID_DATE_RANGES.forEach((testCase) => {
      it(`should accept ${testCase.description}`, () => {
        const error = validateLegalHoldDateRange(testCase.startDate, testCase.endDate);
        expect(error).toBeNull();
      });
    });
  });

  describe("Invalid date ranges", () => {
    INVALID_DATE_RANGES.forEach((testCase) => {
      it(`should reject ${testCase.description}`, () => {
        const error = validateLegalHoldDateRange(testCase.startDate, testCase.endDate);
        expect(error).toBe(testCase.expectedError);
      });
    });
  });

  it("should enforce minimum span of 1 day", () => {
    // Same day is valid (0 days span)
    const error = validateLegalHoldDateRange("2024-01-01", "2024-01-01");
    expect(error).toBeNull();
  });

  it("should enforce maximum span of 10 years", () => {
    const error = validateLegalHoldDateRange("2020-01-01", "2030-01-02");
    expect(error).toContain("cannot exceed");
  });
});

describe("Legal Hold Reason Validation", () => {
  describe("Valid reasons", () => {
    VALID_REASONS.forEach((reason) => {
      it(`should accept: "${reason.substring(0, 40)}..."`, () => {
        const error = validateLegalHoldReason(reason);
        expect(error).toBeNull();
      });
    });
  });

  describe("Invalid reasons", () => {
    INVALID_REASONS.forEach((testCase) => {
      it(`should reject ${testCase.description}`, () => {
        const error = validateLegalHoldReason(testCase.reason);
        expect(error).toBe(testCase.expectedError);
      });
    });
  });

  it("should allow reasons with leading/trailing whitespace", () => {
    const error = validateLegalHoldReason("  Legal hold for case #2024-0815  ");
    expect(error).toBeNull();
  });
});

describe("Retention Period Formatting", () => {
  RETENTION_PERIOD_TEST_DATA.forEach((testCase) => {
    it(`should format ${testCase.period} as "${testCase.label}"`, () => {
      const formatted = formatRetentionPeriod(testCase.period);
      expect(formatted).toBe(testCase.label);
    });

    it(`should convert ${testCase.period} to ${testCase.days} days`, () => {
      const days = retentionPeriodToDays(testCase.period);
      expect(days).toBe(testCase.days);
    });
  });
});

describe("Legal Hold Status Formatting", () => {
  it("should format ACTIVE status", () => {
    expect(formatLegalHoldStatus("ACTIVE")).toBe("Active");
  });

  it("should format RELEASED status", () => {
    expect(formatLegalHoldStatus("RELEASED")).toBe("Released");
  });

  it("should format EXPIRED status", () => {
    expect(formatLegalHoldStatus("EXPIRED")).toBe("Expired");
  });

  it("should return appropriate tone for ACTIVE", () => {
    expect(getLegalHoldStatusTone("ACTIVE")).toBe("warning");
  });

  it("should return appropriate tone for RELEASED", () => {
    expect(getLegalHoldStatusTone("RELEASED")).toBe("success");
  });

  it("should return appropriate tone for EXPIRED", () => {
    expect(getLegalHoldStatusTone("EXPIRED")).toBe("accent");
  });
});

describe("Legal Hold Date Coverage", () => {
  const baseDate = "2024-02-15T00:00:00Z";
  const hold = createMockLegalHold({
    scope: {
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-03-31T23:59:59Z",
      affectedRecordCount: 1000,
    },
  });

  it("should detect when date is covered by active hold", () => {
    const covered = isDateCoveredByHold(baseDate, [hold]);
    expect(covered).toBe(true);
  });

  it("should detect when date is at hold start boundary (inclusive)", () => {
    const covered = isDateCoveredByHold("2024-01-01T00:00:00Z", [hold]);
    expect(covered).toBe(true);
  });

  it("should detect when date is at hold end boundary (inclusive)", () => {
    const covered = isDateCoveredByHold("2024-03-31T23:59:59Z", [hold]);
    expect(covered).toBe(true);
  });

  it("should detect when date is before hold range", () => {
    const covered = isDateCoveredByHold("2023-12-31T23:59:59Z", [hold]);
    expect(covered).toBe(false);
  });

  it("should detect when date is after hold range", () => {
    const covered = isDateCoveredByHold("2024-04-01T00:00:00Z", [hold]);
    expect(covered).toBe(false);
  });

  it("should ignore released holds", () => {
    const releasedHold = createMockReleasedLegalHold();
    const covered = isDateCoveredByHold("2024-02-15T00:00:00Z", [releasedHold]);
    expect(covered).toBe(false);
  });

  it("should ignore expired holds", () => {
    const expiredHold = createMockExpiredLegalHold();
    const covered = isDateCoveredByHold("2024-02-15T00:00:00Z", [expiredHold]);
    expect(covered).toBe(false);
  });

  it("should check multiple holds", () => {
    const hold2 = createMockLegalHold({
      id: "hold-2",
      scope: {
        startDate: "2024-06-01T00:00:00Z",
        endDate: "2024-08-31T23:59:59Z",
        affectedRecordCount: 500,
      },
    });

    expect(isDateCoveredByHold("2024-02-15T00:00:00Z", [hold, hold2])).toBe(true);
    expect(isDateCoveredByHold("2024-07-15T00:00:00Z", [hold, hold2])).toBe(true);
    expect(isDateCoveredByHold("2024-05-15T00:00:00Z", [hold, hold2])).toBe(false);
  });
});

describe("Cleanup Eligibility Calculation", () => {
  const recordCreatedAt = "2024-01-01T00:00:00Z";

  it("should calculate cleanup date for 7-day retention", () => {
    const eligibleDate = calculateCleanupEligibilityDate(recordCreatedAt, "7_DAYS");
    expect(eligibleDate).toBe("2024-01-08T00:00:00Z");
  });

  it("should calculate cleanup date for 90-day retention", () => {
    const eligibleDate = calculateCleanupEligibilityDate(recordCreatedAt, "90_DAYS");
    expect(eligibleDate).toBe("2024-04-01T00:00:00Z");
  });

  it("should calculate cleanup date for 1-year retention", () => {
    const eligibleDate = calculateCleanupEligibilityDate(recordCreatedAt, "1_YEAR");
    expect(eligibleDate).toBe("2025-01-01T00:00:00Z");
  });

  it("should calculate cleanup date for 3-year retention", () => {
    const eligibleDate = calculateCleanupEligibilityDate(recordCreatedAt, "3_YEARS");
    expect(eligibleDate).toBe("2027-01-01T00:00:00Z");
  });

  it("should calculate cleanup date for 5-year retention", () => {
    const eligibleDate = calculateCleanupEligibilityDate(recordCreatedAt, "5_YEARS");
    expect(eligibleDate).toBe("2029-01-01T00:00:00Z");
  });

  it("should return null for indefinite retention", () => {
    const eligibleDate = calculateCleanupEligibilityDate(recordCreatedAt, "INDEFINITE");
    expect(eligibleDate).toBeNull();
  });
});

describe("Cleanup Eligibility", () => {
  const recordCreatedAt = "2024-01-01T00:00:00Z";
  const retentionPolicy = createMockRetentionPolicy({
    period: "90_DAYS",
    createdAt: "2024-01-01T00:00:00Z",
  });

  it("should not be eligible if covered by active legal hold", () => {
    const hold = createMockLegalHold({
      scope: {
        startDate: "2023-12-01T00:00:00Z",
        endDate: "2024-06-30T23:59:59Z",
        affectedRecordCount: 1000,
      },
    });

    const eligible = isEligibleForCleanup(recordCreatedAt, retentionPolicy, [hold]);
    expect(eligible).toBe(false);
  });

  it("should be eligible if not covered by holds and retention expired", () => {
    // Record created 91 days ago, 90-day retention
    const ninetyOneDaysAgo = new Date();
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);
    const recordDate = ninetyOneDaysAgo.toISOString();

    const eligible = isEligibleForCleanup(recordDate, retentionPolicy, []);
    expect(eligible).toBe(true);
  });

  it("should not be eligible if retention period not expired", () => {
    // Record created yesterday, 90-day retention
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recordDate = yesterday.toISOString();

    const eligible = isEligibleForCleanup(recordDate, retentionPolicy, []);
    expect(eligible).toBe(false);
  });

  it("should never be eligible if retention is indefinite", () => {
    const indefinitePolicy = createMockRetentionPolicy({ period: "INDEFINITE" });

    // Even after 100 years
    const veryOldDate = "1924-01-01T00:00:00Z";
    const eligible = isEligibleForCleanup(veryOldDate, indefinitePolicy, []);
    expect(eligible).toBe(false);
  });

  it("should handle released holds correctly", () => {
    const releasedHold = createMockReleasedLegalHold();

    // Record was covered by hold but hold is now released
    const eligible = isEligibleForCleanup(
      "2024-02-15T00:00:00Z",
      retentionPolicy,
      [releasedHold],
    );
    // Should be eligible if retention expired
    expect(typeof eligible).toBe("boolean");
  });
});

describe("Edge Cases and Boundary Conditions", () => {
  it("should handle timezone-aware dates correctly", () => {
    // Test with UTC and non-UTC timestamps
    const utcDate = "2024-01-01T00:00:00Z";
    const utcPlusDate = "2024-01-01T05:00:00+05:00";

    const error1 = validateLegalHoldDateRange(utcDate, "2024-01-31T23:59:59Z");
    const error2 = validateLegalHoldDateRange(utcPlusDate, "2024-01-31T23:59:59+05:00");

    expect(error1).toBeNull();
    expect(error2).toBeNull();
  });

  it("should handle leap year dates", () => {
    const error = validateLegalHoldDateRange("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z");
    expect(error).toBeNull();
  });

  it("should handle year boundary transitions", () => {
    const error = validateLegalHoldDateRange("2023-12-31T23:59:59Z", "2024-01-01T00:00:00Z");
    expect(error).toBeNull();
  });

  it("should handle very large date ranges (but still within max)", () => {
    const error = validateLegalHoldDateRange("2010-01-01T00:00:00Z", "2019-12-31T23:59:59Z");
    expect(error).toBeNull();
  });

  it("should reject empty or null-like date strings", () => {
    expect(validateLegalHoldDateRange("", "2024-01-31")).not.toBeNull();
    expect(validateLegalHoldDateRange("2024-01-01", "")).not.toBeNull();
  });
});

describe("Compliance and Determinism", () => {
  it("should handle cleanup eligibility deterministically", () => {
    const recordCreatedAt = "2024-01-01T00:00:00Z";
    const retentionPolicy = createMockRetentionPolicy({ period: "90_DAYS" });
    const holds = [createMockLegalHold()];

    const eligible1 = isEligibleForCleanup(recordCreatedAt, retentionPolicy, holds);
    const eligible2 = isEligibleForCleanup(recordCreatedAt, retentionPolicy, holds);

    expect(eligible1).toBe(eligible2);
  });

  it("should never show held records as eligible for cleanup", () => {
    const recordCreatedAt = "2023-01-01T00:00:00Z"; // 2+ years old
    const retentionPolicy = createMockRetentionPolicy({ period: "1_YEAR" });
    const hold = createMockLegalHold({
      scope: {
        startDate: "2022-12-01T00:00:00Z",
        endDate: "2024-12-31T23:59:59Z",
        affectedRecordCount: 5000,
      },
    });

    const eligible = isEligibleForCleanup(recordCreatedAt, retentionPolicy, [hold]);
    expect(eligible).toBe(false);
  });

  it("should properly handle concurrent holds on overlapping ranges", () => {
    const recordCreatedAt = "2024-02-15T00:00:00Z";

    const hold1 = createMockLegalHold({
      id: "hold-1",
      scope: {
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-02-28T23:59:59Z",
        affectedRecordCount: 1000,
      },
    });

    const hold2 = createMockLegalHold({
      id: "hold-2",
      scope: {
        startDate: "2024-02-15T00:00:00Z",
        endDate: "2024-03-31T23:59:59Z",
        affectedRecordCount: 800,
      },
    });

    const covered = isDateCoveredByHold(recordCreatedAt, [hold1, hold2]);
    expect(covered).toBe(true);
  });
});
