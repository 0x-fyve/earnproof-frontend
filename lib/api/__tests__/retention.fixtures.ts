/**
 * Test fixtures for retention and legal hold policies
 * Uses synthetic test data only - no production credentials or real data
 */

import {
  RetentionPolicy,
  LegalHold,
  RetentionPeriod,
  LegalHoldStatus,
} from "../retention";

/**
 * Creates a mock retention policy
 */
export function createMockRetentionPolicy(overrides?: Partial<RetentionPolicy>): RetentionPolicy {
  return {
    id: "policy-123",
    organizationId: "org-456",
    period: "90_DAYS",
    effectiveFrom: "2024-01-15T00:00:00Z",
    createdAt: "2024-01-15T10:30:00Z",
    createdBy: "admin@example.com",
    description: "Standard 90-day retention for audit compliance",
    ...overrides,
  };
}

/**
 * Creates multiple mock retention policies for history
 */
export function createMockRetentionPoliciesHistory(): RetentionPolicy[] {
  return [
    createMockRetentionPolicy({
      id: "policy-789",
      period: "30_DAYS",
      effectiveFrom: "2023-10-01T00:00:00Z",
      createdAt: "2023-10-01T09:00:00Z",
      createdBy: "admin@example.com",
      description: "Previous 30-day retention policy",
    }),
    createMockRetentionPolicy({
      id: "policy-456",
      period: "1_YEAR",
      effectiveFrom: "2023-06-01T00:00:00Z",
      createdAt: "2023-06-01T14:00:00Z",
      createdBy: "compliance@example.com",
      description: "Extended retention for Q2-Q3 2023",
    }),
  ];
}

/**
 * Creates a mock legal hold
 */
export function createMockLegalHold(overrides?: Partial<LegalHold>): LegalHold {
  return {
    id: "hold-001",
    organizationId: "org-456",
    status: "ACTIVE",
    scope: {
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-03-31T23:59:59Z",
      affectedRecordCount: 15234,
    },
    reason: "Legal proceedings - Case #2024-0815 requires preservation of Q1 2024 audit records",
    createdAt: "2024-01-20T11:45:00Z",
    createdBy: "legal-dept@example.com",
    expiresAt: "2025-01-20T00:00:00Z",
    releaseApproval: undefined,
    ...overrides,
  };
}

/**
 * Creates a released legal hold with approval
 */
export function createMockReleasedLegalHold(): LegalHold {
  return createMockLegalHold({
    id: "hold-002",
    status: "RELEASED",
    expiresAt: null,
    releaseApproval: {
      approvedAt: "2024-06-15T09:00:00Z",
      approvedBy: "legal-director@example.com",
      reason: "Case resolved - approval for records disposal",
    },
  });
}

/**
 * Creates an expired legal hold
 */
export function createMockExpiredLegalHold(): LegalHold {
  return createMockLegalHold({
    id: "hold-003",
    status: "EXPIRED",
    expiresAt: "2024-12-20T00:00:00Z",
    scope: {
      startDate: "2023-12-01T00:00:00Z",
      endDate: "2024-01-15T23:59:59Z",
      affectedRecordCount: 8492,
    },
  });
}

/**
 * Creates multiple legal holds with varying statuses
 */
export function createMockLegalHoldsCollection(): LegalHold[] {
  return [
    createMockLegalHold(),
    createMockReleasedLegalHold(),
    createMockExpiredLegalHold(),
    createMockLegalHold({
      id: "hold-004",
      status: "ACTIVE",
      scope: {
        startDate: "2024-06-01T00:00:00Z",
        endDate: "2024-12-31T23:59:59Z",
        affectedRecordCount: 45221,
      },
      reason: "Regulatory audit - Financial Conduct Authority compliance review",
      createdAt: "2024-06-01T08:00:00Z",
      createdBy: "compliance@example.com",
      expiresAt: null,
    }),
  ];
}

/**
 * Test data for date range validation
 */
export const VALID_DATE_RANGES = [
  {
    startDate: "2024-01-01",
    endDate: "2024-01-01",
    description: "Single day",
  },
  {
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    description: "One month",
  },
  {
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    description: "One year",
  },
  {
    startDate: "2020-01-01",
    endDate: "2029-12-31",
    description: "10 years (max span)",
  },
];

export const INVALID_DATE_RANGES = [
  {
    startDate: "2024-01-31",
    endDate: "2024-01-01",
    description: "End before start",
    expectedError: "Start date must be before or equal to end date",
  },
  {
    startDate: "2020-01-01",
    endDate: "2030-01-01",
    description: "Exceeds 10 year span",
    expectedError: "Date range cannot exceed 3650 days",
  },
  {
    startDate: "invalid",
    endDate: "2024-01-31",
    description: "Invalid start date format",
    expectedError: "Invalid date format",
  },
];

/**
 * Test data for legal hold reasons
 */
export const VALID_REASONS = [
  "Legal proceedings require preservation of records",
  "Litigation hold for case #2024-0815",
  "Regulatory investigation by SEC",
  "Employee dispute litigation",
  "Contract breach investigation by external counsel",
];

export const INVALID_REASONS = [
  {
    reason: "",
    description: "Empty reason",
    expectedError: "Reason is required",
  },
  {
    reason: "Short",
    description: "Too short (< 10 chars)",
    expectedError: "Reason must be at least 10 characters",
  },
  {
    reason: "x".repeat(1001),
    description: "Too long (> 1000 chars)",
    expectedError: "Reason must not exceed 1000 characters",
  },
];

/**
 * Test data for retention periods
 */
export const RETENTION_PERIOD_TEST_DATA: Array<{
  period: RetentionPeriod;
  label: string;
  days: number | null;
}> = [
  { period: "7_DAYS", label: "7 days", days: 7 },
  { period: "30_DAYS", label: "30 days", days: 30 },
  { period: "90_DAYS", label: "90 days", days: 90 },
  { period: "1_YEAR", label: "1 year", days: 365 },
  { period: "3_YEARS", label: "3 years", days: 1095 },
  { period: "5_YEARS", label: "5 years", days: 1825 },
  { period: "INDEFINITE", label: "Indefinite", days: null },
];

/**
 * Mock session for testing
 */
export const MOCK_ADMIN_SESSION = {
  token: "test-token-admin-12345",
  user: {
    id: "user-admin-001",
    walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7",
    walletHash: "hash-123",
    role: "ADMIN" as const,
  },
};

export const MOCK_ISSUER_SESSION = {
  token: "test-token-issuer-12345",
  user: {
    id: "user-issuer-001",
    walletAddress: "0x123456789abcdef0123456789abcdef012345678",
    walletHash: "hash-issuer-123",
    role: "ISSUER" as const,
  },
};

export const MOCK_DEVELOPER_SESSION = {
  token: "test-token-dev-12345",
  user: {
    id: "user-dev-001",
    walletAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
    walletHash: "hash-dev-123",
    role: "DEVELOPER" as const,
  },
};
