import {
  buildCorrelationTimeline,
  formatCorrelationLinkStatus,
  groupByCategory,
  isEventCategory,
  isRenderableSchemaVersion,
  redactEventActor,
  safeEventSummary,
  SUPPORTED_CORRELATION_SCHEMA_VERSION,
  type CorrelatedAuditEvent,
} from "../correlation-explorer";

function event(overrides: Partial<CorrelatedAuditEvent> = {}): CorrelatedAuditEvent {
  return {
    id: "evt-1",
    actor: "user-1",
    action: "proof.created",
    resource: "proof-1",
    occurredAt: "2026-06-01T10:00:00.000Z",
    organizationId: "org-1",
    entryHash: "hash-1",
    previousEntryHash: null,
    correlationId: "corr-1",
    eventCategory: "request",
    ...overrides,
  };
}

describe("isEventCategory", () => {
  it("accepts the four documented categories", () => {
    expect(isEventCategory("request")).toBe(true);
    expect(isEventCategory("job")).toBe(true);
    expect(isEventCategory("webhook")).toBe(true);
    expect(isEventCategory("anchoring")).toBe(true);
  });

  it("rejects an unrecognized category", () => {
    expect(isEventCategory("unknown-future-category")).toBe(false);
    expect(isEventCategory(undefined)).toBe(false);
    expect(isEventCategory(123)).toBe(false);
  });
});

describe("buildCorrelationTimeline", () => {
  it("returns an available timeline ordered by occurredAt ascending (branching inputs out of order)", () => {
    const entries = [
      event({ id: "evt-3", occurredAt: "2026-06-01T12:00:00.000Z", eventCategory: "anchoring" }),
      event({ id: "evt-1", occurredAt: "2026-06-01T10:00:00.000Z", eventCategory: "request" }),
      event({ id: "evt-2", occurredAt: "2026-06-01T11:00:00.000Z", eventCategory: "job" }),
    ];
    const result = buildCorrelationTimeline(entries, "corr-1");
    expect(result.status).toBe("available");
    expect(result.entries.map((e) => e.event.id)).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("only includes entries whose correlationId matches (does not pull in unrelated entries)", () => {
    const entries = [event({ id: "evt-1", correlationId: "corr-1" }), event({ id: "evt-2", correlationId: "corr-2" })];
    const result = buildCorrelationTimeline(entries, "corr-1");
    expect(result.entries.map((e) => e.event.id)).toEqual(["evt-1"]);
  });

  it("represents a correlation id with zero matches as missing, not an empty-but-normal timeline", () => {
    const result = buildCorrelationTimeline([event({ correlationId: "corr-1" })], "corr-does-not-exist");
    expect(result.status).toBe("missing");
    expect(result.entries).toEqual([]);
  });

  it("represents a retention-expired link honestly, without fabricating entries even if some are passed in", () => {
    const entries = [event({ correlationId: "corr-1" })];
    const result = buildCorrelationTimeline(entries, "corr-1", { retentionExpired: true });
    expect(result.status).toBe("retention-expired");
    expect(result.entries).toEqual([]);
    expect(result.message).toMatch(/no longer available/i);
  });

  it("never surfaces an entry from a different organizationId than the ones supplied (tenant isolation by construction)", () => {
    // The module's contract is "entries are already scoped to one tenant" -
    // this proves it doesn't accidentally merge across organizationId
    // itself when given a mixed input it should never realistically receive.
    const entries = [
      event({ id: "evt-mine", correlationId: "corr-1", organizationId: "org-mine" }),
      event({ id: "evt-theirs", correlationId: "corr-1", organizationId: "org-theirs" }),
    ];
    const result = buildCorrelationTimeline(entries, "corr-1");
    // Both appear in the raw result because the module trusts its input is
    // pre-scoped; the real isolation guarantee is that the caller (the API
    // layer) never supplies a cross-tenant entry in the first place. This
    // test documents that assumption explicitly rather than leaving it
    // implicit, and will fail loudly if a future change makes this module
    // itself respansible for a tenant filter without updating this.
    expect(result.entries).toHaveLength(2);
  });
});

describe("isRenderableSchemaVersion / safeEventSummary", () => {
  it("treats an entry with no schemaVersion as version 1 (renderable)", () => {
    expect(isRenderableSchemaVersion(event())).toBe(true);
  });

  it("treats the current supported version as renderable", () => {
    expect(isRenderableSchemaVersion(event({ schemaVersion: SUPPORTED_CORRELATION_SCHEMA_VERSION }))).toBe(true);
  });

  it("treats a future, unrecognized schema version as not renderable", () => {
    expect(isRenderableSchemaVersion(event({ schemaVersion: SUPPORTED_CORRELATION_SCHEMA_VERSION + 1 }))).toBe(false);
  });

  it("safeEventSummary only ever returns known-safe fields, even for an unrecognized version", () => {
    const futureEvent = event({
      schemaVersion: 99,
      eventCategory: "some-future-category",
    });
    const summary = safeEventSummary(futureEvent);
    expect(summary).toEqual({
      actor: "user-1",
      action: "proof.created",
      resource: "proof-1",
      occurredAt: "2026-06-01T10:00:00.000Z",
      category: "unknown",
    });
    expect(Object.keys(summary)).toEqual(["actor", "action", "resource", "occurredAt", "category"]);
  });
});

describe("groupByCategory", () => {
  it("groups entries by category, preserving order within each group", () => {
    const timeline = buildCorrelationTimeline(
      [
        event({ id: "r1", eventCategory: "request", occurredAt: "2026-06-01T09:00:00.000Z" }),
        event({ id: "j1", eventCategory: "job", occurredAt: "2026-06-01T09:05:00.000Z" }),
        event({ id: "j2", eventCategory: "job", occurredAt: "2026-06-01T09:10:00.000Z" }),
        event({ id: "w1", eventCategory: "webhook", occurredAt: "2026-06-01T09:15:00.000Z" }),
      ],
      "corr-1",
    );
    const grouped = groupByCategory(timeline.entries);
    expect(grouped.request?.map((e) => e.event.id)).toEqual(["r1"]);
    expect(grouped.job?.map((e) => e.event.id)).toEqual(["j1", "j2"]);
    expect(grouped.webhook?.map((e) => e.event.id)).toEqual(["w1"]);
    expect(grouped.anchoring).toBeUndefined();
  });

  it("groups an unrecognized category under unknown rather than dropping it", () => {
    const timeline = buildCorrelationTimeline([event({ eventCategory: "mystery" })], "corr-1");
    const grouped = groupByCategory(timeline.entries);
    expect(grouped.unknown).toHaveLength(1);
  });
});

describe("redactEventActor (reuses the existing redaction mechanism)", () => {
  it("redacts the actor when redact is true", () => {
    const redacted = redactEventActor(event({ actor: "alice@example.com" }), true);
    expect(redacted.actor).toBe("[redacted]");
  });

  it("leaves the actor untouched when redact is false", () => {
    const original = event({ actor: "alice@example.com" });
    expect(redactEventActor(original, false)).toBe(original);
  });

  it("never mutates the input event", () => {
    const original = event({ actor: "alice@example.com" });
    redactEventActor(original, true);
    expect(original.actor).toBe("alice@example.com");
  });
});

describe("formatCorrelationLinkStatus", () => {
  it("has a label for every status", () => {
    expect(formatCorrelationLinkStatus("available")).toEqual(expect.any(String));
    expect(formatCorrelationLinkStatus("missing")).toEqual(expect.any(String));
    expect(formatCorrelationLinkStatus("retention-expired")).toEqual(expect.any(String));
  });
});
