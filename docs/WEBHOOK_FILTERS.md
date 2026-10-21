# Webhook Event Subscription Filters

## Overview

The webhook event subscription filter builder enables integrators to define precise conditions for receiving webhook events without writing free-form expressions. Filters are deterministic, tenant-scoped, and strictly validated.

## Filter Schema

### Structure

A webhook event filter consists of four optional predicate kinds, combined with:
- **AND logic across kinds** (all present predicates must match)
- **OR logic within each kind's values** (any value in a predicate matches)

```typescript
type WebhookEventFilter = {
  version: 1;
  predicates: {
    event?: EventPredicate;      // Event type filtering
    resource?: ResourcePredicate; // Resource type and optional resource IDs
    outcome?: OutcomePredicate;   // Proof outcome (success/failure/pending)
    version?: VersionPredicate;   // API/schema version
  };
};
```

### Predicate Kinds

#### Event Predicate
Filter by event type. At least one event type is required.

```typescript
type EventPredicate = {
  allowedEvents: WebhookEventType[]; // "proof.created" | "proof.verified" | "proof.revoked"
};
```

**Supported Event Types:**
- `proof.created`: Fired when a new income or payment proof is created
- `proof.verified`: Fired when a proof passes verification and is confirmed
- `proof.revoked`: Fired when a proof is revoked and becomes invalid

**Example:** Events are `["proof.created", "proof.verified"]` → matches either event type

#### Resource Predicate
Filter by resource type and optionally by specific resource IDs. Resource IDs are tenant-scoped and validated server-side.

```typescript
type ResourcePredicate = {
  resourceType: ResourceType; // "proof" | "organization"
  resourceIds?: string[];     // Optional specific resource IDs
};
```

**Supported Resource Types:**
- `proof`: Filter by specific proofs
- `organization`: Filter by specific organizations

**Example:** Resource type is `"proof"` with no IDs → matches any proof; with IDs `["proof_123", "proof_456"]` → matches only those specific proofs

#### Outcome Predicate
Filter by proof verification outcome. At least one outcome is required.

```typescript
type OutcomePredicate = {
  outcomes: ProofOutcome[]; // "success" | "failure" | "pending"
};
```

**Supported Outcomes:**
- `success`: Proof passed verification
- `failure`: Proof failed verification
- `pending`: Proof is being processed

**Example:** Outcomes are `["success"]` → matches only successful proofs

#### Version Predicate
Filter by API or event schema version. At least one version is required.

```typescript
type VersionPredicate = {
  versions: string[]; // Semver-like versions: "1.0", "2.0", etc.
};
```

**Example:** Versions are `["1.0", "2.0"]` → matches events from either version

### Filter Limits (Named Constants)

All limits are enforced locally and ready for server-side confirmation:

| Limit | Value | Description |
|-------|-------|-------------|
| `MAX_PREDICATES` | 4 | Maximum number of predicate kinds |
| `MAX_VALUES_PER_PREDICATE` | 50 | Maximum values per predicate (e.g., events, outcomes, versions, resource IDs) |
| `MAX_VALUE_LENGTH` | 256 | Maximum string length per value (e.g., resource ID, version string) |
| `MAX_SERIALIZED_SIZE` | 10,000 bytes | Maximum serialized JSON size |

Boundaries are enforced as:
- **At-limit accepted:** Exactly 50 values → ✓ valid
- **Over-limit rejected:** 51 values → ✗ invalid

## Normalization

Filters are canonicalized for deterministic serialization and comparison:

1. **Sort values** within each predicate (lexicographic order)
2. **Deduplicate** values
3. **Stable key order** (alphabetical)

### Example

**Input:**
```json
{
  "version": 1,
  "predicates": {
    "outcome": { "outcomes": ["failure", "success", "success"] },
    "event": { "allowedEvents": ["proof.revoked", "proof.created"] }
  }
}
```

**Normalized output:**
```json
{
  "version": 1,
  "predicates": {
    "event": { "allowedEvents": ["proof.created", "proof.revoked"] },
    "outcome": { "outcomes": ["failure", "success"] }
  }
}
```

## API Integration

### Creating a Webhook with Filter

```typescript
const response = await createWebhook(token, {
  url: "https://example.com/webhooks",
  events: ["proof.created"],  // Legacy: still supported
  filter: {                    // New: optional, overrides events
    version: 1,
    predicates: {
      event: { allowedEvents: ["proof.created", "proof.verified"] },
      outcome: { outcomes: ["success"] }
    }
  }
}, signal);
```

### Webhook Response with Filter

```typescript
type Webhook = {
  id: string;
  url: string;
  events: string[];           // For compatibility
  filter?: WebhookEventFilter;
  filterVersion?: string;     // Etag for conflict detection
  status: "ACTIVE" | "DISABLED";
};
```

### Validating Resource IDs

Resource IDs are tenant-scoped. To validate resource IDs belong to the current tenant:

```typescript
const response = await validateFilterResources(token, resourceIds, signal);
// Returns: { valid: boolean; invalidResourceIds?: string[] }
```

The backend **never reveals existence** of resources; it only returns a list of invalid IDs without specifying whether they don't exist or are unauthorized.

## Backward Compatibility

### Default Behavior

**No filter** = all events for the tenant (labeled "All Events" in UI)

```typescript
const emptyFilter: WebhookEventFilter = {
  version: 1,
  predicates: {}
};
// Receives: all events for this tenant
```

### Mutual Exclusivity

The `filter` and `events` fields are mutually exclusive:
- If `filter` is present and valid, it takes precedence
- Legacy subscriptions without `filter` continue to work (receive all events)
- New subscriptions should use `filter` for fine-grained control

### Migration Path

To migrate from `events: ["proof.created"]` to filter:

```typescript
// Old (legacy)
{
  url: "https://example.com/webhooks",
  events: ["proof.created"]
}

// New (with filter)
{
  url: "https://example.com/webhooks",
  events: ["proof.created"], // Keep for compatibility
  filter: {
    version: 1,
    predicates: {
      event: { allowedEvents: ["proof.created"] }
    }
  }
}
```

## Security Principles

### Tenant Scope

- **Never accept tenant ID from user input:** All tenant context comes from the authenticated session
- **Resource IDs are tenant-scoped:** Server validates each resource ID belongs to the current tenant before saving
- **No data leakage:** Cross-tenant resource IDs are rejected with generic error messages

### Validation

- **Unknown fields rejected:** Any field, operator, or value not in the allowlist is rejected with a specific error (not silently dropped)
- **No code evaluation:** Filters are strictly typed/validated data; no `eval()`, `new Function()`, or dynamic code execution
- **No secrets in filters:** Filters never contain API keys, wallet material, or production credentials

### Conflict Detection

The optional `filterVersion` field enables conflict detection (similar to ETags):

```typescript
// When updating a webhook with a stale filterVersion:
// → "Filter has been modified since load. Please reload and review."
// → Forces refresh before save (prevents silent overwrites)
```

## UI Component: EventFilterBuilder

### Props

```typescript
type EventFilterBuilderProps = {
  initialFilter?: WebhookEventFilter;
  onFilterChange: (filter: WebhookEventFilter) => void;
  disabled?: boolean;
  isLoading?: boolean;
};
```

### Features

- **Event predicate builder:** Checkboxes for each event type with descriptions
- **Resource predicate builder:** Dropdown for resource type + textarea for comma-separated IDs
- **Outcome predicate builder:** Checkboxes for success/failure/pending
- **Version predicate builder:** Textarea for comma-separated versions
- **Preview section:** Tabbed view
  - **Summary tab:** Human-readable description (e.g., "proof.created or proof.verified events with success outcome")
  - **JSON tab:** Normalized JSON filter (syntax-highlighted)
- **Real-time validation:** Field-level errors displayed inline
- **Boundary warnings:** Alert when approaching max values (e.g., "49/50 events")
- **Accessibility:** ARIA labels, keyboard navigation, focus management, live regions

### Example Usage

```typescript
import { EventFilterBuilder } from "@/components/webhooks/event-filter-builder";

export function MyComponent() {
  const [filter, setFilter] = useState<WebhookEventFilter | null>(null);

  return (
    <EventFilterBuilder
      initialFilter={filter || undefined}
      onFilterChange={setFilter}
      disabled={isSubmitting}
    />
  );
}
```

## Validation

### Client-Side Validation

All validation occurs through Zod schemas with strict mode:

```typescript
import { validateFilter, validateFieldValue } from "@/lib/validation/webhook-filters.validation";

// Validate entire filter
const result = validateFilter(userInput);
if (!result.ok) {
  console.error("Validation errors:", result.errors);
  // errors: FieldError[] = [{ path: "predicates.event.allowedEvents", message: "..." }]
}

// Real-time field validation
const error = validateFieldValue("predicates.event.allowedEvents", ["proof.created"]);
if (error) {
  console.error("Field error:", error);
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| Event types | Must be in `WEBHOOK_EVENT_TYPES` enum |
| Resource type | Must be in `WEBHOOK_RESOURCE_TYPES` enum |
| Resource IDs | Must be 1-256 chars, alphanumeric + `_-` (no spaces or special chars) |
| Outcomes | Must be in `WEBHOOK_OUTCOMES` enum |
| Versions | Must be 1-256 chars, alphanumeric + `.`, `-`, `_` |
| Empty predicates | Rejected (at least one value required) |
| Duplicate values | Deduplicated automatically (no error) |
| Tenant ID | Rejected with security error if present in input |

### Error Messages

| Scenario | Message |
|----------|---------|
| Unknown event type | `"Event type 'invalid.event' is not supported. Allowed: proof.created, proof.verified, proof.revoked"` |
| Empty event predicate | `"Event predicate must have at least one event type"` |
| Max values exceeded | `"Maximum 50 event types allowed (you have 51)"` |
| Tenant ID in input | `"Tenant scope is managed by the server. Do not include tenantId or organizationId in the filter."` |
| Invalid characters in resource ID | `"Resource ID contains invalid characters"` |

## Testing

### Test Coverage

- **Positive:** Build filter with each predicate kind, preview matches saved JSON, save succeeds
- **Negative:** Unsupported field, unknown event/outcome/version, empty predicate
- **Unbounded:** At-limit (50 values) accepted, limit+1 (51 values) rejected
- **Tenant scope:** Tenant ID in input rejected, cross-tenant resource ID rejected with no leakage
- **Authorization:** Unauthorized users denied with clear message
- **Concurrency:** Filter changed between load/save forces refresh (filterVersion check)
- **Replay:** Repeated identical save is deterministic, no duplicate effects
- **Boundary:** Exactly at and just over each limit
- **Normalization:** Equivalent filters produce identical serialized JSON
- **Regression:** No code paths evaluate strings as code; unknown fields never silently accepted

### Example Test

```typescript
it("normalizes and serializes filter deterministically", () => {
  const filter1: WebhookEventFilter = {
    version: 1,
    predicates: {
      event: { allowedEvents: ["proof.created", "proof.verified"] },
      outcome: { outcomes: ["success"] }
    }
  };

  const filter2: WebhookEventFilter = {
    version: 1,
    predicates: {
      outcome: { outcomes: ["success"] },
      event: { allowedEvents: ["proof.verified", "proof.created"] }
    }
  };

  // Different order of predicates and values, but should serialize identically
  expect(serializeFilter(filter1)).toBe(serializeFilter(filter2));
});
```

## Implementation Notes

### Files Modified/Created

| File | Purpose |
|------|---------|
| `lib/validation/webhook-filters.ts` | Types, enums, constants |
| `lib/validation/webhook-filters.validation.ts` | Zod schemas, validators, normalizers |
| `lib/validation/webhook-filters.test.ts` | Jest tests for validation logic |
| `lib/validation/__fixtures__/webhook-filters.fixtures.ts` | Synthetic test fixtures |
| `components/webhooks/event-filter-builder.tsx` | Main UI component |
| `components/webhooks/event-filter-builder.test.tsx` | RTL tests for UI component |
| `components/webhooks/webhook-form-with-filter.tsx` | Integration with webhook form |
| `lib/api/webhooks.ts` | Updated types + new API methods |

### Key Design Decisions

1. **Strict Zod validation:** Uses `.strict()` to reject unknown fields (not silently drop)
2. **Named limits:** Hardcoded in `FILTER_LIMITS` constant for easy adjustment and documentation
3. **Deterministic normalization:** Enables replay/conflict detection
4. **No code evaluation:** Filters are pure data; validated by schema, never executed
5. **Tenant-scoped security:** Resource validation deferred to server; frontend never accepts tenant ID

## FAQ

### Can I use wildcards or "match everything"?

No. Filters are structured data with explicit values. To match all events, use an empty filter (no predicates).

### What if I paste invalid JSON into the filter builder?

The filter builder provides a structured UI that produces valid JSON. However, if you import/paste a JSON filter:
- Unknown fields are rejected with a specific error
- Unknown event types are rejected
- Empty predicates are rejected
- Duplicate values are automatically deduplicated

### How does tenant scope work?

Your authenticated session determines the tenant. Resource IDs in filters are validated server-side to confirm they belong to your tenant. The server never reveals whether a resource exists elsewhere; it only returns "invalid" for resources not belonging to your tenant.

### Can I update a filter after creating a webhook?

Yes, use the `updateWebhook()` API with a new `filter` in the request. If the filter has changed server-side (detected via `filterVersion`), the update will be rejected with a conflict error, and you'll need to reload and review before retrying.

### What happens to old webhooks without filters?

They continue to work as before, receiving all events for your tenant. The `filter` field is optional and defaults to `null`.
