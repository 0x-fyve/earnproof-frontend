/**
 * Synthetic test fixtures for webhook event filters
 * Used for testing without real data or production credentials
 */

import { WebhookEventFilter } from "../webhook-filters";

/**
 * Empty filter (no predicates)
 */
export const emptyFilter: WebhookEventFilter = {
  version: 1,
  predicates: {},
};

/**
 * Filter with single event type
 */
export const eventOnlyFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created"] },
  },
};

/**
 * Filter with multiple event types (OR logic within predicate)
 */
export const eventMultipleFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created", "proof.verified"] },
  },
};

/**
 * Filter with resource type only
 */
export const resourceTypeOnlyFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    resource: {
      resourceType: "proof",
    },
  },
};

/**
 * Filter with resource type and specific IDs
 */
export const resourceWithIdsFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    resource: {
      resourceType: "proof",
      resourceIds: ["proof_abc123", "proof_xyz789"],
    },
  },
};

/**
 * Filter with outcome predicate
 */
export const outcomeOnlyFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    outcome: {
      outcomes: ["success"],
    },
  },
};

/**
 * Filter with multiple outcomes
 */
export const outcomeMultipleFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    outcome: {
      outcomes: ["success", "failure"],
    },
  },
};

/**
 * Filter with version predicate
 */
export const versionOnlyFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    version: {
      versions: ["1.0"],
    },
  },
};

/**
 * Filter with multiple versions
 */
export const versionMultipleFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    version: {
      versions: ["1.0", "2.0", "2.1"],
    },
  },
};

/**
 * Complex filter with all four predicate kinds (AND logic across kinds)
 */
export const complexFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created", "proof.verified"] },
    resource: {
      resourceType: "proof",
      resourceIds: ["proof_123", "proof_456"],
    },
    outcome: { outcomes: ["success", "pending"] },
    version: { versions: ["1.0", "2.0"] },
  },
};

/**
 * Filter with event and outcome (common case)
 */
export const eventOutcomeFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created"] },
    outcome: { outcomes: ["success"] },
  },
};

/**
 * Unsorted filter (for normalization testing)
 */
export const unsortedFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.revoked", "proof.created", "proof.verified"] },
    outcome: { outcomes: ["pending", "success", "failure"] },
  },
};

/**
 * Filter with duplicates (for normalization testing)
 */
export const filterWithDuplicates: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created", "proof.created", "proof.verified"] },
    resource: {
      resourceType: "proof",
      resourceIds: ["proof_123", "proof_789", "proof_123"],
    },
  },
};

/**
 * At-boundary filter (exactly max values per predicate)
 */
export function createMaxValuesFilter(): WebhookEventFilter {
  // Create 50 distinct versions (the limit)
  const versions = Array.from({ length: 50 }, (_, i) => `v${i + 1}.0`);
  return {
    version: 1,
    predicates: {
      version: { versions },
    },
  };
}

/**
 * Over-boundary filter (exceeds max values per predicate)
 */
export function createExceedsMaxValuesFilter(): WebhookEventFilter {
  const versions = Array.from({ length: 51 }, (_, i) => `v${i + 1}.0`);
  return {
    version: 1,
    predicates: {
      version: { versions },
    },
  };
}

/**
 * Invalid filter: unknown event type
 */
export const invalidEventTypeFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["invalid.event"] },
  },
};

/**
 * Invalid filter: unknown resource type
 */
export const invalidResourceTypeFilter = {
  version: 1,
  predicates: {
    resource: { resourceType: "invalid_type" },
  },
};

/**
 * Invalid filter: unknown outcome
 */
export const invalidOutcomeFilter = {
  version: 1,
  predicates: {
    outcome: { outcomes: ["invalid_outcome"] },
  },
};

/**
 * Invalid filter: empty event predicate
 */
export const emptyEventPredicateFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: [] },
  },
};

/**
 * Invalid filter: duplicate events
 */
export const duplicateEventsFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created", "proof.created"] },
  },
};

/**
 * Invalid filter: tenant ID in input (security issue)
 */
export const filterWithTenantId = {
  version: 1,
  predicates: {},
  tenantId: "malicious_tenant_id",
};

/**
 * Invalid filter: organization ID in input (security issue)
 */
export const filterWithOrgId = {
  version: 1,
  predicates: {},
  organizationId: "malicious_org_id",
};

/**
 * Invalid filter: unknown field in root
 */
export const filterWithUnknownField = {
  version: 1,
  predicates: {},
  unknownField: "should_reject",
};

/**
 * Invalid filter: resource ID with special characters
 */
export const filterWithInvalidCharactersInResourceId = {
  version: 1,
  predicates: {
    resource: {
      resourceType: "proof",
      resourceIds: ["proof<script>alert('xss')</script>"],
    },
  },
};
