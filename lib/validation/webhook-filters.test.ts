/**
 * Webhook Event Filter Validation Tests
 *
 * Covers positive/negative/boundary/tenant-scope/authorization/concurrency/normalization cases
 */

import {
  validateFilter,
  validateFieldValue,
  normalizeFilter,
  serializeFilter,
  checkFilterBoundaryViolations,
  generateFilterSummary,
  webhookEventFilterSchema,
} from "./webhook-filters.validation";
import {
  WebhookEventFilter,
  FILTER_LIMITS,
  DEFAULT_FILTER,
  isEmptyFilter,
} from "./webhook-filters";

describe("webhook-filters validation", () => {
  describe("validateFilter", () => {
    it("accepts valid empty filter", () => {
      const result = validateFilter(DEFAULT_FILTER);
      expect(result).toEqual({ ok: true });
    });

    it("accepts valid filter with event predicate", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created"] },
        },
      };
      const result = validateFilter(filter);
      expect(result).toEqual({ ok: true });
    });

    it("accepts valid filter with resource predicate", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          resource: { resourceType: "proof" },
        },
      };
      const result = validateFilter(filter);
      expect(result).toEqual({ ok: true });
    });

    it("accepts valid filter with resource predicate and IDs", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          resource: {
            resourceType: "proof",
            resourceIds: ["proof_123", "proof_456"],
          },
        },
      };
      const result = validateFilter(filter);
      expect(result).toEqual({ ok: true });
    });

    it("accepts valid filter with outcome predicate", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          outcome: { outcomes: ["success", "pending"] },
        },
      };
      const result = validateFilter(filter);
      expect(result).toEqual({ ok: true });
    });

    it("accepts valid filter with version predicate", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions: ["1.0", "2.0"] },
        },
      };
      const result = validateFilter(filter);
      expect(result).toEqual({ ok: true });
    });

    it("accepts valid filter with multiple predicates (AND logic)", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created", "proof.verified"] },
          outcome: { outcomes: ["success"] },
          version: { versions: ["1.0"] },
        },
      };
      const result = validateFilter(filter);
      expect(result).toEqual({ ok: true });
    });

    it("rejects unknown version", () => {
      const filter = { version: 2, predicates: {} } as unknown;
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            path: "version",
            message: expect.stringContaining("expected 1"),
          })
        );
      }
    });

    it("rejects unknown field in root", () => {
      const filter = { version: 1, predicates: {}, unknownField: true };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.path.includes("unknownField"))).toBe(true);
      }
    });

    it("rejects unknown field in predicates", () => {
      const filter = {
        version: 1,
        predicates: { unknownPredicate: {} },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects unknown event type", () => {
      const filter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["invalid.event"] },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes("Invalid enum value"))).toBe(true);
      }
    });

    it("rejects unknown resource type", () => {
      const filter = {
        version: 1,
        predicates: {
          resource: { resourceType: "invalid" },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects unknown outcome", () => {
      const filter = {
        version: 1,
        predicates: {
          outcome: { outcomes: ["invalid_outcome"] },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects empty event predicate", () => {
      const filter = {
        version: 1,
        predicates: {
          event: { allowedEvents: [] },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].message).toContain("at least one");
      }
    });

    it("rejects empty outcome predicate", () => {
      const filter = {
        version: 1,
        predicates: {
          outcome: { outcomes: [] },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate events", () => {
      const filter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created", "proof.created"] },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].message).toContain("Duplicate");
      }
    });

    it("rejects duplicate outcomes", () => {
      const filter = {
        version: 1,
        predicates: {
          outcome: { outcomes: ["success", "success"] },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate resource IDs", () => {
      const filter = {
        version: 1,
        predicates: {
          resource: {
            resourceType: "proof",
            resourceIds: ["proof_123", "proof_123"],
          },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects tenantId in input (security check)", () => {
      const filter = {
        version: 1,
        predicates: {},
        tenantId: "malicious_tenant_id",
      } as unknown;
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].message).toContain("Tenant scope is managed by the server");
      }
    });

    it("rejects organizationId in input (security check)", () => {
      const filter = {
        version: 1,
        predicates: {},
        organizationId: "malicious_org_id",
      } as unknown;
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
    });

    it("rejects filter exceeding serialized size limit", () => {
      // Create a filter with many long values to exceed the limit
      const versions = Array(300)
        .fill(0)
        .map((_, i) => `version_${"x".repeat(50)}_${i}`);
      const filter = {
        version: 1,
        predicates: {
          version: { versions },
        },
      };
      const result = validateFilter(filter);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes("too large"))).toBe(true);
      }
    });
  });

  describe("validateFieldValue", () => {
    it("validates event types in real-time", () => {
      const error = validateFieldValue("predicates.event.allowedEvents", ["proof.created"]);
      expect(error).toBeNull();
    });

    it("rejects invalid event type", () => {
      const error = validateFieldValue("predicates.event.allowedEvents", ["invalid.event"]);
      expect(error).not.toBeNull();
    });

    it("rejects empty event array", () => {
      const error = validateFieldValue("predicates.event.allowedEvents", []);
      expect(error).not.toBeNull();
    });

    it("validates resource type", () => {
      const error = validateFieldValue("predicates.resource.resourceType", "proof");
      expect(error).toBeNull();
    });

    it("rejects invalid resource type", () => {
      const error = validateFieldValue("predicates.resource.resourceType", "invalid");
      expect(error).not.toBeNull();
    });

    it("validates resource IDs", () => {
      const error = validateFieldValue("predicates.resource.resourceIds", [
        "proof_123",
        "proof_456",
      ]);
      expect(error).toBeNull();
    });

    it("validates outcome", () => {
      const error = validateFieldValue("predicates.outcome.outcomes", ["success", "failure"]);
      expect(error).toBeNull();
    });

    it("validates version", () => {
      const error = validateFieldValue("predicates.version.versions", ["1.0", "2.0"]);
      expect(error).toBeNull();
    });

    it("rejects version with invalid characters", () => {
      const error = validateFieldValue("predicates.version.versions", ["1.0<script>"]);
      expect(error).not.toBeNull();
    });

    it("rejects resource ID with invalid characters", () => {
      const error = validateFieldValue("predicates.resource.resourceIds", ["proof<script>"]);
      expect(error).not.toBeNull();
    });
  });

  describe("normalizeFilter", () => {
    it("sorts event types", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.verified", "proof.created", "proof.revoked"] },
        },
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates.event?.allowedEvents).toEqual([
        "proof.created",
        "proof.revoked",
        "proof.verified",
      ]);
    });

    it("deduplicates event types", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created", "proof.created"] },
        },
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates.event?.allowedEvents).toEqual(["proof.created"]);
    });

    it("sorts and deduplicates resource IDs", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          resource: {
            resourceType: "proof",
            resourceIds: ["proof_999", "proof_123", "proof_999"],
          },
        },
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates.resource?.resourceIds).toEqual([
        "proof_123",
        "proof_999",
      ]);
    });

    it("sorts and deduplicates outcomes", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          outcome: { outcomes: ["success", "failure", "success"] },
        },
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates.outcome?.outcomes).toEqual(["failure", "success"]);
    });

    it("sorts and deduplicates versions", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions: ["2.0", "1.0", "2.0"] },
        },
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates.version?.versions).toEqual(["1.0", "2.0"]);
    });

    it("preserves empty predicates", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {},
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates).toEqual({});
    });

    it("normalizes complex filter", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.verified", "proof.created"] },
          outcome: { outcomes: ["failure", "success"] },
          version: { versions: ["2.0", "1.0"] },
        },
      };
      const normalized = normalizeFilter(filter);
      expect(normalized.predicates.event?.allowedEvents).toEqual([
        "proof.created",
        "proof.verified",
      ]);
      expect(normalized.predicates.outcome?.outcomes).toEqual(["failure", "success"]);
      expect(normalized.predicates.version?.versions).toEqual(["1.0", "2.0"]);
    });
  });

  describe("serializeFilter", () => {
    it("serializes to deterministic JSON", () => {
      const filter1: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created", "proof.verified"] },
          outcome: { outcomes: ["success"] },
        },
      };

      const filter2: WebhookEventFilter = {
        version: 1,
        predicates: {
          outcome: { outcomes: ["success"] },
          event: { allowedEvents: ["proof.verified", "proof.created"] },
        },
      };

      // Different order of predicates, but should serialize identically
      expect(serializeFilter(filter1)).toBe(serializeFilter(filter2));
    });

    it("produces valid JSON", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created"] },
        },
      };
      const serialized = serializeFilter(filter);
      const parsed = JSON.parse(serialized);
      expect(parsed).toEqual(expect.objectContaining({ version: 1 }));
    });

    it("normalizes before serializing", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.verified", "proof.created"] },
        },
      };
      const serialized = serializeFilter(filter);
      const parsed = JSON.parse(serialized);
      // Should be normalized (sorted)
      expect(parsed.predicates.event.allowedEvents[0]).toBe("proof.created");
    });
  });

  describe("checkFilterBoundaryViolations", () => {
    it("accepts filter at limit", () => {
      const versions = Array(FILTER_LIMITS.MAX_VALUES_PER_PREDICATE)
        .fill(0)
        .map((_, i) => `v${i}`);
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions },
        },
      };
      const violation = checkFilterBoundaryViolations(filter);
      expect(violation).toBeNull();
    });

    it("rejects filter exceeding max values per predicate", () => {
      const versions = Array(FILTER_LIMITS.MAX_VALUES_PER_PREDICATE + 1)
        .fill(0)
        .map((_, i) => `v${i}`);
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions },
        },
      };
      const violation = checkFilterBoundaryViolations(filter);
      expect(violation).not.toBeNull();
      expect(violation).toContain("Too many versions");
    });

    it("rejects value exceeding max length", () => {
      const longValue = "x".repeat(FILTER_LIMITS.MAX_VALUE_LENGTH + 1);
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions: [longValue] },
        },
      };
      const violation = checkFilterBoundaryViolations(filter);
      expect(violation).not.toBeNull();
      expect(violation).toContain("too long");
    });

    it("rejects filter exceeding serialized size limit", () => {
      // Create a large but technically valid filter
      const versions = Array(100)
        .fill(0)
        .map((_, i) => `version_${"x".repeat(100)}_${i}`);
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions },
        },
      };
      const violation = checkFilterBoundaryViolations(filter);
      expect(violation).not.toBeNull();
      expect(violation).toContain("too large");
    });

    it("accepts multiple predicates at limit", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created"] },
          resource: { resourceType: "proof" },
          outcome: { outcomes: ["success"] },
          version: { versions: ["1.0"] },
        },
      };
      const violation = checkFilterBoundaryViolations(filter);
      expect(violation).toBeNull();
    });
  });

  describe("generateFilterSummary", () => {
    it("generates summary for empty filter", () => {
      const summary = generateFilterSummary(DEFAULT_FILTER);
      expect(summary).toBe("No filter (all events for this tenant)");
    });

    it("generates summary for event predicate", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created"] },
        },
      };
      const summary = generateFilterSummary(filter);
      expect(summary).toContain("proof.created");
    });

    it("generates summary for multiple events", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created", "proof.verified"] },
        },
      };
      const summary = generateFilterSummary(filter);
      expect(summary).toContain("or");
    });

    it("generates summary for outcome predicate", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          outcome: { outcomes: ["success"] },
        },
      };
      const summary = generateFilterSummary(filter);
      expect(summary).toContain("success");
    });

    it("generates summary for complex filter", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created", "proof.verified"] },
          outcome: { outcomes: ["success"] },
        },
      };
      const summary = generateFilterSummary(filter);
      expect(summary).toContain("proof.created");
      expect(summary).toContain("success");
    });
  });

  describe("isEmptyFilter", () => {
    it("returns true for empty filter", () => {
      expect(isEmptyFilter(DEFAULT_FILTER)).toBe(true);
    });

    it("returns false for filter with predicates", () => {
      const filter: WebhookEventFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created"] },
        },
      };
      expect(isEmptyFilter(filter)).toBe(false);
    });
  });

  describe("Zod schema strict mode", () => {
    it("rejects unknown fields in event predicate", () => {
      const predicate = {
        allowedEvents: ["proof.created"],
        unknownField: true,
      };
      const result = webhookEventFilterSchema.safeParse({
        version: 1,
        predicates: {
          event: predicate,
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown fields in predicates object", () => {
      const result = webhookEventFilterSchema.safeParse({
        version: 1,
        predicates: {
          event: { allowedEvents: ["proof.created"] },
          unknownPredicate: {},
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
