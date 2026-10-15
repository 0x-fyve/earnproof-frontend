import { apiClient, bearer, retryRead, retryMutation } from "./client";

/**
 * Severity levels for security findings.
 * CRITICAL: Immediate action required, security breach risk
 * HIGH: Significant risk, action needed soon
 * MEDIUM: Notable risk, should be addressed
 * LOW: Minor concern, best practice recommendation
 * INFO: Informational, no immediate action required
 */
export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

/**
 * Status of a security check.
 * PASS: No issues detected
 * FAIL: Issues detected requiring remediation
 * UNKNOWN: Check could not be evaluated
 * ACKNOWLEDGED: Finding acknowledged as acceptable risk
 */
export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN" | "ACKNOWLEDGED";

/**
 * Category of security risk.
 */
export type RiskCategory =
  | "KEY_ROTATION"
  | "SESSION_MANAGEMENT"
  | "WEBHOOK_SECURITY"
  | "ROLE_BASED_ACCESS"
  | "CONTRACT_VERIFICATION"
  | "RECOVERY_OPTIONS"
  | "API_SECURITY"
  | "DATA_ACCESS";

/**
 * Individual security check result.
 */
export type SecurityCheck = {
  /** Unique identifier for this check */
  id: string;
  /** Display name of the check */
  name: string;
  /** Detailed description of what this check validates */
  description: string;
  /** Category of risk this check addresses */
  category: RiskCategory;
  /** Current status of the check */
  status: CheckStatus;
  /** Severity level of any findings */
  severity: SeverityLevel;
  /** When this check was last evaluated (ISO timestamp) */
  evaluatedAt: string;
  /** Evidence supporting the check result */
  evidence?: {
    /** Specific findings or metrics */
    findings: string[];
    /** Total count of affected items (e.g., expired keys) */
    affectedCount?: number;
    /** Additional context data */
    context?: Record<string, unknown>;
  };
  /** Remediation guidance if check failed */
  remediation?: {
    /** Link to documentation or settings */
    remediationLink?: string;
    /** Plain language remediation steps */
    steps: string[];
  };
  /** Owner of this check (e.g., "api-security-team", "admin") */
  owner?: string;
  /** If acknowledged as exception, this contains the acknowledgment */
  acknowledgement?: {
    /** Timestamp of acknowledgment (ISO) */
    acknowledgedAt: string;
    /** Who acknowledged the exception */
    acknowledgedBy: string;
    /** Reason for accepting this risk */
    reason: string;
    /** When this acknowledgment expires (ISO), if applicable */
    expiresAt?: string;
  };
};

/**
 * Aggregated security posture for an organization.
 */
export type SecurityPosture = {
  /** Organization ID this posture belongs to */
  organizationId: string;
  /** Overall security score (0-100) */
  score: number;
  /** Trend in score since last evaluation */
  scoreTrend?: "IMPROVING" | "DECLINING" | "STABLE";
  /** When the posture was last evaluated (ISO timestamp) */
  evaluatedAt: string;
  /** All security checks performed */
  checks: SecurityCheck[];
  /** Count of issues by severity */
  severityCounts: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    INFO: number;
  };
  /** Whether all data is current (false if some checks are stale) */
  isFresh: boolean;
  /** If stale, how long ago the data was evaluated */
  stalenessDays?: number;
  /** Tenant scope verification - ensures data is not cross-pollinated */
  tenantId: string;
};

/**
 * Request to acknowledge a security finding as an acceptable risk.
 */
export type AcknowledgeCheckRequest = {
  checkId: string;
  reason: string;
  expiresAt?: string; // ISO timestamp for expiration of acknowledgment
};

/**
 * Response after acknowledging a check.
 */
export type AcknowledgeCheckResponse = {
  check: SecurityCheck;
  acknowledgedAt: string;
};

/**
 * Request to trigger a security check evaluation.
 */
export type EvaluateCheckRequest = {
  checkIds?: string[]; // If empty, evaluate all checks
};

/**
 * Response from triggering evaluation.
 */
export type EvaluateCheckResponse = {
  posture: SecurityPosture;
  checksEvaluated: number;
};

/**
 * Export format for security posture report.
 */
export type SecurityPostureExport = {
  organizationId: string;
  exportedAt: string;
  score: number;
  checks: Array<{
    id: string;
    name: string;
    category: RiskCategory;
    status: CheckStatus;
    severity: SeverityLevel;
    findings?: string[];
  }>;
};

/**
 * Validation helper for severity levels.
 */
export function isValidSeverity(value: unknown): value is SeverityLevel {
  return (
    value === "CRITICAL" ||
    value === "HIGH" ||
    value === "MEDIUM" ||
    value === "LOW" ||
    value === "INFO"
  );
}

/**
 * Validation helper for check statuses.
 */
export function isValidCheckStatus(value: unknown): value is CheckStatus {
  return (
    value === "PASS" ||
    value === "FAIL" ||
    value === "UNKNOWN" ||
    value === "ACKNOWLEDGED"
  );
}

/**
 * Validation helper for risk categories.
 */
export function isValidRiskCategory(value: unknown): value is RiskCategory {
  return (
    value === "KEY_ROTATION" ||
    value === "SESSION_MANAGEMENT" ||
    value === "WEBHOOK_SECURITY" ||
    value === "ROLE_BASED_ACCESS" ||
    value === "CONTRACT_VERIFICATION" ||
    value === "RECOVERY_OPTIONS" ||
    value === "API_SECURITY" ||
    value === "DATA_ACCESS"
  );
}

/**
 * Validates a SecurityPosture object structure and content.
 * Returns error message if invalid, null if valid.
 */
export function validateSecurityPosture(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return "Security posture must be an object";
  }

  const posture = data as Record<string, unknown>;

  // Required fields
  if (typeof posture.organizationId !== "string") {
    return "organizationId must be a string";
  }
  if (typeof posture.tenantId !== "string") {
    return "tenantId must be a string";
  }
  if (typeof posture.score !== "number" || posture.score < 0 || posture.score > 100) {
    return "score must be a number between 0 and 100";
  }
  if (typeof posture.evaluatedAt !== "string") {
    return "evaluatedAt must be a string (ISO timestamp)";
  }
  if (!Array.isArray(posture.checks)) {
    return "checks must be an array";
  }

  // Validate checks array
  for (let i = 0; i < posture.checks.length; i++) {
    const check = posture.checks[i];
    if (!check || typeof check !== "object") {
      return `check[${i}] must be an object`;
    }

    const checkObj = check as Record<string, unknown>;
    if (typeof checkObj.id !== "string") {
      return `check[${i}].id must be a string`;
    }
    if (typeof checkObj.name !== "string") {
      return `check[${i}].name must be a string`;
    }
    if (!isValidCheckStatus(checkObj.status)) {
      return `check[${i}].status must be valid (PASS|FAIL|UNKNOWN|ACKNOWLEDGED)`;
    }
    if (!isValidSeverity(checkObj.severity)) {
      return `check[${i}].severity must be valid`;
    }
  }

  // Validate severity counts
  if (!posture.severityCounts || typeof posture.severityCounts !== "object") {
    return "severityCounts must be an object";
  }

  const counts = posture.severityCounts as Record<string, unknown>;
  if (
    typeof counts.CRITICAL !== "number" ||
    typeof counts.HIGH !== "number" ||
    typeof counts.MEDIUM !== "number" ||
    typeof counts.LOW !== "number" ||
    typeof counts.INFO !== "number"
  ) {
    return "severityCounts must have CRITICAL, HIGH, MEDIUM, LOW, INFO as numbers";
  }

  if (typeof posture.isFresh !== "boolean") {
    return "isFresh must be a boolean";
  }

  return null;
}

/**
 * Formats a severity level for display.
 */
export function formatSeverity(severity: SeverityLevel): string {
  switch (severity) {
    case "CRITICAL":
      return "Critical";
    case "HIGH":
      return "High";
    case "MEDIUM":
      return "Medium";
    case "LOW":
      return "Low";
    case "INFO":
      return "Informational";
  }
}

/**
 * Gets color for severity badge.
 */
export function getSeverityColor(
  severity: SeverityLevel
): "red" | "orange" | "yellow" | "blue" | "green" {
  switch (severity) {
    case "CRITICAL":
      return "red";
    case "HIGH":
      return "orange";
    case "MEDIUM":
      return "yellow";
    case "LOW":
      return "blue";
    case "INFO":
      return "green";
  }
}

/**
 * Formats a check status for display.
 */
export function formatCheckStatus(status: CheckStatus): string {
  switch (status) {
    case "PASS":
      return "Passed";
    case "FAIL":
      return "Failed";
    case "UNKNOWN":
      return "Unknown";
    case "ACKNOWLEDGED":
      return "Acknowledged";
  }
}

/**
 * Gets color for status badge.
 */
export function getStatusColor(status: CheckStatus): "green" | "red" | "gray" | "blue" {
  switch (status) {
    case "PASS":
      return "green";
    case "FAIL":
      return "red";
    case "UNKNOWN":
      return "gray";
    case "ACKNOWLEDGED":
      return "blue";
  }
}

/**
 * Formats a risk category for display.
 */
export function formatRiskCategory(category: RiskCategory): string {
  switch (category) {
    case "KEY_ROTATION":
      return "Key Rotation";
    case "SESSION_MANAGEMENT":
      return "Session Management";
    case "WEBHOOK_SECURITY":
      return "Webhook Security";
    case "ROLE_BASED_ACCESS":
      return "Role-Based Access";
    case "CONTRACT_VERIFICATION":
      return "Contract Verification";
    case "RECOVERY_OPTIONS":
      return "Recovery Options";
    case "API_SECURITY":
      return "API Security";
    case "DATA_ACCESS":
      return "Data Access";
  }
}

/**
 * Retrieves the security posture for an organization.
 * Filters checks by authorization and ensures tenant isolation.
 */
export async function getOrganizationSecurityPosture(
  token: string,
  organizationId: string,
  signal: AbortSignal
): Promise<SecurityPosture> {
  return retryRead(async (signal) => {
    return apiClient<SecurityPosture>({
      path: `/organizations/${organizationId}/security-posture`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Triggers evaluation of security checks for an organization.
 * Requires appropriate authorization.
 */
export async function evaluateSecurityChecks(
  token: string,
  organizationId: string,
  request: EvaluateCheckRequest,
  signal: AbortSignal
): Promise<EvaluateCheckResponse> {
  return retryMutation(async (signal) => {
    return apiClient<EvaluateCheckResponse>({
      path: `/organizations/${organizationId}/security-posture/evaluate`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

/**
 * Acknowledges a security finding as an acceptable risk.
 * Requires organization admin role.
 */
export async function acknowledgeSecurityCheck(
  token: string,
  organizationId: string,
  request: AcknowledgeCheckRequest,
  signal: AbortSignal
): Promise<AcknowledgeCheckResponse> {
  return retryMutation(async (signal) => {
    return apiClient<AcknowledgeCheckResponse>({
      path: `/organizations/${organizationId}/security-posture/checks/${request.checkId}/acknowledge`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({
        reason: request.reason,
        expiresAt: request.expiresAt,
      }),
      signal,
    });
  }, signal);
}

/**
 * Exports the security posture as a report.
 */
export async function exportSecurityPosture(
  token: string,
  organizationId: string,
  signal: AbortSignal
): Promise<SecurityPostureExport> {
  return retryRead(async (signal) => {
    return apiClient<SecurityPostureExport>({
      path: `/organizations/${organizationId}/security-posture/export`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Helpers for working with security posture data
 */

/**
 * Gets the most critical severity level from a posture.
 */
export function getMostCriticalSeverity(posture: SecurityPosture): SeverityLevel {
  if (posture.severityCounts.CRITICAL > 0) return "CRITICAL";
  if (posture.severityCounts.HIGH > 0) return "HIGH";
  if (posture.severityCounts.MEDIUM > 0) return "MEDIUM";
  if (posture.severityCounts.LOW > 0) return "LOW";
  return "INFO";
}

/**
 * Filters checks by status.
 */
export function filterChecksByStatus(
  checks: SecurityCheck[],
  status: CheckStatus
): SecurityCheck[] {
  return checks.filter((check) => check.status === status);
}

/**
 * Filters checks by category.
 */
export function filterChecksByCategory(
  checks: SecurityCheck[],
  category: RiskCategory
): SecurityCheck[] {
  return checks.filter((check) => check.category === category);
}

/**
 * Filters checks by severity.
 */
export function filterChecksBySeverity(
  checks: SecurityCheck[],
  severity: SeverityLevel
): SecurityCheck[] {
  return checks.filter((check) => check.severity === severity);
}

/**
 * Gets all unacknowledged failed checks.
 */
export function getUnacknowledgedFailures(posture: SecurityPosture): SecurityCheck[] {
  return posture.checks.filter(
    (check) => check.status === "FAIL" && !check.acknowledgement
  );
}

/**
 * Gets all acknowledged checks.
 */
export function getAcknowledgedChecks(posture: SecurityPosture): SecurityCheck[] {
  return posture.checks.filter((check) => check.acknowledgement !== undefined);
}

/**
 * Gets checks that need attention (failed or unknown).
 */
export function getChecksNeedingAttention(posture: SecurityPosture): SecurityCheck[] {
  return posture.checks.filter(
    (check) => check.status === "FAIL" || check.status === "UNKNOWN"
  );
}

/**
 * Determines if the security posture indicates critical issues.
 */
export function hasCriticalIssues(posture: SecurityPosture): boolean {
  return posture.severityCounts.CRITICAL > 0;
}

/**
 * Determines if any checks are stale (older than threshold).
 */
export function isPostureStale(posture: SecurityPosture, maxAgeMs: number = 86400000): boolean {
  const evaluatedTime = new Date(posture.evaluatedAt).getTime();
  const now = Date.now();
  return now - evaluatedTime > maxAgeMs;
}

/**
 * Gets a summary string for the security posture.
 */
export function getPostureSummary(posture: SecurityPosture): string {
  const { CRITICAL, HIGH, MEDIUM, LOW, INFO } = posture.severityCounts;
  const issues = [];

  if (CRITICAL > 0) issues.push(`${CRITICAL} critical`);
  if (HIGH > 0) issues.push(`${HIGH} high`);
  if (MEDIUM > 0) issues.push(`${MEDIUM} medium`);

  if (issues.length === 0) {
    return "All checks passed";
  }

  return `${issues.join(", ")} severity issues found`;
}

/**
 * Gets the time elapsed since posture was evaluated.
 */
export function getEvaluationAgeMs(posture: SecurityPosture): number {
  const evaluatedTime = new Date(posture.evaluatedAt).getTime();
  return Date.now() - evaluatedTime;
}

/**
 * Formats the evaluation time in a human-readable way.
 */
export function formatEvaluationAge(posture: SecurityPosture): string {
  const ageMs = getEvaluationAgeMs(posture);
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMs / 3600000);
  const ageDays = Math.floor(ageMs / 86400000);

  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${ageDays}d ago`;
}

/**
 * Groups checks by category for display.
 */
export function groupChecksByCategory(
  checks: SecurityCheck[]
): Record<RiskCategory, SecurityCheck[]> {
  const groups: Record<RiskCategory, SecurityCheck[]> = {
    KEY_ROTATION: [],
    SESSION_MANAGEMENT: [],
    WEBHOOK_SECURITY: [],
    ROLE_BASED_ACCESS: [],
    CONTRACT_VERIFICATION: [],
    RECOVERY_OPTIONS: [],
    API_SECURITY: [],
    DATA_ACCESS: [],
  };

  checks.forEach((check) => {
    groups[check.category].push(check);
  });

  return groups;
}
