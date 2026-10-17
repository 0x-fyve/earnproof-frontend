# Schema Import Validation and Dry-Run

**GitHub Issue:** #280  
**Route:** `/settings/schemas`

This document describes the schema metadata and policy mapping import validation feature and its dry-run UI.

---

## Overview

Org administrators can validate schema metadata and policy mappings before importing them. The flow has three phases:

```
input → preview → dry-run-results
```

1. **Input** — Upload a JSON file or paste JSON directly. Local validation (size, count, field types, unknown fields) runs before any network request.
2. **Preview** — The canonical (normalized) form is displayed alongside any detected conflicts with the org's existing schemas and mappings.
3. **Dry-run results** — The server evaluates what would be created, updated, skipped, or rejected, without mutating any state.

**There is no "commit" or "import" button on this page.** The actual import commit flow is out of scope for this feature and, if added in the future, must be gated by a passing dry run.

---

## Limits (named constants)

All limits are defined in `lib/validation/schema-import.ts` as exported constants. They follow exact-boundary semantics: **at-limit is accepted, limit+1 is rejected**.

| Constant | Value | Description |
|---|---|---|
| `MAX_SCHEMA_IMPORT_BYTES` | 262 144 (256 KB) | Maximum raw payload size (file or paste) |
| `MAX_SCHEMAS_PER_IMPORT` | 100 | Maximum schema metadata objects per import |
| `MAX_POLICY_MAPPINGS_PER_IMPORT` | 500 | Maximum policy mapping objects per import |
| `SCHEMA_ID_MAX_LENGTH` | 128 | Maximum characters in a schema `id` |
| `SCHEMA_VERSION_MAX_LENGTH` | 64 | Maximum characters in a schema `version` |
| `SCHEMA_NAME_MAX_LENGTH` | 200 | Maximum characters in a schema `name` |
| `SCHEMA_DESCRIPTION_MAX_LENGTH` | 2 000 | Maximum characters in a schema `description` |
| `MAPPING_KEY_MAX_LENGTH` | 256 | Maximum characters in a mapping key |
| `POLICY_REF_MAX_LENGTH` | 512 | Maximum characters in a policy reference |

Both the local validation layer and the UI copy read these constants directly, so there is a single source of truth for every limit.

---

## Schema format

The import payload is a JSON object with two optional arrays:

```jsonc
{
  "schemas": [                       // Optional. Max 100 entries.
    {
      "id": "income-verification.v1",  // required, lowercase alphanumeric + hyphens/dots/underscores
      "version": "1.0.0",              // required, semver (major.minor.patch)
      "name": "Income Verification Schema", // required, max 200 chars
      "description": "...",            // optional, max 2 000 chars
      "authoredAt": "2026-01-15T10:00:00.000Z", // optional, ISO-8601
      "metadata": { "key": "value" }   // optional, max 20 string→string entries
    }
  ],
  "policyMappings": [                // Optional. Max 500 entries.
    {
      "schemaId": "income-verification.v1",  // required
      "schemaVersion": "1.0.0",              // required, semver
      "mappingKey": "minimum-income",        // required
      "policyRef": "policy://org/path/..."   // required
    }
  ]
}
```

**Strict validation:** Both `schemas[*]` and `policyMappings[*]` use Zod's `.strict()`, so any unknown field causes a parse failure. This prevents silent drift when the import file was generated against a different schema version.

---

## Validation flow

```
raw input (file or paste)
      │
      ▼
  local gate (checkSchemaImportFile / checkSchemaImportPaste)
      │  ● size ≤ MAX_SCHEMA_IMPORT_BYTES
      │  ● extension = .json
      │  ● MIME type on allowlist
      │  ● non-empty
      ▼
  JSON.parse
      │  ● must be valid JSON
      ▼
  Zod strict validation (schemaImportPayloadSchema.safeParse)
      │  ● count ≤ MAX_*_PER_IMPORT
      │  ● required fields present
      │  ● id regex, version semver
      │  ● no unknown fields
      ▼
  normalizeImportPayload
      │  ● deduplicate by (id, version) — later entries dropped
      │  ● deduplicate mappings by (schemaId, schemaVersion, mappingKey)
      │  ● name/description trimmed
      ▼
  canonical payload → preview phase
```

---

## Conflict detection

`detectImportConflicts(payload, existingRegistry)` is a pure function that returns a `ConflictReport` with two categories:

| Kind | Trigger |
|---|---|
| `same-id-version` | Incoming schema has the same (id, version) as an existing schema |
| `same-id-different-version` | Incoming schema has the same id but a different version than an existing schema |
| `duplicate-mapping` | Same (schemaId, schemaVersion, mappingKey) already mapped to the same policyRef |
| `overlapping-mapping` | Same (schemaId, schemaVersion, mappingKey) already mapped to a **different** policyRef |

Conflicts do not block the dry run — they are surfaced as informational/warnings so the operator understands what the server's evaluation will encounter.

---

## Dry-run contract

### Request

```
POST /organizations/{organizationId}/schemas/dry-run
X-Dry-Run: true
Authorization: Bearer {token}
Content-Type: application/json

{ "schemas": [...], "policyMappings": [...] }
```

The `X-Dry-Run: true` header signals the server that this is a preview-only evaluation. **The server MUST NOT mutate any state on this path.**

### Response

```jsonc
{
  "schemas": [
    {
      "action": "create" | "update" | "skip" | "reject",
      "schema": { ... },
      "existingVersion": "0.9.0",  // populated for "update" action
      "rejectReason": "..."         // populated for "reject" action
    }
  ],
  "policyMappings": [
    {
      "action": "create" | "update" | "skip" | "reject",
      "mapping": { ... },
      "existingPolicyRef": "...",   // populated for overlapping update
      "rejectReason": "..."
    }
  ],
  "etag": "etag-abc123",            // org schema-registry state at evaluation time
  "generatedAt": "2026-01-15T10:01:00.000Z"
}
```

### Determinism / replay

Identical payloads submitted against the same org state MUST produce identical dry-run results with no side effects. The UI verifies this in the replay regression test.

---

## Stale-state detection

The org's current schema registry state is fetched (GET) when the user confirms the input and enters the preview phase. The response includes an `etag`.

The server's dry-run response also includes an `etag` representing the org state at the time it was evaluated. If the two etags differ, the UI shows a stale-state warning:

> "Organization state changed since preview was loaded."

The user can then re-run the dry run or revise their input.

---

## Authorization

| HTTP status | UI behavior |
|---|---|
| 401 | Shows "Access denied — You are not authenticated." |
| 403 | Shows "Access denied — You do not have permission." |
| Both | Dry-run results panel is never shown; no data is leaked |

---

## Security

- **No write from dry-run path.** `lib/api/schema-import.ts` exposes only `runSchemaDryRun` (POST with `X-Dry-Run: true`), `getExistingSchemas` (GET), and `getExistingPolicyMappings` (GET). There is no commit/import endpoint in this module.
- **No untrusted HTML rendering.** Schema names, descriptions, ids, and error messages are rendered as text content, never as `dangerouslySetInnerHTML`.
- **No secrets.** No credentials, private keys, or production tokens appear in source code, fixtures, UI, or logs.
- **MIME + extension gating.** Files are screened for extension and MIME type before `FileReader` or `JSON.parse` is invoked.

---

## Accessibility

- All inputs are labeled (`<label htmlFor>` association).
- Errors use `role="alert"` and `aria-live="polite"` / `"assertive"`.
- Stale-state warning uses `role="alert"` with `aria-live="assertive"`.
- Dry-run results availability is announced via `aria-live="polite"`.
- Mode selector uses `role="tablist"` / `role="tab"` / `aria-selected`.
- Loading states are announced via `aria-live="polite"`.
- Focus moves to the error summary after validation failure (via `setTimeout(() => ref.focus(), 0)`).
- Phase transitions (input → preview → results) move focus to the new region heading.
- Action badges include text labels (not color-only indicators).

---

## Files changed

| File | Type | Description |
|---|---|---|
| `lib/validation/schema-import.ts` | New | Zod schemas, named limits, validation helpers, conflict detection, dry-run types |
| `lib/api/schema-import.ts` | New | API client — read and dry-run only, no commit endpoint |
| `data/fixtures/schema-import.ts` | New | Synthetic test fixtures |
| `components/schemas/schema-import-form.tsx` | New | Input phase UI (file upload + paste) |
| `components/schemas/schema-preview-panel.tsx` | New | Preview phase UI (normalized form + conflicts) |
| `components/schemas/dry-run-results-panel.tsx` | New | Dry-run results UI |
| `components/schemas/schema-import-container.tsx` | New | Phase orchestrator |
| `components/schemas/__tests__/schema-import-container.test.tsx` | New | Integration tests (Jest/RTL) |
| `lib/validation/schema-import.test.ts` | New | Unit tests for pure validation functions |
| `app/settings/schemas/page.tsx` | New | Route `/settings/schemas` |
| `components/settings/settings-navigation.tsx` | Modified | Added "Schema Import" link |
| `docs/schema-import.md` | New | This document |

---

## Migration / compatibility

**No migrations or compatibility shims are required.**

This is a net-new feature with no existing UI, API, or data to migrate. The dry-run API endpoints (`POST /organizations/{id}/schemas/dry-run`, `GET /organizations/{id}/schemas`, `GET /organizations/{id}/schemas/policy-mappings`) must be implemented on the backend, but they do not replace or modify any existing endpoints.

The `X-Dry-Run: true` request header is a new, additive contract. Existing callers of any `/schemas/*` endpoints (if any exist) are unaffected because they do not send this header.

---

## Tests

Run the focused test suite:

```bash
# Unit tests (pure validation functions)
npm test -- lib/validation/schema-import.test.ts

# Integration tests (component + API mocks)
npm test -- components/schemas/__tests__/schema-import-container.test.tsx

# Full suite
npm test

# Lint
npm run lint

# Build
npm run build
```

Test coverage categories:

| Category | File |
|---|---|
| Positive (valid input → preview → dry run) | both test files |
| Negative (malformed JSON, schema violations, unknown fields, oversized) | both test files |
| Authorization (401, 403) | container test |
| Concurrency/stale-state | container test + validation unit test |
| Replay determinism | both test files |
| Boundary (at-limit accepted, limit+1 rejected) | both test files |
| Regression (dry run = no mutation) | container test |
| Conflict detection | both test files |
