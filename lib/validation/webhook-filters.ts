/**
 * Webhook Event Filter Types and Constants
 *
 * Defines the schema for event subscription filters with four predicate kinds:
 * event (event type), resource (resource type + optional ID), outcome (result state),
 * and version (API/schema version). Combined with AND across kinds, OR within each kind's values.
 *
 * All filters are tenant-scoped; tenant ID is never accepted from user input.
 */

/**
 * Supported resource types for filtering
 */
export const WEBHOOK_RESOURCE_TYPES = ["proof", "organization"] as const;
export type ResourceType = (typeof WEBHOOK_RESOURCE_TYPES)[number];

/**
 * Supported proof outcome states
 */
export const WEBHOOK_OUTCOMES = ["success", "failure", "pending"] as const;
export type ProofOutcome = (typeof WEBHOOK_OUTCOMES)[number];

/**
 * Webhook event types (reuse from webhooks.ts)
 */
export const WEBHOOK_EVENT_TYPES = [
  "proof.created",
  "proof.verified",
  "proof.revoked",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Named limits for filter predicates
 * These are enforced in validation and documented for API clients
 */
export const FILTER_LIMITS = {
  MAX_PREDICATES: 4, // event, resource, outcome, version (all optional)
  MAX_VALUES_PER_PREDICATE: 50,
  MAX_VALUE_LENGTH: 256, // e.g., resource ID, version string
  MAX_SERIALIZED_SIZE: 10_000, // bytes
} as const;

/**
 * Event predicate: OR of allowed event types
 * At least one event required if predicate is present
 */
export type EventPredicate = {
  allowedEvents: WebhookEventType[];
};

/**
 * Resource predicate: filter by resource type and optionally specific resource IDs
 * Resource IDs are tenant-scoped and validated server-side
 */
export type ResourcePredicate = {
  resourceType: ResourceType;
  resourceIds?: string[];
};

/**
 * Outcome predicate: OR of allowed proof outcomes
 * At least one outcome required if predicate is present
 */
export type OutcomePredicate = {
  outcomes: ProofOutcome[];
};

/**
 * Version predicate: OR of allowed API/schema versions
 * At least one version required if predicate is present
 */
export type VersionPredicate = {
  versions: string[];
};

/**
 * Complete webhook event filter schema
 *
 * All predicates are optional; absence means no filtering on that dimension.
 * When multiple predicates are present, they are combined with AND logic.
 * Within each predicate, values are combined with OR logic.
 *
 * Example: event=[proof.created, proof.verified] AND outcome=[success]
 * matches proof.created or proof.verified events with success outcome
 *
 * @example
 * const filter: WebhookEventFilter = {
 *   version: 1,
 *   predicates: {
 *     event: { allowedEvents: ["proof.created", "proof.verified"] },
 *     outcome: { outcomes: ["success"] },
 *   },
 * };
 */
export type WebhookEventFilter = {
  version: 1;
  predicates: {
    event?: EventPredicate;
    resource?: ResourcePredicate;
    outcome?: OutcomePredicate;
    version?: VersionPredicate;
  };
};

/**
 * Human-readable preview of a filter
 */
export type FilterPreview = {
  summary: string; // e.g., "proof.created or proof.verified events with success outcome"
  matchedEventTypes: WebhookEventType[]; // Events that would match (if backend supports preview)
  normalizedJson: string; // Formatted JSON of normalized filter
};

/**
 * Validation error with field path and reason
 */
export type FieldError = {
  path: string; // e.g., "predicates.event.allowedEvents"
  message: string;
};

/**
 * Validation result: either valid or detailed error list
 */
export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: FieldError[] };

/**
 * Filter preview/validation response from backend (optional feature)
 */
export type FilterPreviewResponse = {
  valid: boolean;
  matchedEventTypes: WebhookEventType[];
  normalizedFilter: WebhookEventFilter;
};

/**
 * Resource ID validation response
 * For security: returns only invalid IDs, not existence status of valid ones
 */
export type ValidateFilterResourcesResponse = {
  valid: boolean;
  invalidResourceIds?: string[];
};

/**
 * Default/empty filter (all events, all resources)
 */
export const DEFAULT_FILTER: WebhookEventFilter = {
  version: 1,
  predicates: {},
};

/**
 * Check if a filter is empty (no predicates defined)
 */
export function isEmptyFilter(filter: WebhookEventFilter): boolean {
  return Object.keys(filter.predicates).length === 0;
}

/**
 * Human-readable description of a resource type
 */
export function getResourceTypeLabel(resourceType: ResourceType): string {
  const labels: Record<ResourceType, string> = {
    proof: "Proof",
    organization: "Organization",
  };
  return labels[resourceType];
}

/**
 * Human-readable description of an outcome
 */
export function getOutcomeLabel(outcome: ProofOutcome): string {
  const labels: Record<ProofOutcome, string> = {
    success: "Success",
    failure: "Failure",
    pending: "Pending",
  };
  return labels[outcome];
}

/**
 * Reusable event descriptions (sync with webhooks.ts EVENT_DESCRIPTIONS)
 */
export const EVENT_TYPE_DESCRIPTIONS: Record<
  WebhookEventType,
  { title: string; description: string }
> = {
  "proof.created": {
    title: "Proof Created",
    description: "Fired when a new income or payment proof is created",
  },
  "proof.verified": {
    title: "Proof Verified",
    description: "Fired when a proof passes verification and is confirmed",
  },
  "proof.revoked": {
    title: "Proof Revoked",
    description: "Fired when a proof is revoked and becomes invalid",
  },
};
