/**
 * Unit tests for lib/validation/schema-import.ts
 *
 * Tests the pure validation and utility functions in isolation — no DOM,
 * no API calls.  These run in the default jest environment (Node).
 *
 * NOTE: component-level integration tests (render, user interaction, API mock)
 * live in components/schemas/__tests__/schema-import-container.test.tsx.
 */

import {
  checkSchemaImportFile,
  checkSchemaImportPaste,
  parseSchemaImportPayload,
  detectImportConflicts,
  normalizeImportPayload,
  isDryRunStale,
  summarizeDryRun,
  schemaConflictLabel,
  mappingConflictLabel,
  dryRunActionLabel,
  MAX_SCHEMA_IMPORT_BYTES,
  MAX_SCHEMAS_PER_IMPORT,
  MAX_POLICY_MAPPINGS_PER_IMPORT,
  SCHEMA_ID_MAX_LENGTH,
  SCHEMA_VERSION_MAX_LENGTH,
} from "./schema-import";
import {
  makeValidImportJson,
  makeAtLimitFileMock,
  makeOverLimitFileMock,
  makeUnsupportedExtensionFileMock,
  makeUnsupportedMimeFileMock,
  makeEmptyFileMock,
  makeAtLimitSchemaCountPayload,
  makeOverLimitSchemaCountPayload,
  makeAtLimitMappingCountPayload,
  makeOverLimitMappingCountPayload,
  makeBoundaryMaxStringLengthPayload,
  MALFORMED_JSON,
  MISSING_REQUIRED_FIELD_JSON,
  UNKNOWN_FIELD_JSON,
  INVALID_ID_JSON,
  INVALID_VERSION_JSON,
  makeDryRunResult,
  makeMixedDryRunResult,
  makeReplayScenario,
} from "@/data/fixtures/schema-import";

// ===========================================================================
// checkSchemaImportFile
// ===========================================================================

describe("checkSchemaImportFile", () => {
  describe("size boundaries", () => {
    it("accepts a file at exactly MAX_SCHEMA_IMPORT_BYTES (at-limit = accepted)", () => {
      expect(checkSchemaImportFile(makeAtLimitFileMock())).toEqual({ ok: true });
    });

    it("rejects a file at MAX_SCHEMA_IMPORT_BYTES + 1 (over-limit = rejected)", () => {
      expect(checkSchemaImportFile(makeOverLimitFileMock())).toEqual({
        ok: false,
        reason: "oversized",
      });
    });

    it("rejects an empty file (size === 0)", () => {
      expect(checkSchemaImportFile(makeEmptyFileMock())).toEqual({
        ok: false,
        reason: "empty",
      });
    });

    it("rejects a file with size === 1 but empty MIME type and unsupported extension", () => {
      const result = checkSchemaImportFile({ name: "test.csv", size: 1, type: "text/csv" });
      expect(result.ok).toBe(false);
    });
  });

  describe("extension and MIME type", () => {
    it("accepts .json with application/json MIME", () => {
      expect(
        checkSchemaImportFile({ name: "import.json", size: 100, type: "application/json" }),
      ).toEqual({ ok: true });
    });

    it("accepts .json with text/json MIME", () => {
      expect(
        checkSchemaImportFile({ name: "import.json", size: 100, type: "text/json" }),
      ).toEqual({ ok: true });
    });

    it("accepts .json with empty MIME (some OSes omit MIME for .json)", () => {
      expect(
        checkSchemaImportFile({ name: "import.json", size: 100, type: "" }),
      ).toEqual({ ok: true });
    });

    it("rejects .json with text/plain MIME", () => {
      expect(checkSchemaImportFile(makeUnsupportedMimeFileMock())).toEqual({
        ok: false,
        reason: "unsupported-type",
      });
    });

    it("rejects .csv extension", () => {
      expect(checkSchemaImportFile(makeUnsupportedExtensionFileMock())).toEqual({
        ok: false,
        reason: "unsupported-type",
      });
    });

    it("rejects .JSON (uppercase extension, case-insensitive check means it should pass)", () => {
      // .JSON should be treated same as .json
      expect(
        checkSchemaImportFile({ name: "import.JSON", size: 100, type: "application/json" }),
      ).toEqual({ ok: true });
    });
  });
});

// ===========================================================================
// checkSchemaImportPaste
// ===========================================================================

describe("checkSchemaImportPaste", () => {
  it("rejects empty string", () => {
    expect(checkSchemaImportPaste("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects whitespace-only string", () => {
    expect(checkSchemaImportPaste("   \n\t  ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a short valid string", () => {
    expect(checkSchemaImportPaste("{}")).toEqual({ ok: true });
  });

  it("rejects a string whose UTF-8 byte length exceeds MAX_SCHEMA_IMPORT_BYTES", () => {
    // 'x' is ASCII so byte length = char length; padding to just over limit
    const oversized = "x".repeat(MAX_SCHEMA_IMPORT_BYTES + 1);
    expect(checkSchemaImportPaste(oversized)).toEqual({ ok: false, reason: "oversized" });
  });

  it("accepts a string at exactly MAX_SCHEMA_IMPORT_BYTES bytes", () => {
    const atLimit = "x".repeat(MAX_SCHEMA_IMPORT_BYTES);
    expect(checkSchemaImportPaste(atLimit)).toEqual({ ok: true });
  });
});

// ===========================================================================
// parseSchemaImportPayload
// ===========================================================================

describe("parseSchemaImportPayload", () => {
  it("parses a valid payload successfully", () => {
    const result = parseSchemaImportPayload(makeValidImportJson());
    expect(result.ok).toBe(true);
  });

  it("returns malformed-json for non-JSON input", () => {
    const result = parseSchemaImportPayload("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed-json");
  });

  it("returns malformed-json for empty string", () => {
    const result = parseSchemaImportPayload("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed-json");
  });

  it("returns schema-violation for missing required field (version)", () => {
    const result = parseSchemaImportPayload(MISSING_REQUIRED_FIELD_JSON);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema-violation");
  });

  it("returns schema-violation and field errors for unknown fields (strict mode)", () => {
    const result = parseSchemaImportPayload(UNKNOWN_FIELD_JSON);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema-violation");
      // There should be at least one field error
      expect(Object.keys(result.fieldErrors).length).toBeGreaterThan(0);
    }
  });

  it("returns schema-violation for uppercase schema id", () => {
    const result = parseSchemaImportPayload(INVALID_ID_JSON);
    expect(result.ok).toBe(false);
  });

  it("returns schema-violation for non-semver version", () => {
    const result = parseSchemaImportPayload(INVALID_VERSION_JSON);
    expect(result.ok).toBe(false);
  });

  it("accepts empty schemas and policyMappings arrays (payload is still valid if at least one is non-empty — but the refinement requires at least one entry)", () => {
    const result = parseSchemaImportPayload(JSON.stringify({ schemas: [], policyMappings: [] }));
    // Fails because the refinement requires at least one schema or mapping
    expect(result.ok).toBe(false);
  });

  it("accepts schemas-only payload (no policyMappings key)", () => {
    const result = parseSchemaImportPayload(
      JSON.stringify({ schemas: [{ id: "test-schema", version: "1.0.0", name: "Test" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("trims whitespace from name field during normalization", () => {
    const result = parseSchemaImportPayload(
      JSON.stringify({
        schemas: [{ id: "test-schema", version: "1.0.0", name: "  Padded Name  " }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.schemas![0].name).toBe("Padded Name");
    }
  });

  it("rejects a payload with a top-level unknown field", () => {
    const result = parseSchemaImportPayload(
      JSON.stringify({ schemas: [], policyMappings: [], unknownTopLevel: true }),
    );
    expect(result.ok).toBe(false);
  });

  describe("count limits", () => {
    it("accepts exactly MAX_SCHEMAS_PER_IMPORT schemas", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify(makeAtLimitSchemaCountPayload()),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects MAX_SCHEMAS_PER_IMPORT + 1 schemas", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify(makeOverLimitSchemaCountPayload()),
      );
      expect(result.ok).toBe(false);
    });

    it("accepts exactly MAX_POLICY_MAPPINGS_PER_IMPORT mappings", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify(makeAtLimitMappingCountPayload()),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects MAX_POLICY_MAPPINGS_PER_IMPORT + 1 mappings", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify(makeOverLimitMappingCountPayload()),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("boundary: maximum string lengths", () => {
    it("accepts a payload with max-length strings", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify(makeBoundaryMaxStringLengthPayload()),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects an id that exceeds SCHEMA_ID_MAX_LENGTH", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify({
          schemas: [
            {
              id: "a".repeat(SCHEMA_ID_MAX_LENGTH + 1),
              version: "1.0.0",
              name: "Test",
            },
          ],
        }),
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a version that exceeds SCHEMA_VERSION_MAX_LENGTH", () => {
      const result = parseSchemaImportPayload(
        JSON.stringify({
          schemas: [
            {
              id: "test-schema",
              version: "1." + "0".repeat(SCHEMA_VERSION_MAX_LENGTH) + ".0",
              name: "Test",
            },
          ],
        }),
      );
      expect(result.ok).toBe(false);
    });
  });
});

// ===========================================================================
// normalizeImportPayload
// ===========================================================================

describe("normalizeImportPayload", () => {
  it("deduplicates schemas with identical (id, version) — keeps first occurrence", () => {
    const payload = {
      schemas: [
        { id: "s1", version: "1.0.0", name: "First" },
        { id: "s1", version: "1.0.0", name: "Second (dup)" },
      ],
      policyMappings: [],
    };
    const normalized = normalizeImportPayload(payload);
    expect(normalized.schemas!.length).toBe(1);
    expect(normalized.schemas![0].name).toBe("First");
  });

  it("keeps schemas with same id but different versions", () => {
    const payload = {
      schemas: [
        { id: "s1", version: "1.0.0", name: "V1" },
        { id: "s1", version: "2.0.0", name: "V2" },
      ],
      policyMappings: [],
    };
    const normalized = normalizeImportPayload(payload);
    expect(normalized.schemas!.length).toBe(2);
  });

  it("deduplicates mappings with same (schemaId, schemaVersion, mappingKey)", () => {
    const payload = {
      schemas: [],
      policyMappings: [
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k1", policyRef: "p1" },
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k1", policyRef: "p2" }, // dup
      ],
    };
    const normalized = normalizeImportPayload(payload);
    expect(normalized.policyMappings!.length).toBe(1);
    expect(normalized.policyMappings![0].policyRef).toBe("p1");
  });

  it("keeps mappings with different mapping keys", () => {
    const payload = {
      schemas: [],
      policyMappings: [
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k1", policyRef: "p1" },
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k2", policyRef: "p2" },
      ],
    };
    const normalized = normalizeImportPayload(payload);
    expect(normalized.policyMappings!.length).toBe(2);
  });
});

// ===========================================================================
// detectImportConflicts
// ===========================================================================

describe("detectImportConflicts", () => {
  const incoming = {
    schemas: [{ id: "income-verification.v1", version: "1.0.0", name: "IV Schema" }],
    policyMappings: [
      {
        schemaId: "income-verification.v1",
        schemaVersion: "1.0.0",
        mappingKey: "minimum-income",
        policyRef: "policy://new",
      },
    ],
  };

  it("no conflicts with empty registry", () => {
    const report = detectImportConflicts(incoming, { schemas: [], policyMappings: [] });
    expect(report.hasConflicts).toBe(false);
  });

  it("same-id-version conflict when id AND version match", () => {
    const report = detectImportConflicts(incoming, {
      schemas: [{ id: "income-verification.v1", version: "1.0.0", name: "Existing" }],
      policyMappings: [],
    });
    expect(report.schemaConflicts[0].kind).toBe("same-id-version");
    expect(report.hasConflicts).toBe(true);
  });

  it("same-id-different-version conflict when id matches but version differs", () => {
    const report = detectImportConflicts(incoming, {
      schemas: [{ id: "income-verification.v1", version: "0.5.0", name: "Old" }],
      policyMappings: [],
    });
    expect(report.schemaConflicts[0].kind).toBe("same-id-different-version");
  });

  it("overlapping-mapping conflict when mapping key bound to different ref", () => {
    const report = detectImportConflicts(incoming, {
      schemas: [],
      policyMappings: [
        {
          schemaId: "income-verification.v1",
          schemaVersion: "1.0.0",
          mappingKey: "minimum-income",
          policyRef: "policy://OTHER",
        },
      ],
    });
    expect(report.mappingConflicts[0].kind).toBe("overlapping-mapping");
  });

  it("duplicate-mapping conflict when mapping key bound to same ref", () => {
    const report = detectImportConflicts(incoming, {
      schemas: [],
      policyMappings: [
        {
          schemaId: "income-verification.v1",
          schemaVersion: "1.0.0",
          mappingKey: "minimum-income",
          policyRef: "policy://new",
        },
      ],
    });
    expect(report.mappingConflicts[0].kind).toBe("duplicate-mapping");
  });

  it("is purely deterministic — same inputs always produce same output", () => {
    const report1 = detectImportConflicts(incoming, {
      schemas: [{ id: "income-verification.v1", version: "1.0.0", name: "E" }],
      policyMappings: [],
    });
    const report2 = detectImportConflicts(incoming, {
      schemas: [{ id: "income-verification.v1", version: "1.0.0", name: "E" }],
      policyMappings: [],
    });
    expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));
  });
});

// ===========================================================================
// isDryRunStale
// ===========================================================================

describe("isDryRunStale", () => {
  it("returns false when etags are identical", () => {
    expect(isDryRunStale("etag-abc", "etag-abc")).toBe(false);
  });

  it("returns true when etags differ (state changed on server)", () => {
    expect(isDryRunStale("etag-abc", "etag-def")).toBe(true);
  });

  it("returns true for empty strings that don't match", () => {
    expect(isDryRunStale("", "etag-def")).toBe(true);
  });

  it("returns false for two identical empty strings", () => {
    expect(isDryRunStale("", "")).toBe(false);
  });
});

// ===========================================================================
// summarizeDryRun
// ===========================================================================

describe("summarizeDryRun", () => {
  it("returns all zeros for empty result", () => {
    const result = makeDryRunResult({ schemas: [], policyMappings: [] });
    const summary = summarizeDryRun(result);
    expect(summary).toEqual({
      schemasToCreate: 0,
      schemasToUpdate: 0,
      schemasToSkip: 0,
      schemasToReject: 0,
      mappingsToCreate: 0,
      mappingsToUpdate: 0,
      mappingsToSkip: 0,
      mappingsToReject: 0,
    });
  });

  it("counts all four action kinds correctly from mixed result", () => {
    const summary = summarizeDryRun(makeMixedDryRunResult());
    expect(summary.schemasToCreate).toBe(1);
    expect(summary.schemasToUpdate).toBe(1);
    expect(summary.schemasToSkip).toBe(1);
    expect(summary.schemasToReject).toBe(1);
    expect(summary.mappingsToCreate).toBe(1);
    expect(summary.mappingsToSkip).toBe(1);
    expect(summary.mappingsToReject).toBe(1);
  });
});

// ===========================================================================
// Label helpers
// ===========================================================================

describe("label helpers", () => {
  it("schemaConflictLabel returns a non-empty string for every kind", () => {
    expect(schemaConflictLabel("same-id-version")).toBeTruthy();
    expect(schemaConflictLabel("same-id-different-version")).toBeTruthy();
  });

  it("mappingConflictLabel returns a non-empty string for every kind", () => {
    expect(mappingConflictLabel("duplicate-mapping")).toBeTruthy();
    expect(mappingConflictLabel("overlapping-mapping")).toBeTruthy();
  });

  it("dryRunActionLabel returns a non-empty string for every action", () => {
    (["create", "update", "skip", "reject"] as const).forEach((action) => {
      expect(dryRunActionLabel(action)).toBeTruthy();
    });
  });
});

// ===========================================================================
// Replay determinism (pure logic)
// ===========================================================================

describe("Replay: same payload → deterministic parse + conflict detection", () => {
  it("parsing the same JSON twice produces identical normalized payloads", () => {
    const json = makeValidImportJson();
    const r1 = parseSchemaImportPayload(json);
    const r2 = parseSchemaImportPayload(json);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(JSON.stringify(r1.payload)).toBe(JSON.stringify(r2.payload));
    }
  });

  it("conflict detection on the same inputs twice produces identical reports", () => {
    const payload = { schemas: [{ id: "s1", version: "1.0.0", name: "S1" }], policyMappings: [] };
    const registry = { schemas: [{ id: "s1", version: "1.0.0", name: "Existing" }], policyMappings: [] };
    const r1 = detectImportConflicts(payload, registry);
    const r2 = detectImportConflicts(payload, registry);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
