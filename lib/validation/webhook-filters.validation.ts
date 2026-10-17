/**
 * Webhook Event Filter Validation and Normalization
 *
 * Provides strict, schema-based validation with field-level errors.
 * Implements deterministic normalization (sort, deduplicate, stable key order)
 * so equivalent filters serialize identically for replay/conflict detection.
 *
 * Security principles:
 * - Never accept tenant ID from user input
 * - Reject unknown fields (not silently drop)
 * - Enforce named boundaries
 * - Cross-tenant resource IDs rejected with no existence leakage
 */

import { z } from "zod";
import {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_RESOURCE_TYPES,
  WEBHOOK_OUTCOMES,
  FILTER_LIMITS,
  type WebhookEventFilter,
  type FieldError,
  type ValidationResult,
  type EventPredicate,
  type ResourcePredicate,
  type OutcomePredicate,
  type VersionPredicate,
} from "./webhook-filters";

/**
 * Zod schema for event predicate
 */
const eventPredicateSchema = z
  .object({
    allowedEvents: z
      .array(z.enum(WEBHOOK_EVENT_TYPES))
      .min(1, "Event predicate must have at least one event type")
      .max(
        FILTER_LIMITS.MAX_VALUES_PER_PREDICATE,
        `Maximum ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE} event types allowed`
      )
      .refine(
        (arr) => new Set(arr).size === arr.length,
        "Duplicate event types are not allowed"
      ),
  })
  .strict();

/**
 * Zod schema for resource predicate
 */
const resourcePredicateSchema = z
  .object({
    resourceType: z.enum(WEBHOOK_RESOURCE_TYPES),
    resourceIds: z
      .array(
        z
          .string()
          .min(1, "Resource ID cannot be empty")
          .max(
            FILTER_LIMITS.MAX_VALUE_LENGTH,
            `Resource ID must be at most ${FILTER_LIMITS.MAX_VALUE_LENGTH} characters`
          )
          .refine(
            (id) => !/[<>{}"|\\^`]/.test(id),
            "Resource ID contains invalid characters"
          )
      )
      .refine(
        (arr) => new Set(arr).size === arr.length,
        "Duplicate resource IDs are not allowed"
      )
      .max(
        FILTER_LIMITS.MAX_VALUES_PER_PREDICATE,
        `Maximum ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE} resource IDs allowed`
      )
      .optional(),
  })
  .strict();

/**
 * Zod schema for outcome predicate
 */
const outcomePredicateSchema = z
  .object({
    outcomes: z
      .array(z.enum(WEBHOOK_OUTCOMES))
      .min(1, "Outcome predicate must have at least one outcome")
      .max(
        FILTER_LIMITS.MAX_VALUES_PER_PREDICATE,
        `Maximum ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE} outcomes allowed`
      )
      .refine(
        (arr) => new Set(arr).size === arr.length,
        "Duplicate outcomes are not allowed"
      ),
  })
  .strict();

/**
 * Zod schema for version predicate
 */
const versionPredicateSchema = z
  .object({
    versions: z
      .array(
        z
          .string()
          .min(1, "Version cannot be empty")
          .max(
            FILTER_LIMITS.MAX_VALUE_LENGTH,
            `Version must be at most ${FILTER_LIMITS.MAX_VALUE_LENGTH} characters`
          )
          .refine(
            (v) => /^[0-9a-zA-Z.\-_]+$/.test(v),
            "Version must contain only alphanumeric characters, dots, hyphens, and underscores"
          )
      )
      .min(1, "Version predicate must have at least one version")
      .max(
        FILTER_LIMITS.MAX_VALUES_PER_PREDICATE,
        `Maximum ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE} versions allowed`
      )
      .refine(
        (arr) => new Set(arr).size === arr.length,
        "Duplicate versions are not allowed"
      ),
  })
  .strict();

/**
 * Complete Zod schema for webhook event filter
 * Uses .strict() to reject unknown fields
 */
export const webhookEventFilterSchema = z
  .object({
    version: z.literal(1),
    predicates: z
      .object({
        event: eventPredicateSchema.optional(),
        resource: resourcePredicateSchema.optional(),
        outcome: outcomePredicateSchema.optional(),
        version: versionPredicateSchema.optional(),
      })
      .strict(),
  })
  .strict();

/**
 * Convert Zod errors to field-level errors
 */
function zodsErrorsToFieldErrors(error: z.ZodError): FieldError[] {
  return error.errors.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Validate a filter object
 *
 * @param filter - Unknown value to validate
 * @returns ValidationResult with ok=true or detailed errors
 */
export function validateFilter(filter: unknown): ValidationResult {
  const result = webhookEventFilterSchema.safeParse(filter);

  if (!result.success) {
    return {
      ok: false,
      errors: zodsErrorsToFieldErrors(result.error),
    };
  }

  // Check for tenant ID fields (security check)
  const filterObj = filter as Record<string, unknown>;
  if ("tenantId" in filterObj || "organizationId" in filterObj) {
    return {
      ok: false,
      errors: [
        {
          path: "filter",
          message:
            "Tenant scope is managed by the server. Do not include tenantId or organizationId in the filter.",
        },
      ],
    };
  }

  // Check serialized size
  const serialized = JSON.stringify(result.data);
  if (serialized.length > FILTER_LIMITS.MAX_SERIALIZED_SIZE) {
    return {
      ok: false,
      errors: [
        {
          path: "filter",
          message: `Filter is too large (${serialized.length} bytes, max ${FILTER_LIMITS.MAX_SERIALIZED_SIZE})`,
        },
      ],
    };
  }

  return { ok: true };
}

/**
 * Validate a single field value (for real-time validation in UI)
 *
 * @param fieldPath - e.g., "predicates.event.allowedEvents" or "predicates.resource.resourceIds"
 * @param value - Value to validate
 * @returns Error message or null if valid
 */
export function validateFieldValue(fieldPath: string, value: unknown): string | null {
  const [section, predicate, field] = fieldPath.split(".");

  if (section !== "predicates") {
    return "Invalid field path";
  }

  try {
    if (predicate === "event" && field === "allowedEvents") {
      eventPredicateSchema.parse({ allowedEvents: value });
      return null;
    }

    if (predicate === "resource") {
      if (field === "resourceType") {
        z.enum(WEBHOOK_RESOURCE_TYPES).parse(value);
        return null;
      }
      if (field === "resourceIds") {
        resourcePredicateSchema.pick({ resourceIds: true }).parse({ resourceIds: value });
        return null;
      }
    }

    if (predicate === "outcome" && field === "outcomes") {
      outcomePredicateSchema.parse({ outcomes: value });
      return null;
    }

    if (predicate === "version" && field === "versions") {
      versionPredicateSchema.parse({ versions: value });
      return null;
    }

    return "Unknown field path";
  } catch (err) {
    if (err instanceof z.ZodError) {
      return err.errors[0]?.message || "Invalid value";
    }
    return "Validation error";
  }
}

/**
 * Normalize a filter deterministically
 *
 * - Sort values within each predicate (lexicographic order)
 * - Deduplicate values
 * - Preserve stable key order (alphabetical)
 *
 * @param filter - Filter to normalize
 * @returns Normalized filter (new object)
 */
export function normalizeFilter(filter: WebhookEventFilter): WebhookEventFilter {
  const normalized: WebhookEventFilter = {
    version: 1,
    predicates: {},
  };

  // Event predicate
  if (filter.predicates.event) {
    const events = Array.from(new Set(filter.predicates.event.allowedEvents)).sort();
    normalized.predicates.event = { allowedEvents: events };
  }

  // Resource predicate
  if (filter.predicates.resource) {
    const predicate: ResourcePredicate = {
      resourceType: filter.predicates.resource.resourceType,
    };
    if (filter.predicates.resource.resourceIds) {
      predicate.resourceIds = Array.from(
        new Set(filter.predicates.resource.resourceIds)
      ).sort();
    }
    normalized.predicates.resource = predicate;
  }

  // Outcome predicate
  if (filter.predicates.outcome) {
    const outcomes = Array.from(new Set(filter.predicates.outcome.outcomes)).sort();
    normalized.predicates.outcome = { outcomes };
  }

  // Version predicate
  if (filter.predicates.version) {
    const versions = Array.from(new Set(filter.predicates.version.versions)).sort();
    normalized.predicates.version = { versions };
  }

  return normalized;
}

/**
 * Serialize a filter to JSON with stable key order (alphabetical)
 * Always normalizes before serializing
 *
 * @param filter - Filter to serialize
 * @returns JSON string with stable key order
 */
export function serializeFilter(filter: WebhookEventFilter): string {
  const normalized = normalizeFilter(filter);
  return JSON.stringify(normalized, Object.keys(normalized).sort());
}

/**
 * Check if a filter violates any boundary
 * Returns error message if violation detected, null otherwise
 *
 * @param filter - Filter to check
 * @returns Error message or null
 */
export function checkFilterBoundaryViolations(
  filter: WebhookEventFilter
): string | null {
  // Count predicates
  const predicateCount = Object.keys(filter.predicates).length;
  if (predicateCount > FILTER_LIMITS.MAX_PREDICATES) {
    return `Too many predicates (${predicateCount}, max ${FILTER_LIMITS.MAX_PREDICATES})`;
  }

  // Check value counts in each predicate
  if (filter.predicates.event) {
    if (filter.predicates.event.allowedEvents.length > FILTER_LIMITS.MAX_VALUES_PER_PREDICATE) {
      return `Too many event types (${filter.predicates.event.allowedEvents.length}, max ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE})`;
    }
  }

  if (filter.predicates.resource?.resourceIds) {
    if (filter.predicates.resource.resourceIds.length > FILTER_LIMITS.MAX_VALUES_PER_PREDICATE) {
      return `Too many resource IDs (${filter.predicates.resource.resourceIds.length}, max ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE})`;
    }
  }

  if (filter.predicates.outcome) {
    if (filter.predicates.outcome.outcomes.length > FILTER_LIMITS.MAX_VALUES_PER_PREDICATE) {
      return `Too many outcomes (${filter.predicates.outcome.outcomes.length}, max ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE})`;
    }
  }

  if (filter.predicates.version) {
    if (filter.predicates.version.versions.length > FILTER_LIMITS.MAX_VALUES_PER_PREDICATE) {
      return `Too many versions (${filter.predicates.version.versions.length}, max ${FILTER_LIMITS.MAX_VALUES_PER_PREDICATE})`;
    }
  }

  // Check value lengths
  const allValues: string[] = [];
  if (filter.predicates.event) {
    allValues.push(...filter.predicates.event.allowedEvents);
  }
  if (filter.predicates.resource?.resourceIds) {
    allValues.push(...filter.predicates.resource.resourceIds);
  }
  if (filter.predicates.version?.versions) {
    allValues.push(...filter.predicates.version.versions);
  }

  for (const value of allValues) {
    if (value.length > FILTER_LIMITS.MAX_VALUE_LENGTH) {
      return `Value too long ("${value.substring(0, 20)}...", max ${FILTER_LIMITS.MAX_VALUE_LENGTH} chars)`;
    }
  }

  // Check serialized size
  const serialized = serializeFilter(filter);
  if (serialized.length > FILTER_LIMITS.MAX_SERIALIZED_SIZE) {
    return `Filter is too large (${serialized.length} bytes, max ${FILTER_LIMITS.MAX_SERIALIZED_SIZE})`;
  }

  return null;
}

/**
 * Generate human-readable summary of a filter
 *
 * @param filter - Filter to describe
 * @returns Human-readable string
 */
export function generateFilterSummary(filter: WebhookEventFilter): string {
  const parts: string[] = [];

  if (filter.predicates.event) {
    const events = filter.predicates.event.allowedEvents;
    if (events.length === 1) {
      parts.push(`Event: ${events[0]}`);
    } else {
      parts.push(`Events: ${events.join(" or ")}`);
    }
  }

  if (filter.predicates.resource) {
    if (filter.predicates.resource.resourceIds && filter.predicates.resource.resourceIds.length > 0) {
      parts.push(
        `Resource: ${filter.predicates.resource.resourceType}s with IDs: ${filter.predicates.resource.resourceIds.join(", ")}`
      );
    } else {
      parts.push(`Resource: any ${filter.predicates.resource.resourceType}`);
    }
  }

  if (filter.predicates.outcome) {
    const outcomes = filter.predicates.outcome.outcomes;
    if (outcomes.length === 1) {
      parts.push(`Outcome: ${outcomes[0]}`);
    } else {
      parts.push(`Outcomes: ${outcomes.join(" or ")}`);
    }
  }

  if (filter.predicates.version) {
    const versions = filter.predicates.version.versions;
    if (versions.length === 1) {
      parts.push(`Version: ${versions[0]}`);
    } else {
      parts.push(`Versions: ${versions.join(" or ")}`);
    }
  }

  if (parts.length === 0) {
    return "No filter (all events for this tenant)";
  }

  return parts.join("; ");
}
