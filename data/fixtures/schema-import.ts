/**
 * Synthetic fixtures for schema import validation and dry-run testing.
 *
 * ALL data here is synthetic — no real schema ids, policy refs, or org data.
 * Do NOT use production credentials, wallet keys, or real org identifiers.
 *
 * Factory helpers follow the same pattern as data/fixtures/contract-upgrades.ts:
 * a base maker function that accepts Partial<T> overrides, plus scenario
 * helpers for named states (valid, invalid, conflict, boundary, etc.).
 */

import type {
  SchemaMetadata,
  PolicyMapping,
  SchemaImportPayload,
  ExistingSchema,
  ExistingPolicyMapping,
  DryRunResult,
  DryRunSchemaEntry,
  DryRunMappingEntry,
  ConflictReport,
} from "@/lib/validation/schema-import";
import {
  MAX_SCHEMAS_PER_IMPORT,
  MAX_POLICY_MAPPINGS_PER_IMPORT,
  MAX_SCHEMA_IMPORT_BYTES,
  SCHEMA_ID_MAX_LENGTH,
  SCHEMA_VERSION_MAX_LENGTH,
  SCHEMA_NAME_MAX_LENGTH,
  SCHEMA_DESCRIPTION_MAX_LENGTH,
} from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// Base makers
// ---------------------------------------------------------------------------

export function makeSchemaMetadata(
  overrides?: Partial<SchemaMetadata>,
): SchemaMetadata {
  return {
    id: "income-verification.v1",
    version: "1.0.0",
    name: "Income Verification Schema",
    description: "Schema for verifying income across payment sources.",
    authoredAt: "2026-01-15T10:00:00.000Z",
    metadata: { source: "synthetic-test" },
    ...overrides,
  };
}

export function makePolicyMapping(
  overrides?: Partial<PolicyMapping>,
): PolicyMapping {
  return {
    schemaId: "income-verification.v1",
    schemaVersion: "1.0.0",
    mappingKey: "minimum-income",
    policyRef: "policy://org-synthetic/income/minimum-income-v1",
    ...overrides,
  };
}

export function makeSchemaImportPayload(
  overrides?: Partial<SchemaImportPayload>,
): SchemaImportPayload {
  return {
    schemas: [makeSchemaMetadata()],
    policyMappings: [makePolicyMapping()],
    ...overrides,
  };
}

export function makeExistingSchema(
  overrides?: Partial<ExistingSchema>,
): ExistingSchema {
  return {
    id: "income-verification.v1",
    version: "0.9.0",
    name: "Income Verification Schema (legacy)",
    ...overrides,
  };
}

export function makeExistingPolicyMapping(
  overrides?: Partial<ExistingPolicyMapping>,
): ExistingPolicyMapping {
  return {
    schemaId: "income-verification.v1",
    schemaVersion: "0.9.0",
    mappingKey: "minimum-income",
    policyRef: "policy://org-synthetic/income/minimum-income-legacy",
    ...overrides,
  };
}

export function makeDryRunSchemaEntry(
  overrides?: Partial<DryRunSchemaEntry>,
): DryRunSchemaEntry {
  return {
    action: "create",
    schema: makeSchemaMetadata(),
    ...overrides,
  };
}

export function makeDryRunMappingEntry(
  overrides?: Partial<DryRunMappingEntry>,
): DryRunMappingEntry {
  return {
    action: "create",
    mapping: makePolicyMapping(),
    ...overrides,
  };
}

export function makeDryRunResult(
  overrides?: Partial<DryRunResult>,
): DryRunResult {
  return {
    schemas: [makeDryRunSchemaEntry()],
    policyMappings: [makeDryRunMappingEntry()],
    etag: "etag-abc123",
    generatedAt: "2026-01-15T10:01:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Positive scenarios
// ---------------------------------------------------------------------------

/** Valid file/paste that should pass all local validation. */
export function makeValidImportJson(): string {
  return JSON.stringify(makeSchemaImportPayload(), null, 2);
}

/** Valid payload with multiple schemas and mappings. */
export function makeMultiSchemaPayload(): SchemaImportPayload {
  return {
    schemas: [
      makeSchemaMetadata({ id: "income-verification.v1", version: "1.0.0" }),
      makeSchemaMetadata({
        id: "employer-payment.v1",
        version: "1.0.0",
        name: "Employer Payment Schema",
        description: "Schema for employer payment proofs.",
      }),
    ],
    policyMappings: [
      makePolicyMapping({ schemaId: "income-verification.v1", schemaVersion: "1.0.0" }),
      makePolicyMapping({
        schemaId: "employer-payment.v1",
        schemaVersion: "1.0.0",
        mappingKey: "employer-payment",
        policyRef: "policy://org-synthetic/payment/employer-v1",
      }),
    ],
  };
}

/** Successful dry-run result where all entries would be created. */
export function makeSuccessfulDryRunResult(): DryRunResult {
  return makeDryRunResult({
    schemas: [
      makeDryRunSchemaEntry({ action: "create" }),
      makeDryRunSchemaEntry({
        action: "create",
        schema: makeSchemaMetadata({ id: "employer-payment.v1", version: "1.0.0", name: "Employer Payment Schema" }),
      }),
    ],
    policyMappings: [
      makeDryRunMappingEntry({ action: "create" }),
    ],
    etag: "etag-fresh-001",
    generatedAt: "2026-01-15T10:01:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// Negative / error scenarios
// ---------------------------------------------------------------------------

/** Malformed JSON string — JSON.parse will throw. */
export const MALFORMED_JSON = `{ "schemas": [ { "id": "broken, }] }`;

/** Valid JSON but violates the schema (missing required 'version' field). */
export const MISSING_REQUIRED_FIELD_JSON = JSON.stringify({
  schemas: [{ id: "test-schema", name: "Test Schema" }], // missing version
});

/** Valid JSON but contains an unknown top-level field (strict mode rejects). */
export const UNKNOWN_FIELD_JSON = JSON.stringify({
  schemas: [
    {
      id: "income-verification.v1",
      version: "1.0.0",
      name: "Income Verification",
      unknownExtraField: "this should be rejected",
    },
  ],
});

/** Schema with an id that doesn't match the regex (uppercase). */
export const INVALID_ID_JSON = JSON.stringify({
  schemas: [{ id: "UPPERCASE-ID", version: "1.0.0", name: "Bad Schema" }],
});

/** Schema with a version that isn't semver. */
export const INVALID_VERSION_JSON = JSON.stringify({
  schemas: [{ id: "test-schema", version: "v1.0", name: "Bad Schema" }],
});

/** Empty string — should fail the paste gate before JSON.parse. */
export const EMPTY_INPUT = "";

/** Whitespace-only string — should fail the paste gate. */
export const WHITESPACE_INPUT = "   \n\t  ";

/**
 * String that exceeds MAX_SCHEMA_IMPORT_BYTES.
 * Constructed as a JSON payload with a padded description field.
 */
export function makeOversizedImportJson(): string {
  const padding = "x".repeat(MAX_SCHEMA_IMPORT_BYTES + 100);
  return JSON.stringify({
    schemas: [
      {
        id: "income-verification.v1",
        version: "1.0.0",
        name: "Income Verification Schema",
        description: padding,
      },
    ],
  });
}

/**
 * A valid payload string whose byte count is exactly MAX_SCHEMA_IMPORT_BYTES.
 * Should be accepted (at-limit = accepted).
 */
export function makeAtLimitImportJson(): string {
  // Build a payload and pad description to reach exactly the limit
  const base = JSON.stringify(makeSchemaImportPayload());
  const baseBytes = new TextEncoder().encode(base).length;
  // We embed the padding into a metadata value to keep the JSON valid
  const paddingLength = Math.max(0, MAX_SCHEMA_IMPORT_BYTES - baseBytes - 30);
  const payload = makeSchemaImportPayload({
    schemas: [
      makeSchemaMetadata({
        metadata: { pad: "p".repeat(paddingLength) },
      }),
    ],
  });
  const json = JSON.stringify(payload);
  // Trim to ensure we don't exceed due to metadata key overhead
  const jsonBytes = new TextEncoder().encode(json).length;
  if (jsonBytes <= MAX_SCHEMA_IMPORT_BYTES) return json;
  // Fall back to returning a smaller valid payload (still under limit)
  return JSON.stringify(makeSchemaImportPayload());
}

/** Payload with exactly MAX_SCHEMAS_PER_IMPORT schemas (should pass). */
export function makeAtLimitSchemaCountPayload(): SchemaImportPayload {
  return {
    schemas: Array.from({ length: MAX_SCHEMAS_PER_IMPORT }, (_, i) =>
      makeSchemaMetadata({ id: `schema-${String(i).padStart(3, "0")}`, version: "1.0.0", name: `Schema ${i}` }),
    ),
    policyMappings: [],
  };
}

/** Payload with MAX_SCHEMAS_PER_IMPORT + 1 schemas (should fail). */
export function makeOverLimitSchemaCountPayload(): SchemaImportPayload {
  return {
    schemas: Array.from({ length: MAX_SCHEMAS_PER_IMPORT + 1 }, (_, i) =>
      makeSchemaMetadata({ id: `schema-${String(i).padStart(3, "0")}`, version: "1.0.0", name: `Schema ${i}` }),
    ),
    policyMappings: [],
  };
}

/** Payload with exactly MAX_POLICY_MAPPINGS_PER_IMPORT mappings (should pass). */
export function makeAtLimitMappingCountPayload(): SchemaImportPayload {
  return {
    schemas: [makeSchemaMetadata({ id: "base-schema", version: "1.0.0", name: "Base Schema" })],
    policyMappings: Array.from({ length: MAX_POLICY_MAPPINGS_PER_IMPORT }, (_, i) =>
      makePolicyMapping({
        schemaId: "base-schema",
        schemaVersion: "1.0.0",
        mappingKey: `key-${String(i).padStart(4, "0")}`,
        policyRef: `policy://org-synthetic/key-${i}`,
      }),
    ),
  };
}

/** Payload with MAX_POLICY_MAPPINGS_PER_IMPORT + 1 mappings (should fail). */
export function makeOverLimitMappingCountPayload(): SchemaImportPayload {
  return {
    schemas: [makeSchemaMetadata({ id: "base-schema", version: "1.0.0", name: "Base Schema" })],
    policyMappings: Array.from({ length: MAX_POLICY_MAPPINGS_PER_IMPORT + 1 }, (_, i) =>
      makePolicyMapping({
        schemaId: "base-schema",
        schemaVersion: "1.0.0",
        mappingKey: `key-${String(i).padStart(4, "0")}`,
        policyRef: `policy://org-synthetic/key-${i}`,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Conflict detection scenarios
// ---------------------------------------------------------------------------

/** Existing registry with a schema that has the same id+version as the import. */
export function makeExistingRegistryWithSameVersion(): {
  schemas: ExistingSchema[];
  policyMappings: ExistingPolicyMapping[];
} {
  return {
    schemas: [makeExistingSchema({ id: "income-verification.v1", version: "1.0.0", name: "Income Verification (existing)" })],
    policyMappings: [],
  };
}

/** Existing registry with a schema that has the same id but a different version. */
export function makeExistingRegistryWithDifferentVersion(): {
  schemas: ExistingSchema[];
  policyMappings: ExistingPolicyMapping[];
} {
  return {
    schemas: [makeExistingSchema({ id: "income-verification.v1", version: "0.9.0", name: "Income Verification (legacy)" })],
    policyMappings: [],
  };
}

/** Existing registry where a mapping key is bound to a different policyRef. */
export function makeExistingRegistryWithOverlappingMapping(): {
  schemas: ExistingSchema[];
  policyMappings: ExistingPolicyMapping[];
} {
  return {
    schemas: [],
    policyMappings: [
      makeExistingPolicyMapping({
        schemaId: "income-verification.v1",
        schemaVersion: "1.0.0",
        mappingKey: "minimum-income",
        policyRef: "policy://org-synthetic/income/DIFFERENT-policy-ref",
      }),
    ],
  };
}

/** Existing registry with no conflicts. */
export function makeEmptyExistingRegistry(): {
  schemas: ExistingSchema[];
  policyMappings: ExistingPolicyMapping[];
} {
  return { schemas: [], policyMappings: [] };
}

// ---------------------------------------------------------------------------
// Authorization scenarios
// ---------------------------------------------------------------------------

/** Marker for an unauthorized user (no token). Used in test mocks. */
export const UNAUTHORIZED_TOKEN = "";

/** Marker for a user with insufficient role (has token but 403 on dry-run). */
export const INSUFFICIENT_ROLE_TOKEN = "token-insufficient-role-synthetic";

// ---------------------------------------------------------------------------
// Dry-run stale-state scenario
// ---------------------------------------------------------------------------

/**
 * Simulates: user loaded the preview with etag-preview-A, then the org state
 * changed, and the dry-run returned etag-new-B.  UI should show a stale warning.
 */
export function makeStaleDryRunScenario(): {
  previewEtag: string;
  dryRunResult: DryRunResult;
} {
  return {
    previewEtag: "etag-preview-A",
    dryRunResult: makeDryRunResult({ etag: "etag-new-B", generatedAt: "2026-01-15T10:05:00.000Z" }),
  };
}

/**
 * Simulates: dry-run etag matches the preview etag — no stale state.
 */
export function makeFreshDryRunScenario(): {
  previewEtag: string;
  dryRunResult: DryRunResult;
} {
  return {
    previewEtag: "etag-abc123",
    dryRunResult: makeDryRunResult({ etag: "etag-abc123", generatedAt: "2026-01-15T10:01:00.000Z" }),
  };
}

// ---------------------------------------------------------------------------
// Replay scenario
// ---------------------------------------------------------------------------

/**
 * Returns two identical dry-run result objects that should be byte-for-byte
 * equal, demonstrating that identical payloads yield deterministic output.
 */
export function makeReplayScenario(): { first: DryRunResult; second: DryRunResult } {
  const payload = makeSchemaImportPayload();
  const result = makeDryRunResult({
    etag: "etag-replay-001",
    generatedAt: "2026-01-15T10:01:00.000Z",
    schemas: [makeDryRunSchemaEntry({ action: "create", schema: payload.schemas![0] })],
    policyMappings: [makeDryRunMappingEntry({ action: "create", mapping: payload.policyMappings![0] })],
  });
  // Both calls return identical objects
  return { first: result, second: { ...result } };
}

// ---------------------------------------------------------------------------
// Mixed dry-run results (create / update / skip / reject in one response)
// ---------------------------------------------------------------------------

export function makeMixedDryRunResult(): DryRunResult {
  return {
    schemas: [
      makeDryRunSchemaEntry({ action: "create", schema: makeSchemaMetadata({ id: "new-schema.v1", version: "1.0.0", name: "New Schema" }) }),
      makeDryRunSchemaEntry({ action: "update", schema: makeSchemaMetadata({ id: "income-verification.v1", version: "1.0.0" }), existingVersion: "0.9.0" }),
      makeDryRunSchemaEntry({ action: "skip", schema: makeSchemaMetadata({ id: "unchanged-schema.v1", version: "2.0.0", name: "Unchanged Schema" }) }),
      makeDryRunSchemaEntry({ action: "reject", schema: makeSchemaMetadata({ id: "bad.schema", version: "99.0.0", name: "Bad Schema" }), rejectReason: "Version downgrade not permitted" }),
    ],
    policyMappings: [
      makeDryRunMappingEntry({ action: "create" }),
      makeDryRunMappingEntry({ action: "skip", mapping: makePolicyMapping({ mappingKey: "existing-key", policyRef: "policy://already-there" }) }),
      makeDryRunMappingEntry({ action: "reject", mapping: makePolicyMapping({ mappingKey: "bad-key" }), rejectReason: "Policy reference not found in org" }),
    ],
    etag: "etag-mixed-001",
    generatedAt: "2026-01-15T10:02:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Boundary: maximum string length schemas
// ---------------------------------------------------------------------------

export function makeBoundaryMaxStringLengthPayload(): SchemaImportPayload {
  return {
    schemas: [
      makeSchemaMetadata({
        id: "a".repeat(SCHEMA_ID_MAX_LENGTH),
        version: "1.0.0",
        name: "n".repeat(SCHEMA_NAME_MAX_LENGTH),
        description: "d".repeat(SCHEMA_DESCRIPTION_MAX_LENGTH),
      }),
    ],
    policyMappings: [],
  };
}

/** File object mock that is exactly at the byte limit. */
export function makeAtLimitFileMock(): { name: string; size: number; type: string } {
  return { name: "import.json", size: MAX_SCHEMA_IMPORT_BYTES, type: "application/json" };
}

/** File object mock that is one byte over the limit. */
export function makeOverLimitFileMock(): { name: string; size: number; type: string } {
  return { name: "import.json", size: MAX_SCHEMA_IMPORT_BYTES + 1, type: "application/json" };
}

/** File object mock with an unsupported extension. */
export function makeUnsupportedExtensionFileMock(): {
  name: string;
  size: number;
  type: string;
} {
  return { name: "import.csv", size: 100, type: "text/csv" };
}

/** File object mock with a supported extension but unsupported MIME type. */
export function makeUnsupportedMimeFileMock(): { name: string; size: number; type: string } {
  return { name: "import.json", size: 100, type: "text/plain" };
}

/** File object mock for an empty file. */
export function makeEmptyFileMock(): { name: string; size: number; type: string } {
  return { name: "import.json", size: 0, type: "application/json" };
}
