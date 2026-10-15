/**
 * Tests for security posture API module
 * Covers: types, validation, helper functions, tenant isolation, edge cases
 */

import {
  validateSecurityPosture,
  isValidSeverity,
  isValidCheckStatus,
  isValidRiskCategory,
  getMostCriticalSeverity,
  filterChecksByStatus,
  filterChecksByCategory,
  filterChecksBySeverity,
  getUnacknowledgedFailures,
  getAcknowledgedChecks,
  getChecksNeedingAttention,
  hasCriticalIssues,
  isPostureStale,
  getPostureSummary,
  getEvaluationAgeMs,
  formatEvaluationAge,
  groupChecksByCategory,
  formatSeverity,
  formatCheckStatus,
  formatRiskCategory,
  getSeverityColor,
  getStatusColor,
  type SecurityPosture,
  type SecurityCheck,
} from "../security-posture";
import {
  SECURITY_POSTURE_HEALTHY,
  SECURITY_POSTURE_WITH_FAILURES,
  SECURITY_POSTURE_STALE,
  SECURITY_POSTURE_ALL_PASSED,
  SECURITY_POSTURE_ALL_CRITICAL,
  SECURITY_POSTURE_MOSTLY_UNKNOWN,
  PASSED_CHECK_KEY_ROTATION,
  FAILED_CHECK_EXPIRED_KEYS,
  ACKNOWLEDGED_CHECK_WEBHOOK,
  SECURITY_POSTURE_TENANT_A,
  SECURITY_POSTURE_TENANT_B,
} from "../../../../tests/fixtures/security-posture-fixtures";

describe("Security Posture API - Type Validation", () => {
  describe("isValidSeverity", () => {
    it("accepts valid severity levels", () => {
      expect(isValidSeverity("CRITICAL")).toBe(true);
      expect(isValidSeverity("HIGH")).toBe(true);
      expect(isValidSeverity("MEDIUM")).toBe(true);
      expect(isValidSeverity("LOW")).toBe(true);
      expect(isValidSeverity("INFO")).toBe(true);
    });

    it("rejects invalid severity levels", () => {
      expect(isValidSeverity("EXTREME")).toBe(false);
      expect(isValidSeverity("")).toBe(false);
      expect(isValidSeverity(null)).toBe(false);
      expect(isValidSeverity(undefined)).toBe(false);
      expect(isValidSeverity(123)).toBe(false);
    });
  });

  describe("isValidCheckStatus", () => {
    it("accepts valid check statuses", () => {
      expect(isValidCheckStatus("PASS")).toBe(true);
      expect(isValidCheckStatus("FAIL")).toBe(true);
      expect(isValidCheckStatus("UNKNOWN")).toBe(true);
      expect(isValidCheckStatus("ACKNOWLEDGED")).toBe(true);
    });

    it("rejects invalid check statuses", () => {
      expect(isValidCheckStatus("SUCCESS")).toBe(false);
      expect(isValidCheckStatus("ERROR")).toBe(false);
      expect(isValidCheckStatus("")).toBe(false);
      expect(isValidCheckStatus(null)).toBe(false);
    });
  });

  describe("isValidRiskCategory", () => {
    it("accepts valid risk categories", () => {
      expect(isValidRiskCategory("KEY_ROTATION")).toBe(true);
      expect(isValidRiskCategory("SESSION_MANAGEMENT")).toBe(true);
      expect(isValidRiskCategory("WEBHOOK_SECURITY")).toBe(true);
      expect(isValidRiskCategory("ROLE_BASED_ACCESS")).toBe(true);
      expect(isValidRiskCategory("CONTRACT_VERIFICATION")).toBe(true);
      expect(isValidRiskCategory("RECOVERY_OPTIONS")).toBe(true);
      expect(isValidRiskCategory("API_SECURITY")).toBe(true);
      expect(isValidRiskCategory("DATA_ACCESS")).toBe(true);
    });

    it("rejects invalid risk categories", () => {
      expect(isValidRiskCategory("INVALID")).toBe(false);
      expect(isValidRiskCategory("")).toBe(false);
      expect(isValidRiskCategory(null)).toBe(false);
    });
  });
});

describe("Security Posture API - Validation", () => {
  describe("validateSecurityPosture", () => {
    it("accepts valid security posture", () => {
      const error = validateSecurityPosture(SECURITY_POSTURE_HEALTHY);
      expect(error).toBeNull();
    });

    it("rejects non-object input", () => {
      expect(validateSecurityPosture(null)).not.toBeNull();
      expect(validateSecurityPosture(undefined)).not.toBeNull();
      expect(validateSecurityPosture("string")).not.toBeNull();
      expect(validateSecurityPosture(123)).not.toBeNull();
    });

    it("validates required fields", () => {
      const incomplete = { score: 50 };
      expect(validateSecurityPosture(incomplete)).not.toBeNull();
    });

    it("validates score range", () => {
      const invalid = { ...SECURITY_POSTURE_HEALTHY, score: 150 };
      expect(validateSecurityPosture(invalid)).not.toBeNull();

      const negative = { ...SECURITY_POSTURE_HEALTHY, score: -10 };
      expect(validateSecurityPosture(negative)).not.toBeNull();
    });

    it("validates severity counts are numbers", () => {
      const invalid = {
        ...SECURITY_POSTURE_HEALTHY,
        severityCounts: { CRITICAL: "zero", HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      };
      expect(validateSecurityPosture(invalid)).not.toBeNull();
    });

    it("validates check status values", () => {
      const invalid = {
        ...SECURITY_POSTURE_HEALTHY,
        checks: [{ ...PASSED_CHECK_KEY_ROTATION, status: "INVALID" }],
      };
      expect(validateSecurityPosture(invalid)).not.toBeNull();
    });

    it("validates tenant isolation - tenantId required", () => {
      const invalid = {
        ...SECURITY_POSTURE_HEALTHY,
        tenantId: undefined,
      };
      expect(validateSecurityPosture(invalid)).not.toBeNull();
    });
  });
});

describe("Security Posture API - Filtering", () => {
  describe("filterChecksByStatus", () => {
    it("filters checks by status", () => {
      const failed = filterChecksByStatus(SECURITY_POSTURE_WITH_FAILURES.checks, "FAIL");
      expect(failed.length).toBeGreaterThan(0);
      expect(failed.every((c) => c.status === "FAIL")).toBe(true);
    });

    it("returns empty array when no matches", () => {
      const acknowledged = filterChecksByStatus(SECURITY_POSTURE_HEALTHY.checks, "ACKNOWLEDGED");
      expect(acknowledged).toEqual([]);
    });

    it("handles all status types", () => {
      const allChecks = [...SECURITY_POSTURE_WITH_FAILURES.checks];
      const pass = filterChecksByStatus(allChecks, "PASS");
      const fail = filterChecksByStatus(allChecks, "FAIL");
      const unknown = filterChecksByStatus(allChecks, "UNKNOWN");
      const acknowledged = filterChecksByStatus(allChecks, "ACKNOWLEDGED");

      expect(pass.length + fail.length + unknown.length + acknowledged.length).toBe(allChecks.length);
    });
  });

  describe("filterChecksByCategory", () => {
    it("filters checks by category", () => {
      const keyRotation = filterChecksByCategory(
        SECURITY_POSTURE_WITH_FAILURES.checks,
        "KEY_ROTATION"
      );
      expect(keyRotation.every((c) => c.category === "KEY_ROTATION")).toBe(true);
    });

    it("returns empty array for categories with no checks", () => {
      const result = filterChecksByCategory(SECURITY_POSTURE_HEALTHY.checks, "WEBHOOK_SECURITY");
      expect(result).toEqual([]);
    });
  });

  describe("filterChecksBySeverity", () => {
    it("filters checks by severity", () => {
      const critical = filterChecksBySeverity(
        SECURITY_POSTURE_WITH_FAILURES.checks,
        "CRITICAL"
      );
      expect(critical.every((c) => c.severity === "CRITICAL")).toBe(true);
    });
  });

  describe("getUnacknowledgedFailures", () => {
    it("returns only failed unacknowledged checks", () => {
      const failures = getUnacknowledgedFailures(SECURITY_POSTURE_WITH_FAILURES);
      expect(failures.every((c) => c.status === "FAIL" && !c.acknowledgement)).toBe(true);
    });

    it("excludes acknowledged checks", () => {
      const failures = getUnacknowledgedFailures(SECURITY_POSTURE_WITH_FAILURES);
      expect(failures.find((c) => c.id === ACKNOWLEDGED_CHECK_WEBHOOK.id)).toBeUndefined();
    });
  });

  describe("getAcknowledgedChecks", () => {
    it("returns only acknowledged checks", () => {
      const acknowledged = getAcknowledgedChecks(SECURITY_POSTURE_WITH_FAILURES);
      expect(acknowledged.every((c) => c.acknowledgement !== undefined)).toBe(true);
    });
  });

  describe("getChecksNeedingAttention", () => {
    it("returns failed and unknown checks", () => {
      const needAttention = getChecksNeedingAttention(SECURITY_POSTURE_WITH_FAILURES);
      expect(
        needAttention.every((c) => c.status === "FAIL" || c.status === "UNKNOWN")
      ).toBe(true);
    });

    it("excludes passed and acknowledged checks", () => {
      const needAttention = getChecksNeedingAttention(SECURITY_POSTURE_HEALTHY);
      expect(needAttention.length).toBe(0);
    });
  });
});

describe("Security Posture API - Analysis", () => {
  describe("getMostCriticalSeverity", () => {
    it("returns CRITICAL when critical issues exist", () => {
      expect(getMostCriticalSeverity(SECURITY_POSTURE_WITH_FAILURES)).toBe("CRITICAL");
    });

    it("returns HIGH when only high severity exists", () => {
      const posture = { ...SECURITY_POSTURE_HEALTHY, severityCounts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 } };
      expect(getMostCriticalSeverity(posture)).toBe("HIGH");
    });

    it("returns INFO when no issues", () => {
      expect(getMostCriticalSeverity(SECURITY_POSTURE_HEALTHY)).toBe("INFO");
    });
  });

  describe("hasCriticalIssues", () => {
    it("returns true when critical issues exist", () => {
      expect(hasCriticalIssues(SECURITY_POSTURE_WITH_FAILURES)).toBe(true);
    });

    it("returns false when no critical issues", () => {
      expect(hasCriticalIssues(SECURITY_POSTURE_HEALTHY)).toBe(false);
    });
  });

  describe("isPostureStale", () => {
    it("returns true for stale data", () => {
      expect(isPostureStale(SECURITY_POSTURE_STALE)).toBe(true);
    });

    it("returns false for fresh data", () => {
      expect(isPostureStale(SECURITY_POSTURE_HEALTHY)).toBe(false);
    });

    it("respects custom max age threshold", () => {
      const veryStale = isPostureStale(SECURITY_POSTURE_STALE, 1000); // 1 second max age
      expect(veryStale).toBe(true);
    });
  });

  describe("getPostureSummary", () => {
    it("returns 'All checks passed' when no issues", () => {
      const summary = getPostureSummary(SECURITY_POSTURE_HEALTHY);
      expect(summary).toBe("All checks passed");
    });

    it("summarizes issues with proper counts", () => {
      const summary = getPostureSummary(SECURITY_POSTURE_WITH_FAILURES);
      expect(summary).toContain("critical");
      expect(summary).toContain("high");
    });

    it("only includes severities with non-zero counts", () => {
      const summary = getPostureSummary(SECURITY_POSTURE_ALL_PASSED);
      expect(summary).toBe("All checks passed");
    });
  });

  describe("formatEvaluationAge", () => {
    it("formats recent evaluations", () => {
      const age = formatEvaluationAge(SECURITY_POSTURE_HEALTHY);
      expect(age).toMatch(/\d+[mh] ago/);
    });

    it("handles stale evaluations", () => {
      const age = formatEvaluationAge(SECURITY_POSTURE_STALE);
      expect(age).toMatch(/\d+d ago/);
    });
  });

  describe("groupChecksByCategory", () => {
    it("groups checks by category", () => {
      const grouped = groupChecksByCategory(SECURITY_POSTURE_WITH_FAILURES.checks);
      expect(Object.keys(grouped).length).toBe(8); // All categories present

      Object.entries(grouped).forEach(([category, checks]) => {
        expect(checks.every((c) => c.category === category)).toBe(true);
      });
    });

    it("includes empty categories", () => {
      const grouped = groupChecksByCategory([PASSED_CHECK_KEY_ROTATION]);
      expect(grouped.KEY_ROTATION).toContain(PASSED_CHECK_KEY_ROTATION);
      expect(grouped.SESSION_MANAGEMENT).toEqual([]);
    });
  });
});

describe("Security Posture API - Formatting", () => {
  describe("formatSeverity", () => {
    it("formats all severity levels", () => {
      expect(formatSeverity("CRITICAL")).toBe("Critical");
      expect(formatSeverity("HIGH")).toBe("High");
      expect(formatSeverity("MEDIUM")).toBe("Medium");
      expect(formatSeverity("LOW")).toBe("Low");
      expect(formatSeverity("INFO")).toBe("Informational");
    });
  });

  describe("formatCheckStatus", () => {
    it("formats all check statuses", () => {
      expect(formatCheckStatus("PASS")).toBe("Passed");
      expect(formatCheckStatus("FAIL")).toBe("Failed");
      expect(formatCheckStatus("UNKNOWN")).toBe("Unknown");
      expect(formatCheckStatus("ACKNOWLEDGED")).toBe("Acknowledged");
    });
  });

  describe("formatRiskCategory", () => {
    it("formats all risk categories", () => {
      expect(formatRiskCategory("KEY_ROTATION")).toBe("Key Rotation");
      expect(formatRiskCategory("SESSION_MANAGEMENT")).toBe("Session Management");
      expect(formatRiskCategory("WEBHOOK_SECURITY")).toBe("Webhook Security");
      expect(formatRiskCategory("ROLE_BASED_ACCESS")).toBe("Role-Based Access");
      expect(formatRiskCategory("CONTRACT_VERIFICATION")).toBe("Contract Verification");
      expect(formatRiskCategory("RECOVERY_OPTIONS")).toBe("Recovery Options");
      expect(formatRiskCategory("API_SECURITY")).toBe("API Security");
      expect(formatRiskCategory("DATA_ACCESS")).toBe("Data Access");
    });
  });

  describe("getSeverityColor", () => {
    it("returns correct colors for severities", () => {
      expect(getSeverityColor("CRITICAL")).toBe("red");
      expect(getSeverityColor("HIGH")).toBe("orange");
      expect(getSeverityColor("MEDIUM")).toBe("yellow");
      expect(getSeverityColor("LOW")).toBe("blue");
      expect(getSeverityColor("INFO")).toBe("green");
    });
  });

  describe("getStatusColor", () => {
    it("returns correct colors for statuses", () => {
      expect(getStatusColor("PASS")).toBe("green");
      expect(getStatusColor("FAIL")).toBe("red");
      expect(getStatusColor("UNKNOWN")).toBe("gray");
      expect(getStatusColor("ACKNOWLEDGED")).toBe("blue");
    });
  });
});

describe("Security Posture API - Tenant Isolation", () => {
  it("maintains tenant separation in fixtures", () => {
    expect(SECURITY_POSTURE_TENANT_A.tenantId).toBe("tenant-a");
    expect(SECURITY_POSTURE_TENANT_B.tenantId).toBe("tenant-b");
    expect(SECURITY_POSTURE_TENANT_A.tenantId).not.toBe(SECURITY_POSTURE_TENANT_B.tenantId);
  });

  it("validates tenant isolation in posture data", () => {
    const postures = [SECURITY_POSTURE_TENANT_A, SECURITY_POSTURE_TENANT_B];
    postures.forEach((posture) => {
      expect(validateSecurityPosture(posture)).toBeNull();
    });
  });

  it("ensures organizations are scoped to tenants", () => {
    expect(SECURITY_POSTURE_TENANT_A.organizationId).not.toBe(SECURITY_POSTURE_TENANT_B.organizationId);
  });
});

describe("Security Posture API - Boundary Cases", () => {
  it("handles posture with no checks", () => {
    const empty: SecurityPosture = {
      organizationId: "org-empty",
      score: 100,
      evaluatedAt: "2024-10-15T12:00:00.000Z",
      checks: [],
      severityCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      isFresh: true,
      tenantId: "tenant-1",
    };
    expect(validateSecurityPosture(empty)).toBeNull();
    expect(getPostureSummary(empty)).toBe("All checks passed");
  });

  it("handles posture with many checks", () => {
    const manyChecks: SecurityPosture = {
      ...SECURITY_POSTURE_HEALTHY,
      checks: Array(100).fill(PASSED_CHECK_KEY_ROTATION),
    };
    const grouped = groupChecksByCategory(manyChecks.checks);
    expect(grouped.KEY_ROTATION.length).toBe(100);
  });

  it("handles very old evaluation timestamps", () => {
    const ancient: SecurityPosture = {
      ...SECURITY_POSTURE_HEALTHY,
      evaluatedAt: "2020-01-01T00:00:00.000Z",
    };
    expect(isPostureStale(ancient)).toBe(true);
  });

  it("handles score edge values", () => {
    const minScore = { ...SECURITY_POSTURE_HEALTHY, score: 0 };
    const maxScore = { ...SECURITY_POSTURE_HEALTHY, score: 100 };
    expect(validateSecurityPosture(minScore)).toBeNull();
    expect(validateSecurityPosture(maxScore)).toBeNull();
  });
});

describe("Security Posture API - Regression", () => {
  it("preserves all check properties through filtering", () => {
    const filtered = filterChecksByStatus(SECURITY_POSTURE_WITH_FAILURES.checks, "FAIL");
    filtered.forEach((check) => {
      expect(check.id).toBeDefined();
      expect(check.name).toBeDefined();
      expect(check.category).toBeDefined();
      expect(check.status).toBe("FAIL");
    });
  });

  it("maintains score accuracy across operations", () => {
    const posture = SECURITY_POSTURE_WITH_FAILURES;
    expect(posture.score).toBeGreaterThanOrEqual(0);
    expect(posture.score).toBeLessThanOrEqual(100);
  });

  it("ensures severity counts match actual checks", () => {
    const posture = SECURITY_POSTURE_WITH_FAILURES;
    const actual = {
      CRITICAL: posture.checks.filter((c) => c.severity === "CRITICAL").length,
      HIGH: posture.checks.filter((c) => c.severity === "HIGH").length,
      MEDIUM: posture.checks.filter((c) => c.severity === "MEDIUM").length,
      LOW: posture.checks.filter((c) => c.severity === "LOW").length,
      INFO: posture.checks.filter((c) => c.severity === "INFO").length,
    };
    expect(posture.severityCounts).toEqual(actual);
  });
});
