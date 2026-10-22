# Webhook Event Filter Builder - Integration Guide

## Quick Start

### Option 1: Use in Existing Webhook Management Page

The filter builder is available as an optional collapsible section in the new `WebhookFormWithFilter` component.

```typescript
// app/developers/webhooks/page.tsx
import { WebhookFormWithFilter } from "@/components/webhooks/webhook-form-with-filter";

export default function WebhooksPage() {
  return (
    <PublicShell>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PageHeading
          title="Webhook Management"
          description="Create and manage webhook endpoints to receive real-time events about proofs."
        />
        
        {/* Option 1: Use new form with integrated filter builder */}
        <WebhookFormWithFilter
          token={session.token}
          onWebhookCreated={handleWebhookCreated}
        />
        
        {/* ... rest of component ... */}
      </div>
    </PublicShell>
  );
}
```

### Option 2: Use Filter Builder Standalone

For advanced use cases, use the `EventFilterBuilder` directly:

```typescript
import { EventFilterBuilder } from "@/components/webhooks/event-filter-builder";
import type { WebhookEventFilter } from "@/lib/validation/webhook-filters";

export function MyComponent() {
  const [filter, setFilter] = useState<WebhookEventFilter | null>(null);

  const handleSubmit = async () => {
    const response = await createWebhook(token, {
      url: "https://example.com/webhooks",
      events: ["proof.created"],
      filter // Optional
    }, signal);
  };

  return (
    <>
      <EventFilterBuilder
        initialFilter={filter || undefined}
        onFilterChange={setFilter}
        disabled={isSubmitting}
      />
      <button onClick={handleSubmit}>Create Webhook</button>
    </>
  );
}
```

---

## API Integration Points

### Creating a Webhook with Filter

```typescript
import { createWebhook } from "@/lib/api/webhooks";
import type { WebhookEventFilter } from "@/lib/validation/webhook-filters";

const filter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created", "proof.verified"] },
    outcome: { outcomes: ["success"] }
  }
};

const response = await createWebhook(
  token,
  {
    url: "https://example.com/webhooks",
    events: ["proof.created", "proof.verified"], // Legacy compatibility
    filter // New optional filter
  },
  signal
);

console.log(response.webhook.id); // Webhook created with filter
```

### Updating a Webhook with Filter

```typescript
import { updateWebhook } from "@/lib/api/webhooks";
import type { WebhookEventFilter } from "@/lib/validation/webhook-filters";

const newFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.verified"] }
  }
};

const updated = await updateWebhook(
  token,
  webhookId,
  {
    filter: newFilter,
    filterVersion: currentWebhook.filterVersion // For conflict detection
  },
  signal
);
```

### Validating Resource IDs (Server-Side Confirmation)

```typescript
import { validateFilterResources } from "@/lib/api/webhooks";

const resourceIds = ["proof_123", "proof_456"];

const result = await validateFilterResources(
  token,
  resourceIds,
  signal
);

if (!result.valid) {
  console.log("Invalid resource IDs:", result.invalidResourceIds);
  // Example: ["proof_789"] — the others are valid
}
```

### Previewing Filter Matches (Optional Backend Feature)

```typescript
import { previewFilterMatches } from "@/lib/api/webhooks";

const filter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.created"] }
  }
};

const preview = await previewFilterMatches(token, filter, signal);
console.log(preview.matchedEventTypes); // ["proof.created"]
```

---

## Validation Usage

### Validating Filters Programmatically

```typescript
import { validateFilter } from "@/lib/validation/webhook-filters.validation";
import type { WebhookEventFilter } from "@/lib/validation/webhook-filters";

const userFilter = JSON.parse(userInput);

const result = validateFilter(userFilter);
if (!result.ok) {
  result.errors.forEach(error => {
    console.error(`${error.path}: ${error.message}`);
  });
} else {
  console.log("Filter is valid!");
}
```

### Real-Time Field Validation

```typescript
import { validateFieldValue } from "@/lib/validation/webhook-filters.validation";

// User is typing event types
const error = validateFieldValue(
  "predicates.event.allowedEvents",
  ["proof.created", "invalid.event"]
);

if (error) {
  showFieldError("Event types", error);
}
```

### Normalizing Filters

```typescript
import { normalizeFilter, serializeFilter } from "@/lib/validation/webhook-filters.validation";

const userFilter: WebhookEventFilter = {
  version: 1,
  predicates: {
    event: { allowedEvents: ["proof.verified", "proof.created"] },
    outcome: { outcomes: ["success", "success"] } // Duplicate
  }
};

// Normalize: sorts and deduplicates
const normalized = normalizeFilter(userFilter);

// Serialize deterministically (always same output for equivalent input)
const json = serializeFilter(normalized);
console.log(json);
// {"version":1,"predicates":{"event":{"allowedEvents":["proof.created","proof.verified"]},"outcome":{"outcomes":["success"]}}}
```

---

## UI Component Props

### EventFilterBuilder

```typescript
interface EventFilterBuilderProps {
  // Initial filter state (optional)
  initialFilter?: WebhookEventFilter;
  
  // Callback when filter changes
  onFilterChange: (filter: WebhookEventFilter) => void;
  
  // Disable all inputs (while submitting)
  disabled?: boolean;
  
  // Show loading state
  isLoading?: boolean;
}
```

### WebhookFormWithFilter

```typescript
interface WebhookFormWithFilterProps {
  token: string;
  onWebhookCreated: (response: CreateWebhookResponse) => void;
}
```

---

## Error Handling

### Handling Validation Errors

```typescript
import { validateFilter } from "@/lib/validation/webhook-filters.validation";

try {
  const result = validateFilter(userInput);
  
  if (!result.ok) {
    // Display field-level errors
    result.errors.forEach(error => {
      displayFieldError(error.path, error.message);
    });
    return;
  }
  
  // Proceed with valid filter
  await createWebhook(token, { ...request, filter: userInput }, signal);
} catch (err) {
  displayError("Failed to create webhook:", err.message);
}
```

### Handling Boundary Violations

```typescript
import { checkFilterBoundaryViolations } from "@/lib/validation/webhook-filters.validation";

const filter = buildFilterFromUI();
const violation = checkFilterBoundaryViolations(filter);

if (violation) {
  showAlert("warning", violation);
  // Example: "Too many event types (51, max 50)"
  return;
}

// Safe to proceed
await saveWebhook(filter);
```

### Handling Conflict Detection (Stale Filter)

```typescript
try {
  await updateWebhook(token, webhookId, {
    filter: newFilter,
    filterVersion: currentWebhook.filterVersion // Etag-like
  }, signal);
} catch (err) {
  if (err.statusCode === 409) {
    // Conflict: filter changed since load
    showAlert("warning", "Filter has been modified. Please reload and review.");
    const latest = await getWebhook(token, webhookId, signal);
    displayFilterForReview(latest.filter);
  }
}
```

### Handling Resource ID Validation (No Leakage)

```typescript
try {
  const result = await validateFilterResources(token, resourceIds, signal);
  
  if (!result.valid) {
    // Generic error message (doesn't reveal existence)
    showAlert("error", "Some resource IDs are invalid");
    // Only show: ["proof_789"] — others exist and belong to tenant
    // Never show: "proof_123 does not exist" or "proof_456 belongs to different org"
  }
} catch (err) {
  showAlert("error", "Could not validate resources. Please try again.");
}
```

---

## Examples

### Example 1: Create Webhook with Event Filter

```typescript
async function createWebhookWithEventFilter(
  token: string,
  url: string,
  events: string[]
) {
  const filter: WebhookEventFilter = {
    version: 1,
    predicates: {
      event: {
        allowedEvents: events.map(e => e as WebhookEventType)
      }
    }
  };

  return createWebhook(
    token,
    {
      url,
      events,
      filter
    },
    new AbortController().signal
  );
}

// Usage
await createWebhookWithEventFilter(
  token,
  "https://example.com/webhooks",
  ["proof.created", "proof.verified"]
);
```

### Example 2: Create Webhook with Complex Filter

```typescript
async function createWebhookWithComplexFilter(
  token: string,
  url: string
) {
  const filter: WebhookEventFilter = {
    version: 1,
    predicates: {
      event: {
        allowedEvents: ["proof.created", "proof.verified"]
      },
      resource: {
        resourceType: "proof",
        resourceIds: ["proof_important_123"]
      },
      outcome: {
        outcomes: ["success", "failure"]
      },
      version: {
        versions: ["2.0"]
      }
    }
  };

  return createWebhook(
    token,
    {
      url,
      events: ["proof.created", "proof.verified"],
      filter
    },
    new AbortController().signal
  );
}

// Usage: Receives events for proof_important_123 creation/verification with any outcome, version 2.0 only
```

### Example 3: Build Filter Incrementally in UI

```typescript
function WebhookFilterBuilder() {
  const [filter, setFilter] = useState<WebhookEventFilter>({
    version: 1,
    predicates: {}
  });

  const addEventFilter = (events: WebhookEventType[]) => {
    setFilter(prev => ({
      ...prev,
      predicates: {
        ...prev.predicates,
        event: { allowedEvents: events }
      }
    }));
  };

  const addOutcomeFilter = (outcomes: ProofOutcome[]) => {
    setFilter(prev => ({
      ...prev,
      predicates: {
        ...prev.predicates,
        outcome: { outcomes }
      }
    }));
  };

  const handleSave = async () => {
    const result = validateFilter(filter);
    if (!result.ok) {
      result.errors.forEach(err => console.error(`${err.path}: ${err.message}`));
      return;
    }

    const webhook = await createWebhook(token, {
      url: "https://example.com/webhooks",
      events: ["proof.created"],
      filter
    }, signal);
  };

  return (
    <>
      <EventFilterBuilder
        initialFilter={filter}
        onFilterChange={setFilter}
      />
      <button onClick={handleSave}>Save Webhook</button>
    </>
  );
}
```

---

## Testing Integration

### Unit Test Example

```typescript
import { validateFilter } from "@/lib/validation/webhook-filters.validation";

describe("Filter Validation Integration", () => {
  it("accepts valid filter with resource validation", () => {
    const filter: WebhookEventFilter = {
      version: 1,
      predicates: {
        event: { allowedEvents: ["proof.created"] },
        resource: {
          resourceType: "proof",
          resourceIds: ["proof_123"]
        }
      }
    };

    const result = validateFilter(filter);
    expect(result).toEqual({ ok: true });
  });

  it("rejects filter with tenant ID (security)", () => {
    const filter = {
      version: 1,
      predicates: {},
      tenantId: "malicious" // Security issue
    };

    const result = validateFilter(filter);
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("Tenant scope");
  });
});
```

### Component Test Example

```typescript
import { render, screen, userEvent } from "@testing-library/react";
import { EventFilterBuilder } from "@/components/webhooks/event-filter-builder";

describe("EventFilterBuilder Integration", () => {
  it("builds complete filter through UI", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();

    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    // Select event
    await user.click(screen.getByRole("checkbox", { name: /Proof Created/ }));

    // Select outcome
    await user.click(screen.getByRole("checkbox", { name: /Success/ }));

    // Verify callback called with valid filter
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        predicates: expect.objectContaining({
          event: expect.objectContaining({
            allowedEvents: expect.arrayContaining(["proof.created"])
          }),
          outcome: expect.objectContaining({
            outcomes: expect.arrayContaining(["success"])
          })
        })
      })
    );
  });
});
```

---

## Migration Checklist

- [ ] Review filter documentation: `docs/WEBHOOK_FILTERS.md`
- [ ] Import filter components in webhook management page
- [ ] Update webhook creation flow to include filter builder (optional section)
- [ ] Implement backend endpoints:
  - [ ] `POST /webhooks/validate-filter-resources`
  - [ ] `POST /webhooks/preview-filter` (optional)
  - [ ] Update `POST/PATCH /webhooks/{id}` to accept `filter` field
- [ ] Test with various filter combinations
- [ ] Update webhook display to show active filter (if present)
- [ ] Add filter editing capability to webhook management UI (if desired)
- [ ] Update API documentation with filter field
- [ ] Deploy and monitor for issues

---

## Troubleshooting

### Filter Not Saving
1. Check validation errors in console
2. Verify all required enum values are present
3. Confirm resource IDs pass server-side validation
4. Check `filterVersion` if updating (conflict detection)

### Preview Not Updating
1. Verify `previewFilterMatches` endpoint is implemented
2. Check for errors in browser network tab
3. Fall back to showing normalized JSON preview (always works)

### Resource ID Validation Fails
1. Confirm resource IDs belong to current tenant
2. Verify no typos in resource IDs
3. Check that server-side validation is implemented correctly

### TypeScript Errors
1. Ensure you're importing types from `lib/validation/webhook-filters`
2. Use `WebhookEventType`, `ResourceType`, `ProofOutcome` for enum values
3. Import `WebhookEventFilter` for filter type

---

## Performance Notes

- Filter normalization and validation are synchronous and fast (< 1ms for typical filters)
- Real-time validation debounced in UI (optional) to avoid excessive re-renders
- Serialization produces stable JSON (same input always produces same output)
- No network requests until save (validation is local)

---

## Security Reminders

✅ **DO:**
- Validate filters on server before persisting
- Confirm resource IDs belong to authenticated tenant
- Return generic errors (no resource existence leakage)
- Use `filterVersion` for conflict detection

❌ **DON'T:**
- Accept tenant ID from client
- Silently drop unknown fields
- Evaluate filter strings as code
- Store unvalidated user input in filters

---

## Next Steps

1. **Review** this documentation and the filter schema
2. **Implement backend endpoints** for filter persistence and validation
3. **Test** with sample filters and edge cases
4. **Deploy** with feature flag (optional rollout)
5. **Monitor** for issues and feedback
