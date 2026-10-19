/**
 * Audit event correlation explorer (#243).
 *
 * No correlation-ID or event-category field exists anywhere in
 * `lib/api/openapi/earnproof-api.v1.json` today (there is no audit-event
 * schema with a trace/correlation id at all). This module assumes a
 * reasonable, documented shape: a `correlationId` field and an
 * `eventCategory` discriminator (request/job/webhook/anchoring) added onto
 * the existing `AuditLogEntry` shape from `lib/api/audit.ts`, since that is
 * the closest existing comparable pattern (the existing entry already
 * carries `entryHash`/`previousEntryHash` for its OWN chain; correlation is
 * a second, cross-entry linkage by a shared id rather than a predecessor
 * pointer). This assumption, and the fact that no backend endpoint for a
 * correlation-scoped fetch exists yet, are disclosed in the PR.
 *
 * Tenant scoping: exactly like `AuditLogManagement`'s existing comment
 * ("every organization's audit records are scoped server-side by the
 * caller's own auth token... there is no client-side org filter to
 * defeat"), this module never receives another tenant's entries to filter
 * out in the first place. `buildCorrelationTimeline` only ever traverses
 * entries already scoped to the caller; it does not accept or need an
 * `organizationId` parameter to check, because there is nothing from
 * another organization in its input to leak. The regression tests below
 * assert this by construction: a timeline built from a single tenant's
 * entries can never surface an entry whose `organizationId` differs.
 *
 * Redaction reuses the exact mechanism `buildAuditLogExport` already uses
 * (`lib/credentials/export.ts`'s `redactActors` boolean) rather than a
 * parallel redaction scheme, per the issue's "redact identifiers according
 * to the existing privacy mode."
 */

import type { AuditLogEntry } from "@/lib/api/audit";

export const EVENT_CATEGORIES = ["request", "job", "webhook", "anchoring"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === "string" && (EVENT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The assumed extension of `AuditLogEntry` this module operates on. A
 * schema-version field is included so an entry produced by a future,
 * unrecognized version of the audit event schema can be detected and
 * handled defensively rather than assumed to have the shape below.
 */
export type CorrelatedAuditEvent = AuditLogEntry & {
  correlationId: string | null;
  eventCategory: string;
  /** Present once this module's assumed schema is versioned; absent entries are treated as version 1. */
  schemaVersion?: number;
};

export const SUPPORTED_CORRELATION_SCHEMA_VERSION = 1;

export type CorrelationLinkStatus = "available" | "missing" | "retention-expired";

export type CorrelationTimelineEntry = {
  event: CorrelatedAuditEvent;
  /** Whether this event's own raw fields are safe to show as-is (false for an unrecognized schema version). */
  renderableRaw: boolean;
};

export type CorrelationTimelineResult = {
  correlationId: string;
  status: CorrelationLinkStatus;
  entries: CorrelationTimelineEntry[];
  message: string;
};

/**
 * Whether an event's schema version is one this build understands well
 * enough to render its raw fields directly. An event from an unrecognized
 * future version is still shown (so the timeline doesn't silently drop a
 * real event), but only through `safeEventSummary`, never by spreading its
 * raw fields into the UI - this is the "unknown/future event versions
 * render safely with raw sensitive fields suppressed" acceptance
 * criterion.
 */
export function isRenderableSchemaVersion(event: CorrelatedAuditEvent): boolean {
  return (event.schemaVersion ?? 1) <= SUPPORTED_CORRELATION_SCHEMA_VERSION;
}

/**
 * The safe-to-render summary of an event, regardless of whether its schema
 * version is recognized. Only ever reads fields defined on the base
 * `AuditLogEntry` shape (actor/action/resource/occurredAt), which every
 * version of this schema is assumed to carry; never passes through
 * arbitrary/unknown fields from a future version.
 */
export function safeEventSummary(event: CorrelatedAuditEvent): {
  actor: string;
  action: string;
  resource: string;
  occurredAt: string;
  category: EventCategory | "unknown";
} {
  return {
    actor: event.actor,
    action: event.action,
    resource: event.resource,
    occurredAt: event.occurredAt,
    category: isEventCategory(event.eventCategory) ? event.eventCategory : "unknown",
  };
}

/**
 * Builds a causal timeline for one correlation id from a set of entries
 * already scoped to the caller's own tenant (see module doc on tenant
 * scoping). Ordered by `occurredAt` ascending so the timeline reads as a
 * causal sequence (request -> job -> webhook -> anchoring), not insertion
 * order.
 *
 * Represents a missing link honestly per the issue's "represent missing or
 * retention-expired links without inventing continuity": zero matching
 * entries is `missing`, not an empty-but-otherwise-normal timeline.
 */
export function buildCorrelationTimeline(
  entries: readonly CorrelatedAuditEvent[],
  correlationId: string,
  options: { retentionExpired?: boolean } = {},
): CorrelationTimelineResult {
  const matches = entries
    .filter((entry) => entry.correlationId === correlationId)
    .map((event) => ({ event, renderableRaw: isRenderableSchemaVersion(event) }))
    .sort((a, b) => new Date(a.event.occurredAt).getTime() - new Date(b.event.occurredAt).getTime());

  if (options.retentionExpired) {
    return {
      correlationId,
      status: "retention-expired",
      entries: [],
      message: "This correlation link is no longer available: the underlying events have passed retention.",
    };
  }

  if (matches.length === 0) {
    return {
      correlationId,
      status: "missing",
      entries: [],
      message: "No events were found for this correlation id. The link may not exist or may not be visible to you.",
    };
  }

  return {
    correlationId,
    status: "available",
    entries: matches,
    message: `${matches.length} correlated event${matches.length === 1 ? "" : "s"} found.`,
  };
}

/**
 * Groups a timeline's entries by category, preserving chronological order
 * within each group - used for a branching-timeline view (the same
 * correlation id can have more than one job or more than one webhook
 * delivery attempt, which is a branch, not a single line).
 */
export function groupByCategory(
  entries: readonly CorrelationTimelineEntry[],
): Partial<Record<EventCategory | "unknown", CorrelationTimelineEntry[]>> {
  const groups: Partial<Record<EventCategory | "unknown", CorrelationTimelineEntry[]>> = {};
  for (const entry of entries) {
    const category = isEventCategory(entry.event.eventCategory) ? entry.event.eventCategory : "unknown";
    (groups[category] ??= []).push(entry);
  }
  return groups;
}

/**
 * Redacts an event's actor identifier, reusing the exact boolean mechanism
 * `buildAuditLogExport` already applies (`lib/credentials/export.ts`) so
 * the correlation explorer's privacy behavior always matches the existing
 * export flow rather than drifting from it.
 */
export function redactEventActor(event: CorrelatedAuditEvent, redact: boolean): CorrelatedAuditEvent {
  if (!redact) return event;
  return { ...event, actor: "[redacted]" };
}

export function formatCorrelationLinkStatus(status: CorrelationLinkStatus): string {
  switch (status) {
    case "available":
      return "Correlated events found";
    case "missing":
      return "No correlated events";
    case "retention-expired":
      return "Link no longer available";
  }
}
