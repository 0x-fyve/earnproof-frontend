/**
 * Test fixtures for security posture dashboard
 * All timestamps are fixed ISO strings (never use Date.now())
 * All data uses fixtures, never inline objects
 * Covers positive, negative, edge cases, and authorization scenarios
 */

import type {
  SecurityCheck,
  SecurityPosture,
  SeverityLevel,
  CheckStatus,
  RiskCategory,
  SecurityPostureExport,
} from "@/lib/api/security-posture";

// Reference timestamp for all fixtures (2024-10-15T12:00:00Z)
const FIXTURE_TIMESTAMP = "2024-10-15T12:00:00.000Z";
const STALE_TIMESTAMP = "2024-10-01T12:00:00.000Z"; // 14 days old
const FRESH_TIMESTAMP = "2024-10-15T11:30:00.000Z"; // 30 minutes old

/**
 * Individual security check fixtures
 */

export const PASSED_CHECK_KEY_ROTATION: SecurityCheck = {
  id: "check-key-rotation-001",
  name: "Key Rotation",
  description: "All API keys have been rotated within the last 90 days",
  category: "KEY_ROTATION",
  status: "PASS",
  severity: "INFO",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: ["All 12 API keys rotated within policy"],
    affectedCount: 0,
    context: { lastRotation: "2024-10-10T00:00:00.000Z" },
  },
};

export const FAILED_CHECK_EXPIRED_KEYS: SecurityCheck = {
  id: "check-key-expiration-001",
  name: "Key Expiration Monitoring",
  description: "Critical API keys are tracked for expiration",
  category: "KEY_ROTATION",
  status: "FAIL",
  severity: "CRITICAL",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "3 API keys will expire within 30 days",
      "Key ep_prod_abc123 expires 2024-10-20",
      "Key ep_prod_def456 expires 2024-10-25",
    ],
    affectedCount: 3,
    context: { expiringKeys: ["ep_prod_abc123", "ep_prod_def456", "ep_prod_ghi789"] },
  },
  remediation: {
    remediationLink: "https://docs.example.com/api-keys#rotation",
    steps: [
      "Generate new API keys for each expiring key",
      "Update all applications to use new keys",
      "Verify no outages occur during transition",
      "Revoke expired keys",
    ],
  },
  owner: "api-security-team",
};

export const UNKNOWN_CHECK_SESSION_TIMEOUT: SecurityCheck = {
  id: "check-session-timeout-001",
  name: "Session Timeout Configuration",
  description: "Session timeout is properly configured",
  category: "SESSION_MANAGEMENT",
  status: "UNKNOWN",
  severity: "MEDIUM",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: ["Could not verify session configuration from current environment"],
    context: { reason: "Configuration unavailable" },
  },
  remediation: {
    steps: [
      "Review session timeout settings in configuration",
      "Verify timeout aligns with security policy",
    ],
  },
};

export const ACKNOWLEDGED_CHECK_WEBHOOK: SecurityCheck = {
  id: "check-webhook-signing-001",
  name: "Webhook Signature Verification",
  description: "All webhooks are signed and verified",
  category: "WEBHOOK_SECURITY",
  status: "ACKNOWLEDGED",
  severity: "HIGH",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "2 webhooks have unverified signatures",
      "Webhook wh-prod-001 from legacy system",
      "Webhook wh-prod-002 from partner integration",
    ],
    affectedCount: 2,
  },
  acknowledgement: {
    acknowledgedAt: "2024-10-14T10:00:00.000Z",
    acknowledgedBy: "admin@example.com",
    reason: "Legacy webhooks scheduled for migration in Q4 2024. Risk accepted until migration complete.",
    expiresAt: "2024-12-31T23:59:59.000Z",
  },
  owner: "infrastructure-team",
};

export const FAILED_CHECK_RBAC: SecurityCheck = {
  id: "check-rbac-001",
  name: "Role-Based Access Control",
  description: "Least privilege principle is enforced",
  category: "ROLE_BASED_ACCESS",
  status: "FAIL",
  severity: "HIGH",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "8 users have overly permissive roles",
      "3 DEVELOPER accounts with ADMIN permissions",
      "5 service accounts with unnecessary access",
    ],
    affectedCount: 8,
  },
  remediation: {
    remediationLink: "https://docs.example.com/rbac#audit",
    steps: [
      "Review each user's assigned roles",
      "Remove unnecessary elevated permissions",
      "Use dedicated service accounts for specific tasks",
      "Enable role-based access control enforcement",
    ],
  },
};

export const PASSED_CHECK_RECOVERY: SecurityCheck = {
  id: "check-recovery-options-001",
  name: "Recovery Options",
  description: "Multiple recovery methods are configured",
  category: "RECOVERY_OPTIONS",
  status: "PASS",
  severity: "LOW",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "Email recovery configured and verified",
      "Hardware security key enrolled",
      "Backup recovery codes generated",
    ],
    affectedCount: 0,
  },
};

export const FAILED_CHECK_CONTRACT_VERIFICATION: SecurityCheck = {
  id: "check-contract-verification-001",
  name: "Contract Verification",
  description: "All smart contracts are verified on blockchain",
  category: "CONTRACT_VERIFICATION",
  status: "FAIL",
  severity: "CRITICAL",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "1 contract not verified on explorer",
      "Contract CA7H5Q5RKBNJLG5A3FXVVX3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX unverified",
    ],
    affectedCount: 1,
  },
  remediation: {
    remediationLink: "https://stellar.expert/explorer",
    steps: [
      "Access contract on Stellar Expert",
      "Submit contract source code for verification",
      "Wait for verification completion",
      "Update contract metadata with verification details",
    ],
  },
};

export const PASSED_CHECK_DATA_ACCESS: SecurityCheck = {
  id: "check-data-access-001",
  name: "Data Access Controls",
  description: "Data is properly compartmentalized by tenant",
  category: "DATA_ACCESS",
  status: "PASS",
  severity: "INFO",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: ["All data queries properly scoped to authenticated tenant"],
    affectedCount: 0,
    context: { queriesValidated: 156 },
  },
};

export const FAILED_CHECK_API_SECURITY: SecurityCheck = {
  id: "check-api-security-001",
  name: "API Rate Limiting",
  description: "API endpoints have appropriate rate limits",
  category: "API_SECURITY",
  status: "FAIL",
  severity: "MEDIUM",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "2 endpoints missing rate limit configuration",
      "/api/v1/proofs endpoint: no limit",
      "/api/v1/verification endpoint: no limit",
    ],
    affectedCount: 2,
  },
  remediation: {
    remediationLink: "https://docs.example.com/api#rate-limits",
    steps: [
      "Configure rate limits for unprotected endpoints",
      "Test rate limiting under load",
      "Document rate limit policies",
      "Monitor for rate limit violations",
    ],
  },
};

/**
 * Full security posture fixtures covering different scenarios
 */

export const SECURITY_POSTURE_HEALTHY: SecurityPosture = {
  organizationId: "org-healthy-001",
  score: 95,
  scoreTrend: "IMPROVING",
  evaluatedAt: FRESH_TIMESTAMP,
  checks: [
    PASSED_CHECK_KEY_ROTATION,
    PASSED_CHECK_RECOVERY,
    PASSED_CHECK_DATA_ACCESS,
  ],
  severityCounts: {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 3,
  },
  isFresh: true,
  tenantId: "tenant-001",
};

export const SECURITY_POSTURE_WITH_FAILURES: SecurityPosture = {
  organizationId: "org-issues-001",
  score: 52,
  scoreTrend: "DECLINING",
  evaluatedAt: FIXTURE_TIMESTAMP,
  checks: [
    FAILED_CHECK_EXPIRED_KEYS,
    FAILED_CHECK_RBAC,
    FAILED_CHECK_CONTRACT_VERIFICATION,
    UNKNOWN_CHECK_SESSION_TIMEOUT,
    ACKNOWLEDGED_CHECK_WEBHOOK,
    PASSED_CHECK_RECOVERY,
  ],
  severityCounts: {
    CRITICAL: 2,
    HIGH: 2,
    MEDIUM: 1,
    LOW: 0,
    INFO: 0,
  },
  isFresh: true,
  tenantId: "tenant-001",
};

export const SECURITY_POSTURE_STALE: SecurityPosture = {
  organizationId: "org-stale-001",
  score: 78,
  scoreTrend: "STABLE",
  evaluatedAt: STALE_TIMESTAMP,
  checks: [
    PASSED_CHECK_KEY_ROTATION,
    UNKNOWN_CHECK_SESSION_TIMEOUT,
    PASSED_CHECK_DATA_ACCESS,
  ],
  severityCounts: {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 1,
    LOW: 0,
    INFO: 2,
  },
  isFresh: false,
  stalenessDays: 14,
  tenantId: "tenant-001",
};

export const SECURITY_POSTURE_ALL_PASSED: SecurityPosture = {
  organizationId: "org-excellent-001",
  score: 100,
  scoreTrend: "STABLE",
  evaluatedAt: FIXTURE_TIMESTAMP,
  checks: [
    PASSED_CHECK_KEY_ROTATION,
    PASSED_CHECK_RECOVERY,
    PASSED_CHECK_DATA_ACCESS,
    PASSED_CHECK_API_SECURITY,
  ],
  severityCounts: {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 4,
  },
  isFresh: true,
  tenantId: "tenant-001",
};

export const SECURITY_POSTURE_ALL_CRITICAL: SecurityPosture = {
  organizationId: "org-critical-001",
  score: 0,
  scoreTrend: "DECLINING",
  evaluatedAt: FIXTURE_TIMESTAMP,
  checks: [
    FAILED_CHECK_EXPIRED_KEYS,
    FAILED_CHECK_CONTRACT_VERIFICATION,
    FAILED_CHECK_RBAC,
    FAILED_CHECK_API_SECURITY,
  ],
  severityCounts: {
    CRITICAL: 2,
    HIGH: 2,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  },
  isFresh: true,
  tenantId: "tenant-001",
};

export const SECURITY_POSTURE_MOSTLY_UNKNOWN: SecurityPosture = {
  organizationId: "org-unknown-001",
  score: 50,
  scoreTrend: "STABLE",
  evaluatedAt: FIXTURE_TIMESTAMP,
  checks: [
    UNKNOWN_CHECK_SESSION_TIMEOUT,
    {
      id: "check-unknown-001",
      name: "Multi-Factor Authentication",
      description: "MFA is enforced for all users",
      category: "SESSION_MANAGEMENT",
      status: "UNKNOWN",
      severity: "HIGH",
      evaluatedAt: FIXTURE_TIMESTAMP,
      evidence: {
        findings: ["Could not verify MFA enforcement"],
      },
    },
    {
      id: "check-unknown-002",
      name: "Encryption at Rest",
      description: "All data is encrypted at rest",
      category: "DATA_ACCESS",
      status: "UNKNOWN",
      severity: "CRITICAL",
      evaluatedAt: FIXTURE_TIMESTAMP,
      evidence: {
        findings: ["Encryption status unavailable"],
      },
    },
  ],
  severityCounts: {
    CRITICAL: 1,
    HIGH: 1,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  },
  isFresh: true,
  tenantId: "tenant-001",
};

/**
 * Export fixture
 */
export const SECURITY_POSTURE_EXPORT: SecurityPostureExport = {
  organizationId: "org-issues-001",
  exportedAt: FIXTURE_TIMESTAMP,
  score: 52,
  checks: [
    {
      id: "check-key-expiration-001",
      name: "Key Expiration Monitoring",
      category: "KEY_ROTATION",
      status: "FAIL",
      severity: "CRITICAL",
      findings: [
        "3 API keys will expire within 30 days",
        "Key ep_prod_abc123 expires 2024-10-20",
      ],
    },
    {
      id: "check-rbac-001",
      name: "Role-Based Access Control",
      category: "ROLE_BASED_ACCESS",
      status: "FAIL",
      severity: "HIGH",
      findings: [
        "8 users have overly permissive roles",
        "3 DEVELOPER accounts with ADMIN permissions",
      ],
    },
  ],
};

/**
 * Edge case fixtures
 */

export const SECURITY_CHECK_WITH_LONG_TEXT: SecurityCheck = {
  id: "check-long-text-001",
  name: "This is a very long check name that tests how the UI handles text overflow and wrapping in the component layout",
  description:
    "This is a comprehensive description that explains in great detail what this security check does and why it matters. It includes multiple sentences and detailed explanations that would normally appear in documentation.",
  category: "DATA_ACCESS",
  status: "FAIL",
  severity: "HIGH",
  evaluatedAt: FIXTURE_TIMESTAMP,
  evidence: {
    findings: [
      "This is the first finding with a very long description that explains the issue in detail and provides context about what was discovered during the security check evaluation",
      "Second finding with another long description",
      "Third finding with yet another extensive description",
    ],
    affectedCount: 42,
  },
  remediation: {
    remediationLink: "https://docs.example.com/very/long/path/to/documentation/page",
    steps: [
      "First step: This is a very detailed remediation step that explains exactly what needs to be done to resolve this security issue",
      "Second step with additional context and details about implementation",
      "Third step covering validation and testing of the remediation",
      "Fourth step for monitoring and ongoing compliance",
    ],
  },
  owner: "very-long-team-name-security-operations-center",
};

export const SECURITY_CHECK_MINIMAL: SecurityCheck = {
  id: "check-min-001",
  name: "Minimal Check",
  description: "Minimal check",
  category: "KEY_ROTATION",
  status: "PASS",
  severity: "INFO",
  evaluatedAt: FIXTURE_TIMESTAMP,
};

/**
 * Multi-tenant isolation fixtures
 */

export const SECURITY_POSTURE_TENANT_A: SecurityPosture = {
  organizationId: "org-tenant-a-001",
  score: 85,
  evaluatedAt: FIXTURE_TIMESTAMP,
  checks: [PASSED_CHECK_KEY_ROTATION, PASSED_CHECK_RECOVERY],
  severityCounts: {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 2,
  },
  isFresh: true,
  tenantId: "tenant-a",
};

export const SECURITY_POSTURE_TENANT_B: SecurityPosture = {
  organizationId: "org-tenant-b-001",
  score: 45,
  evaluatedAt: FIXTURE_TIMESTAMP,
  checks: [FAILED_CHECK_RBAC, FAILED_CHECK_API_SECURITY],
  severityCounts: {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 1,
    LOW: 0,
    INFO: 0,
  },
  isFresh: true,
  tenantId: "tenant-b",
};
