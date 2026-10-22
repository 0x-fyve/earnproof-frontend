/**
 * Validation schemas and utilities for schema metadata + policy mapping import.
 *
 * Covers:
 *  - Local (pre-request) file/paste gate: size, count, extension, MIME type
 *  - Strict payload validation: rejects unknown fields, malformed values
 *  - Normalized canonical form (strips whitespace, lowercases ids)
 *  - Conflict detection against the org's existing schemas/mappings
 *  - Dry-run result types returned by the server
 *
 * All size/count bounds are exported as named constants so they can be
 * imported by both the validation layer and the UI copy (no magic numbers).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Named limits — exact boundary semantics: AT-LIMIT accepted, LIMIT+1 rejected
// ---------------------------------------------------------------------------

/** Maximum total byte size of the raw import payload (file or paste text). */
export const MAX_SCHEMA_IMPORT_BYTES = 256 * 1024; // 256 KB

/** Maximum number of schema metadata objects in a single import. */
export const MAX_SCHEMAS_PER_IMPORT = 100;

/** Maximum number of policy mapping objects in a single import. */
export const MAX_POLICY_MAPPINGS_PER_IMPORT = 500;

/** Maximum character length of a schema id field. */
export const SCHEMA_ID_MAX_LENGTH = 128;

/** Maximum character length of a schema version field. */
export const SCHEMA_VERSION_MAX_LENGTH = 64;

/** Maximum character length of a schema name. */
export const SCHEMA_NAME_MAX_LENGTH = 200;

/** Maximum character length of a schema description. */
export const SCHEMA_DESCRIPTION_MAX_LENGTH = 2000;

/** Maximum character length of a policy mapping key. */
export const MAPPING_KEY_MAX_LENGTH = 256;

/** Maximum character length of a policy reference. */
export const POLICY_REF_MAX_LENGTH = 512;

/** Allowed file extensions for import. */
export const ALLOWED_SCHEMA_IMPORT_EXTENSIONS = [".json"] as const;

/** Allowed MIME types (empty string handles OSes that omit MIME for .json). */
export const ALLOWED_SCHEMA_IMPORT_MIME_TYPES = [
  "application/json",
  "text/json",
  "",
] as const;

// ---------------------------------------------------------------------------
// Strict Zod schemas — z.object(...).strict() rejects unknown fields
// ---------------------------------------------------------------------------

/**
 * A single schema metadata entry.
 *
 * Intentionally strict: any key beyond the documented set causes a parse
 * failure so imports with stale or mis-typed field names are caught early.
 */
export const schemaMetadataSchema = z
  .object({
    id: z
      .string()
      .min(1, "Schema id is required")
      .max(SCHEMA_ID_MAX_LENGTH, `Schema id must be at most ${SCHEMA_ID_MAX_LENGTH} characters`)
      .regex(
        /^[a-z0-9][a-z0-9\-_.]*[a-z0-9]$|^[a-z0-9]$/,
        "Schema id must be lowercase alphanumeric with optional hyphens, underscores, or dots (no leading/trailing separators)",
      ),
    version: z
      .string()
      .min(1, "Schema version is required")
      .max(SCHEMA_VERSION_MAX_LENGTH, `Schema version must be at most ${SCHEMA_VERSION_MAX_LENGTH} characters`)
      .regex(
        /^\d+\.\d+\.\d+$/,
        "Schema version must be in semver format (e.g. 1.2.3)",
      ),
    name: z
      .string()
      .min(1, "Schema name is required")
      .max(SCHEMA_NAME_MAX_LENGTH, `Schema name must be at most ${SCHEMA_NAME_MAX_LENGTH} characters`)
      .transform((v) => v.trim()),
    description: z
      .string()
      .max(SCHEMA_DESCRIPTION_MAX_LENGTH, `Schema description must be at most ${SCHEMA_DESCRIPTION_MAX_LENGTH} characters`)
      .optional()
      .transform((v) => v?.trim()),
    /** ISO-8601 date string representing when this schema was authored. */
    authoredAt: z.string().datetime({ message: "authoredAt must be an ISO-8601 datetime" }).optional(),
    /** Arbitrary key/value metadata (string values only, max 20 entries). */
    metadata: z
      .record(z.string(), z.string())
      .refine((m) => Object.keys(m).length <= 20, "metadata must have at most 20 entries")
      .optional(),
  })
  .strict(); // rejects unknown fields

export type SchemaMetadata = z.infer<typeof schemaMetadataSchema>;

/**
 * A single policy mapping entry, associating a schema id+version with a
 * policy reference within the organization.
 */
export const policyMappingSchema = z
  .object({
    schemaId: z
      .string()
      .min(1, "schemaId is required")
      .max(SCHEMA_ID_MAX_LENGTH, `schemaId must be at most ${SCHEMA_ID_MAX_LENGTH} characters`),
    schemaVersion: z
      .string()
      .min(1, "schemaVersion is required")
      .max(SCHEMA_VERSION_MAX_LENGTH, `schemaVersion must be at most ${SCHEMA_VERSION_MAX_LENGTH} characters`)
      .regex(/^\d+\.\d+\.\d+$/, "schemaVersion must be in semver format"),
    mappingKey: z
      .string()
      .min(1, "mappingKey is required")
      .max(MAPPING_KEY_MAX_LENGTH, `mappingKey must be at most ${MAPPING_KEY_MAX_LENGTH} characters`),
    policyRef: z
      .string()
      .min(1, "policyRef is required")
      .max(POLICY_REF_MAX_LENGTH, `policyRef must be at most ${POLICY_REF_MAX_LENGTH} characters`),
  })
  .strict(); // rejects unknown fields

export type PolicyMapping = z.infer<typeof policyMappingSchema>;

/**
 * The top-level import payload shape.  Both arrays are optional to allow
 * schema-only or mapping-only imports; however the overall object itself is
 * strict so a stray top-level key is caught immediately.
 */
export const schemaImportPayloadSchema = z
  .object({
    schemas: z
      .array(schemaMetadataSchema)
      .max(
        MAX_SCHEMAS_PER_IMPORT,
        `Import must not exceed ${MAX_SCHEMAS_PER_IMPORT} schemas`,
      )
      .optional()
      .default([]),
    policyMappings: z
      .array(policyMappingSchema)
      .max(
        MAX_POLICY_MAPPINGS_PER_IMPORT,
        `Import must not exceed ${MAX_POLICY_MAPPINGS_PER_IMPORT} policy mappings`,
      )
      .optional()
      .default([]),
  })
  .strict()
  .refine(
    (data) => (data.schemas?.length ?? 0) > 0 || (data.policyMappings?.length ?? 0) > 0,
    "Import must contain at least one schema or policy mapping",
  );

export type SchemaImportPayload = z.infer<typeof schemaImportPayloadSchema>;

// ---------------------------------------------------------------------------
// Canonical / normalized form
// ---------------------------------------------------------------------------

/**
 * Normalize a parsed payload into the canonical form that would be imported.
 *
 * - schema ids are already lowercase (validated above)
 * - name and description are trimmed (transform above)
 * - schemas are deduplicated by (id, version); later duplicates are dropped
 * - policyMappings are deduplicated by (schemaId, schemaVersion, mappingKey)
 */
export function normalizeImportPayload(payload: SchemaImportPayload): SchemaImportPayload {
  const seenSchemas = new Set<string>();
  const uniqueSchemas = (payload.schemas ?? []).filter((s) => {
    const key = `${s.id}@${s.version}`;
    if (seenSchemas.has(key)) return false;
    seenSchemas.add(key);
    return true;
  });

  const seenMappings = new Set<string>();
  const uniqueMappings = (payload.policyMappings ?? []).filter((m) => {
    const key = `${m.schemaId}@${m.schemaVersion}:${m.mappingKey}`;
    if (seenMappings.has(key)) return false;
    seenMappings.add(key);
    return true;
  });

  return { schemas: uniqueSchemas, policyMappings: uniqueMappings };
}

// ---------------------------------------------------------------------------
// Local pre-request file gate (mirrors credential-import.ts pattern)
// ---------------------------------------------------------------------------

export type SchemaImportFileRejectReason = "oversized" | "unsupported-type" | "empty";

export type SchemaImportFileCheck =
  | { ok: true }
  | { ok: false; reason: SchemaImportFileRejectReason };

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_SCHEMA_IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Gate applied before a selected/dropped file is ever read.
 * Extension, MIME type, byte-size, and emptiness are all checked before
 * the file is passed to FileReader or JSON.parse.
 *
 * Boundary: at MAX_SCHEMA_IMPORT_BYTES — accepted; MAX_SCHEMA_IMPORT_BYTES+1 — rejected.
 */
export function checkSchemaImportFile(file: {
  name: string;
  size: number;
  type: string;
}): SchemaImportFileCheck {
  if (file.size <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (file.size > MAX_SCHEMA_IMPORT_BYTES) {
    return { ok: false, reason: "oversized" };
  }
  if (!hasAllowedExtension(file.name)) {
    return { ok: false, reason: "unsupported-type" };
  }
  if (!(ALLOWED_SCHEMA_IMPORT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "unsupported-type" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Paste / text gate
// ---------------------------------------------------------------------------

export type PasteRejectReason = "empty" | "oversized";

export type PasteCheck = { ok: true } | { ok: false; reason: PasteRejectReason };

/**
 * Quick gate on the raw paste string before parsing it.
 * Byte-length is checked against MAX_SCHEMA_IMPORT_BYTES.
 */
export function checkSchemaImportPaste(text: string): PasteCheck {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  const byteLength = new TextEncoder().encode(trimmed).length;
  if (byteLength > MAX_SCHEMA_IMPORT_BYTES) return { ok: false, reason: "oversized" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Parse raw JSON text → validated + normalized payload
// ---------------------------------------------------------------------------

export type ParseImportPayloadResult =
  | { ok: true; payload: SchemaImportPayload; fieldErrors: Record<string, string> }
  | { ok: false; reason: "malformed-json" | "schema-violation"; fieldErrors: Record<string, string>; message: string };

/**
 * Parse a raw JSON string (from file read or paste) into a validated,
 * normalized SchemaImportPayload.
 *
 * Returns field-level errors keyed by JSONPath-like paths (e.g.
 * "schemas[0].id") so the UI can highlight them.
 *
 * No untrusted content is ever rendered as HTML; errors are plain strings.
 */
export function parseSchemaImportPayload(raw: string): ParseImportPayloadResult {
  const trimmed = raw.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      reason: "malformed-json",
      fieldErrors: {},
      message: "The provided text is not valid JSON.",
    };
  }

  const result = schemaImportPayloadSchema.safeParse(parsed);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".").replace(/\.(\d+)\./g, "[$1].") : "_root";
      if (!fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    const firstMessage =
      result.error.issues[0]?.message ?? "The import payload does not match the expected schema.";
    return {
      ok: false,
      reason: "schema-violation",
      fieldErrors,
      message: firstMessage,
    };
  }

  return {
    ok: true,
    payload: normalizeImportPayload(result.data),
    fieldErrors: {},
  };
}

// ---------------------------------------------------------------------------
// Conflict detection (client-side, against org's existing schemas)
// ---------------------------------------------------------------------------

/**
 * Existing schema entry as returned by the org's schema registry.
 * Only the fields used for conflict detection are required here.
 */
export interface ExistingSchema {
  id: string;
  version: string;
  name: string;
}

/**
 * Existing policy mapping as returned by the org's policy registry.
 */
export interface ExistingPolicyMapping {
  schemaId: string;
  schemaVersion: string;
  mappingKey: string;
  policyRef: string;
}

export type SchemaConflictKind =
  /** Same (id, version) already exists in the org — would update or skip */
  | "same-id-version"
  /** Same id with a different version already exists — version collision */
  | "same-id-different-version";

export interface SchemaConflict {
  kind: SchemaConflictKind;
  incoming: SchemaMetadata;
  existing: ExistingSchema;
}

export type MappingConflictKind =
  /** Exact (schemaId, schemaVersion, mappingKey) already mapped */
  | "duplicate-mapping"
  /** mappingKey already bound to a different policyRef */
  | "overlapping-mapping";

export interface MappingConflict {
  kind: MappingConflictKind;
  incoming: PolicyMapping;
  existing: ExistingPolicyMapping;
}

export interface ConflictReport {
  schemaConflicts: SchemaConflict[];
  mappingConflicts: MappingConflict[];
  hasConflicts: boolean;
}

/**
 * Detect conflicts between the incoming payload and the org's existing
 * schemas/mappings.
 *
 * Pure function — no side effects, deterministic output for identical inputs.
 */
export function detectImportConflicts(
  payload: SchemaImportPayload,
  existing: {
    schemas: ExistingSchema[];
    policyMappings: ExistingPolicyMapping[];
  },
): ConflictReport {
  const schemaConflicts: SchemaConflict[] = [];
  const mappingConflicts: MappingConflict[] = [];

  for (const incoming of payload.schemas ?? []) {
    for (const ex of existing.schemas) {
      if (ex.id === incoming.id && ex.version === incoming.version) {
        schemaConflicts.push({ kind: "same-id-version", incoming, existing: ex });
      } else if (ex.id === incoming.id && ex.version !== incoming.version) {
        schemaConflicts.push({ kind: "same-id-different-version", incoming, existing: ex });
      }
    }
  }

  for (const incoming of payload.policyMappings ?? []) {
    for (const ex of existing.policyMappings) {
      if (
        ex.schemaId === incoming.schemaId &&
        ex.schemaVersion === incoming.schemaVersion &&
        ex.mappingKey === incoming.mappingKey
      ) {
        if (ex.policyRef === incoming.policyRef) {
          mappingConflicts.push({ kind: "duplicate-mapping", incoming, existing: ex });
        } else {
          mappingConflicts.push({ kind: "overlapping-mapping", incoming, existing: ex });
        }
      }
    }
  }

  return {
    schemaConflicts,
    mappingConflicts,
    hasConflicts: schemaConflicts.length > 0 || mappingConflicts.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Dry-run result types (server-side response)
// ---------------------------------------------------------------------------

export type DryRunActionKind = "create" | "update" | "skip" | "reject";

export interface DryRunSchemaEntry {
  action: DryRunActionKind;
  schema: SchemaMetadata;
  /** Populated when action === "reject" */
  rejectReason?: string;
  /** Populated when action === "update" — the existing version being replaced */
  existingVersion?: string;
}

export interface DryRunMappingEntry {
  action: DryRunActionKind;
  mapping: PolicyMapping;
  rejectReason?: string;
  existingPolicyRef?: string;
}

/**
 * Full dry-run result returned by POST /schemas/dry-run.
 *
 * The server MUST NOT mutate any state when processing a dry-run request.
 * The `etag` field reflects the org's current schema-registry state at the
 * time the dry run was evaluated; the UI uses it for stale-state detection.
 */
export interface DryRunResult {
  schemas: DryRunSchemaEntry[];
  policyMappings: DryRunMappingEntry[];
  /** ETag/version of the org's schema registry at evaluation time. */
  etag: string;
  /** ISO-8601 datetime when the dry run was evaluated. */
  generatedAt: string;
}

/** Summary counts derived from a DryRunResult. */
export interface DryRunSummary {
  schemasToCreate: number;
  schemasToUpdate: number;
  schemasToSkip: number;
  schemasToReject: number;
  mappingsToCreate: number;
  mappingsToUpdate: number;
  mappingsToSkip: number;
  mappingsToReject: number;
}

export function summarizeDryRun(result: DryRunResult): DryRunSummary {
  const count = (entries: { action: DryRunActionKind }[], kind: DryRunActionKind) =>
    entries.filter((e) => e.action === kind).length;

  return {
    schemasToCreate: count(result.schemas, "create"),
    schemasToUpdate: count(result.schemas, "update"),
    schemasToSkip: count(result.schemas, "skip"),
    schemasToReject: count(result.schemas, "reject"),
    mappingsToCreate: count(result.policyMappings, "create"),
    mappingsToUpdate: count(result.policyMappings, "update"),
    mappingsToSkip: count(result.policyMappings, "skip"),
    mappingsToReject: count(result.policyMappings, "reject"),
  };
}

/**
 * Check whether an org-state etag observed at preview time still matches
 * the one returned in the dry-run result.
 *
 * Returns false (stale) when the etags differ, meaning the org's schema
 * registry changed between when the user loaded the preview and when the
 * dry run was evaluated.
 */
export function isDryRunStale(previewEtag: string, dryRunEtag: string): boolean {
  return previewEtag !== dryRunEtag;
}

// ---------------------------------------------------------------------------
// Human-readable messages for reject reasons and conflict kinds
// ---------------------------------------------------------------------------

export function schemaConflictLabel(kind: SchemaConflictKind): string {
  switch (kind) {
    case "same-id-version":
      return "Same id and version already exists";
    case "same-id-different-version":
      return "A different version of this schema id already exists";
  }
}

export function mappingConflictLabel(kind: MappingConflictKind): string {
  switch (kind) {
    case "duplicate-mapping":
      return "Identical mapping already exists (will be skipped)";
    case "overlapping-mapping":
      return "This mapping key is already bound to a different policy ref";
  }
}

export function dryRunActionLabel(action: DryRunActionKind): string {
  switch (action) {
    case "create":
      return "Will be created";
    case "update":
      return "Will update existing";
    case "skip":
      return "Will be skipped (no change)";
    case "reject":
      return "Will be rejected";
  }
}
