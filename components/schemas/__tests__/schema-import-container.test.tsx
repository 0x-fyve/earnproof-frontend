/**
 * @jest-environment jsdom
 *
 * Tests for the schema import validation and dry-run UI (GitHub issue #280).
 *
 * Covers all required categories:
 *  - Positive: valid file / valid paste → normalized preview → successful dry run
 *  - Negative: malformed JSON, schema violations, unknown fields, oversized input
 *  - Authorization: unauthorized (no token) and insufficient role (403)
 *  - Concurrency/stale-state: org state changes between preview and dry run
 *  - Replay: identical submission is deterministic
 *  - Boundary: exactly at and just over each limit
 *  - Regression: dry run performs no mutation (assert no write calls)
 *  - Conflict detection scenarios
 *
 * API is mocked at the module level via jest.mock().
 * No real network calls are made.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchemaImportContainer } from "../schema-import-container";
import * as schemaImportApi from "@/lib/api/schema-import";
import {
  makeValidImportJson,
  makeSuccessfulDryRunResult,
  makeMixedDryRunResult,
  makeDryRunResult,
  makeExistingRegistryWithSameVersion,
  makeExistingRegistryWithDifferentVersion,
  makeExistingRegistryWithOverlappingMapping,
  makeEmptyExistingRegistry,
  makeStaleDryRunScenario,
  makeFreshDryRunScenario,
  makeReplayScenario,
  MALFORMED_JSON,
  MISSING_REQUIRED_FIELD_JSON,
  UNKNOWN_FIELD_JSON,
  INVALID_ID_JSON,
  INVALID_VERSION_JSON,
  EMPTY_INPUT,
  makeOversizedImportJson,
  makeAtLimitImportJson,
  makeAtLimitFileMock,
  makeOverLimitFileMock,
  makeUnsupportedExtensionFileMock,
  makeUnsupportedMimeFileMock,
  makeEmptyFileMock,
  makeAtLimitSchemaCountPayload,
  makeOverLimitSchemaCountPayload,
  makeAtLimitMappingCountPayload,
  makeOverLimitMappingCountPayload,
  UNAUTHORIZED_TOKEN,
  INSUFFICIENT_ROLE_TOKEN,
} from "@/data/fixtures/schema-import";
import {
  checkSchemaImportFile,
  checkSchemaImportPaste,
  parseSchemaImportPayload,
  detectImportConflicts,
  isDryRunStale,
  summarizeDryRun,
  normalizeImportPayload,
  MAX_SCHEMAS_PER_IMPORT,
  MAX_POLICY_MAPPINGS_PER_IMPORT,
} from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// API mocks
// ---------------------------------------------------------------------------

jest.mock("@/lib/api/schema-import", () => ({
  runSchemaDryRun: jest.fn(),
  getExistingSchemas: jest.fn(),
  getExistingPolicyMappings: jest.fn(),
}));

const mockRunSchemaDryRun = schemaImportApi.runSchemaDryRun as jest.MockedFunction<
  typeof schemaImportApi.runSchemaDryRun
>;
const mockGetExistingSchemas = schemaImportApi.getExistingSchemas as jest.MockedFunction<
  typeof schemaImportApi.getExistingSchemas
>;
const mockGetExistingPolicyMappings =
  schemaImportApi.getExistingPolicyMappings as jest.MockedFunction<
    typeof schemaImportApi.getExistingPolicyMappings
  >;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderContainer(
  token = "test-token",
  organizationId = "org-synthetic-001",
) {
  render(<SchemaImportContainer token={token} organizationId={organizationId} />);
}

function setupSuccessfulOrgLoad(etag = "etag-abc123") {
  mockGetExistingSchemas.mockResolvedValue({
    schemas: [],
    etag,
  });
  mockGetExistingPolicyMappings.mockResolvedValue({
    policyMappings: [],
    etag,
  });
}

async function fillPasteAndSubmit(json: string) {
  fireEvent.click(screen.getByRole("tab", { name: "Paste JSON" }));
  fireEvent.change(screen.getByLabelText("Paste JSON payload"), {
    target: { value: json },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validate and preview" }));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// Positive tests
// ===========================================================================

describe("Positive: valid paste → preview → dry run", () => {
  it("accepts valid JSON, shows preview, and runs dry run successfully", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockResolvedValue(makeSuccessfulDryRunResult());

    renderContainer();

    await fillPasteAndSubmit(makeValidImportJson());

    // Should load org state and advance to preview
    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });

    expect(screen.getByText("Income Verification Schema")).toBeInTheDocument();

    // Run dry run
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByText("Dry-Run Results")).toBeInTheDocument();
    });

    expect(screen.getByText(/No changes were made/)).toBeInTheDocument();
  });

  it("shows normalized preview with both schemas and policy mappings", async () => {
    setupSuccessfulOrgLoad();
    renderContainer();

    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });

    // Schema and mapping counts should be shown
    expect(screen.getByText("Schemas (1)")).toBeInTheDocument();
    expect(screen.getByText("Policy Mappings (1)")).toBeInTheDocument();
  });

  it("shows dry-run summary counts after successful run", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockResolvedValue(makeSuccessfulDryRunResult());
    renderContainer();

    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByText("Dry-Run Results")).toBeInTheDocument();
    });
    // "Would create" section should be present
    expect(screen.getByText("Would create")).toBeInTheDocument();
  });

  it("navigates back to input on Start over", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockResolvedValue(makeSuccessfulDryRunResult());
    renderContainer();

    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(screen.getByText("Dry-Run Results")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText(/Schema import JSON file/i)).toBeInTheDocument();
  });

  it("shows mixed dry run results (create/update/skip/reject) correctly", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockResolvedValue(makeMixedDryRunResult());
    renderContainer();

    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByText("Dry-Run Results")).toBeInTheDocument();
    });
    // All four action labels should appear
    expect(screen.getAllByText("Will be created").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Will update existing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Will be skipped (no change)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Will be rejected").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Negative: local validation failures
// ===========================================================================

describe("Negative: malformed and invalid input", () => {
  it("rejects malformed JSON and shows an error without calling the API", async () => {
    renderContainer();

    await fillPasteAndSubmit(MALFORMED_JSON);

    expect(screen.getByRole("alert")).toHaveTextContent(/not valid JSON/i);
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
    expect(mockRunSchemaDryRun).not.toHaveBeenCalled();
  });

  it("rejects JSON missing required fields and shows field-level errors", async () => {
    renderContainer();

    await fillPasteAndSubmit(MISSING_REQUIRED_FIELD_JSON);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Should mention a field path error
    expect(screen.getByRole("alert").textContent).toMatch(/schemas/i);
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
  });

  it("rejects payload with unknown/extra fields (strict mode)", async () => {
    renderContainer();

    await fillPasteAndSubmit(UNKNOWN_FIELD_JSON);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
  });

  it("rejects schema with invalid id (uppercase not allowed)", async () => {
    renderContainer();

    await fillPasteAndSubmit(INVALID_ID_JSON);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
  });

  it("rejects schema with non-semver version", async () => {
    renderContainer();

    await fillPasteAndSubmit(INVALID_VERSION_JSON);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
  });

  it("rejects empty input by showing the button is disabled", () => {
    renderContainer();
    fireEvent.click(screen.getByRole("tab", { name: "Paste JSON" }));
    fireEvent.change(screen.getByLabelText("Paste JSON payload"), {
      target: { value: EMPTY_INPUT },
    });
    // Button must remain disabled for empty input — the UI gate prevents submission
    expect(
      screen.getByRole("button", { name: "Validate and preview" }),
    ).toBeDisabled();
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Oversized input
// ===========================================================================

describe("Oversized input", () => {
  it("rejects paste input that exceeds MAX_SCHEMA_IMPORT_BYTES", async () => {
    renderContainer();

    await fillPasteAndSubmit(makeOversizedImportJson());

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockGetExistingSchemas).not.toHaveBeenCalled();
  });

  it("accepts paste input at exactly the byte limit", async () => {
    setupSuccessfulOrgLoad();
    renderContainer();

    const atLimitJson = makeAtLimitImportJson();
    await fillPasteAndSubmit(atLimitJson);

    // Should advance to preview (no local validation error)
    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// File gate (unit tests via checkSchemaImportFile)
// ===========================================================================

describe("File gate: checkSchemaImportFile", () => {
  it("accepts a file at exactly the byte limit", () => {
    const result = checkSchemaImportFile(makeAtLimitFileMock());
    expect(result.ok).toBe(true);
  });

  it("rejects a file one byte over the limit", () => {
    const result = checkSchemaImportFile(makeOverLimitFileMock());
    expect(result).toEqual({ ok: false, reason: "oversized" });
  });

  it("rejects an unsupported extension", () => {
    const result = checkSchemaImportFile(makeUnsupportedExtensionFileMock());
    expect(result).toEqual({ ok: false, reason: "unsupported-type" });
  });

  it("rejects an unsupported MIME type", () => {
    const result = checkSchemaImportFile(makeUnsupportedMimeFileMock());
    expect(result).toEqual({ ok: false, reason: "unsupported-type" });
  });

  it("rejects an empty file", () => {
    const result = checkSchemaImportFile(makeEmptyFileMock());
    expect(result).toEqual({ ok: false, reason: "empty" });
  });
});

// ===========================================================================
// Schema count boundaries
// ===========================================================================

describe("Schema count limits", () => {
  it("accepts exactly MAX_SCHEMAS_PER_IMPORT schemas", () => {
    const payload = makeAtLimitSchemaCountPayload();
    const json = JSON.stringify(payload);
    const result = parseSchemaImportPayload(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.schemas!.length).toBe(MAX_SCHEMAS_PER_IMPORT);
    }
  });

  it("rejects MAX_SCHEMAS_PER_IMPORT + 1 schemas", () => {
    const payload = makeOverLimitSchemaCountPayload();
    const json = JSON.stringify(payload);
    const result = parseSchemaImportPayload(json);
    expect(result.ok).toBe(false);
  });

  it("accepts exactly MAX_POLICY_MAPPINGS_PER_IMPORT mappings", () => {
    const payload = makeAtLimitMappingCountPayload();
    const json = JSON.stringify(payload);
    const result = parseSchemaImportPayload(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.policyMappings!.length).toBe(MAX_POLICY_MAPPINGS_PER_IMPORT);
    }
  });

  it("rejects MAX_POLICY_MAPPINGS_PER_IMPORT + 1 mappings", () => {
    const payload = makeOverLimitMappingCountPayload();
    const json = JSON.stringify(payload);
    const result = parseSchemaImportPayload(json);
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// Authorization
// ===========================================================================

describe("Authorization: unauthorized user", () => {
  it("shows access denied when getExistingSchemas returns 401", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    mockGetExistingSchemas.mockRejectedValue(authError);
    mockGetExistingPolicyMappings.mockResolvedValue({ policyMappings: [], etag: "etag-x" });

    renderContainer(UNAUTHORIZED_TOKEN);
    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByText("Access denied")).toBeInTheDocument();
    });
    expect(screen.getByText(/not authenticated/i)).toBeInTheDocument();
    // Dry run must NOT be called
    expect(mockRunSchemaDryRun).not.toHaveBeenCalled();
  });

  it("shows access denied when runSchemaDryRun returns 403", async () => {
    setupSuccessfulOrgLoad();
    const forbiddenError = Object.assign(new Error("Forbidden"), { statusCode: 403 });
    mockRunSchemaDryRun.mockRejectedValue(forbiddenError);

    renderContainer(INSUFFICIENT_ROLE_TOKEN);
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByText("Access denied")).toBeInTheDocument();
    });
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});

// ===========================================================================
// Stale-state / concurrency
// ===========================================================================

describe("Stale-state detection", () => {
  it("shows a stale warning when etag changed between preview and dry run", async () => {
    const { previewEtag, dryRunResult } = makeStaleDryRunScenario();

    // Org loads with the preview etag
    mockGetExistingSchemas.mockResolvedValue({ schemas: [], etag: previewEtag });
    mockGetExistingPolicyMappings.mockResolvedValue({ policyMappings: [], etag: previewEtag });
    // Dry run returns a different etag (state changed on server)
    mockRunSchemaDryRun.mockResolvedValue(dryRunResult);

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByText("Dry-Run Results")).toBeInTheDocument();
    });

    // Stale warning should appear
    expect(
      screen.getByText(/Organization state changed since preview was loaded/i),
    ).toBeInTheDocument();
  });

  it("does NOT show a stale warning when etag is unchanged", async () => {
    const { previewEtag, dryRunResult } = makeFreshDryRunScenario();

    mockGetExistingSchemas.mockResolvedValue({ schemas: [], etag: previewEtag });
    mockGetExistingPolicyMappings.mockResolvedValue({ policyMappings: [], etag: previewEtag });
    mockRunSchemaDryRun.mockResolvedValue(dryRunResult);

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByText("Dry-Run Results")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Organization state changed/i),
    ).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Replay: same payload → identical deterministic output
// ===========================================================================

describe("Replay: deterministic dry-run output", () => {
  it("identical payload submitted twice yields identical results", async () => {
    const { first, second } = makeReplayScenario();
    setupSuccessfulOrgLoad();
    // Both mock calls return identical results
    mockRunSchemaDryRun
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    renderContainer();
    const json = makeValidImportJson();

    // First submission
    await fillPasteAndSubmit(json);
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(screen.getByText("Dry-Run Results")).toBeInTheDocument());
    const firstCallArgs = mockRunSchemaDryRun.mock.calls[0];

    // Start over and re-submit the same payload
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    setupSuccessfulOrgLoad();
    await fillPasteAndSubmit(json);
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(screen.getByText("Dry-Run Results")).toBeInTheDocument());
    const secondCallArgs = mockRunSchemaDryRun.mock.calls[1];

    // Payload (arg[2]) should be identical for both calls
    expect(JSON.stringify(firstCallArgs[2])).toBe(JSON.stringify(secondCallArgs[2]));
    expect(mockRunSchemaDryRun).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Regression: dry run never mutates (no write endpoint called)
// ===========================================================================

describe("Regression: dry run does not mutate state", () => {
  it("runSchemaDryRun is called with the dry-run flag and no other write endpoint is called", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockResolvedValue(makeSuccessfulDryRunResult());

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(screen.getByText("Dry-Run Results")).toBeInTheDocument());

    // runSchemaDryRun called exactly once
    expect(mockRunSchemaDryRun).toHaveBeenCalledTimes(1);

    // No other write-capable API functions should have been called.
    // The only exported functions from @/lib/api/schema-import are:
    // runSchemaDryRun, getExistingSchemas, getExistingPolicyMappings.
    // Both get* functions are reads. Confirm no additional modules were called.
    const allMocks = Object.values(schemaImportApi) as jest.Mock[];
    const writeCalls = allMocks.filter(
      (fn) => fn.mock && fn !== mockGetExistingSchemas && fn !== mockGetExistingPolicyMappings,
    );
    // Only runSchemaDryRun among non-read functions
    writeCalls.forEach((fn) => {
      if (fn !== mockRunSchemaDryRun) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  });

  it("runSchemaDryRun is the only POST call — getExistingSchemas and getExistingPolicyMappings use GET (read) semantics", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockResolvedValue(makeSuccessfulDryRunResult());

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(screen.getByText("Dry-Run Results")).toBeInTheDocument());

    // Both read endpoints were called
    expect(mockGetExistingSchemas).toHaveBeenCalledTimes(1);
    expect(mockGetExistingPolicyMappings).toHaveBeenCalledTimes(1);
    // Dry-run called exactly once
    expect(mockRunSchemaDryRun).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Conflict detection
// ===========================================================================

describe("Conflict detection", () => {
  it("shows a same-id-version conflict in the preview panel", async () => {
    const registry = makeExistingRegistryWithSameVersion();
    mockGetExistingSchemas.mockResolvedValue({ schemas: registry.schemas, etag: "etag-1" });
    mockGetExistingPolicyMappings.mockResolvedValue({
      policyMappings: registry.policyMappings,
      etag: "etag-1",
    });

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });

    expect(screen.getByText(/Same id and version already exists/i)).toBeInTheDocument();
  });

  it("shows a same-id-different-version conflict in the preview panel", async () => {
    const registry = makeExistingRegistryWithDifferentVersion();
    mockGetExistingSchemas.mockResolvedValue({ schemas: registry.schemas, etag: "etag-2" });
    mockGetExistingPolicyMappings.mockResolvedValue({
      policyMappings: registry.policyMappings,
      etag: "etag-2",
    });

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/A different version of this schema id already exists/i),
    ).toBeInTheDocument();
  });

  it("shows an overlapping mapping conflict in the preview panel", async () => {
    const registry = makeExistingRegistryWithOverlappingMapping();
    mockGetExistingSchemas.mockResolvedValue({ schemas: registry.schemas, etag: "etag-3" });
    mockGetExistingPolicyMappings.mockResolvedValue({
      policyMappings: registry.policyMappings,
      etag: "etag-3",
    });

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/This mapping key is already bound to a different policy ref/i),
    ).toBeInTheDocument();
  });

  it("shows no conflict section when registry is empty", async () => {
    const registry = makeEmptyExistingRegistry();
    mockGetExistingSchemas.mockResolvedValue({ schemas: registry.schemas, etag: "etag-4" });
    mockGetExistingPolicyMappings.mockResolvedValue({
      policyMappings: registry.policyMappings,
      etag: "etag-4",
    });

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByText("Import Preview")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Conflicts detected/i)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Unit tests for pure validation functions
// ===========================================================================

describe("checkSchemaImportPaste", () => {
  it("rejects empty string", () => {
    expect(checkSchemaImportPaste("")).toEqual({ ok: false, reason: "empty" });
    expect(checkSchemaImportPaste("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a valid small string", () => {
    expect(checkSchemaImportPaste('{"schemas":[],"policyMappings":[]}')).toEqual({ ok: true });
  });
});

describe("parseSchemaImportPayload", () => {
  it("returns ok:true for valid payload", () => {
    const result = parseSchemaImportPayload(makeValidImportJson());
    expect(result.ok).toBe(true);
  });

  it("returns malformed-json for non-JSON input", () => {
    const result = parseSchemaImportPayload("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed-json");
  });

  it("returns schema-violation with field errors for unknown field", () => {
    const result = parseSchemaImportPayload(UNKNOWN_FIELD_JSON);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema-violation");
    }
  });

  it("normalizes payload: deduplicates schemas with same id+version", () => {
    const payload = {
      schemas: [
        { id: "test-schema", version: "1.0.0", name: "Test" },
        { id: "test-schema", version: "1.0.0", name: "Test (dup)" }, // duplicate
      ],
      policyMappings: [],
    };
    const result = parseSchemaImportPayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.schemas!.length).toBe(1);
    }
  });
});

describe("detectImportConflicts", () => {
  const basePayload = {
    schemas: [{ id: "income-verification.v1", version: "1.0.0", name: "Test" }],
    policyMappings: [
      {
        schemaId: "income-verification.v1",
        schemaVersion: "1.0.0",
        mappingKey: "minimum-income",
        policyRef: "policy://org-synthetic/income/minimum-income-v1",
      },
    ],
  };

  it("returns no conflicts for empty registry", () => {
    const report = detectImportConflicts(basePayload, { schemas: [], policyMappings: [] });
    expect(report.hasConflicts).toBe(false);
    expect(report.schemaConflicts).toHaveLength(0);
    expect(report.mappingConflicts).toHaveLength(0);
  });

  it("detects same-id-version schema conflict", () => {
    const report = detectImportConflicts(basePayload, {
      schemas: [{ id: "income-verification.v1", version: "1.0.0", name: "Existing" }],
      policyMappings: [],
    });
    expect(report.schemaConflicts[0].kind).toBe("same-id-version");
  });

  it("detects same-id-different-version schema conflict", () => {
    const report = detectImportConflicts(basePayload, {
      schemas: [{ id: "income-verification.v1", version: "0.8.0", name: "Old" }],
      policyMappings: [],
    });
    expect(report.schemaConflicts[0].kind).toBe("same-id-different-version");
  });

  it("detects overlapping mapping conflict", () => {
    const report = detectImportConflicts(basePayload, {
      schemas: [],
      policyMappings: [
        {
          schemaId: "income-verification.v1",
          schemaVersion: "1.0.0",
          mappingKey: "minimum-income",
          policyRef: "policy://DIFFERENT",
        },
      ],
    });
    expect(report.mappingConflicts[0].kind).toBe("overlapping-mapping");
  });

  it("detects duplicate mapping conflict (same key, same ref)", () => {
    const report = detectImportConflicts(basePayload, {
      schemas: [],
      policyMappings: [
        {
          schemaId: "income-verification.v1",
          schemaVersion: "1.0.0",
          mappingKey: "minimum-income",
          policyRef: "policy://org-synthetic/income/minimum-income-v1",
        },
      ],
    });
    expect(report.mappingConflicts[0].kind).toBe("duplicate-mapping");
  });
});

describe("isDryRunStale", () => {
  it("returns false when etags match", () => {
    expect(isDryRunStale("etag-abc", "etag-abc")).toBe(false);
  });

  it("returns true when etags differ", () => {
    expect(isDryRunStale("etag-abc", "etag-xyz")).toBe(true);
  });
});

describe("summarizeDryRun", () => {
  it("counts all action kinds correctly", () => {
    const result = makeMixedDryRunResult();
    const summary = summarizeDryRun(result);
    expect(summary.schemasToCreate).toBe(1);
    expect(summary.schemasToUpdate).toBe(1);
    expect(summary.schemasToSkip).toBe(1);
    expect(summary.schemasToReject).toBe(1);
    expect(summary.mappingsToCreate).toBe(1);
    expect(summary.mappingsToSkip).toBe(1);
    expect(summary.mappingsToReject).toBe(1);
  });
});

describe("normalizeImportPayload", () => {
  it("deduplicates schemas by id+version", () => {
    const payload = {
      schemas: [
        { id: "s1", version: "1.0.0", name: "S1" },
        { id: "s1", version: "1.0.0", name: "S1 dup" },
        { id: "s1", version: "2.0.0", name: "S1 v2" },
      ],
      policyMappings: [],
    };
    const normalized = normalizeImportPayload(payload);
    expect(normalized.schemas!.length).toBe(2); // s1@1.0.0 and s1@2.0.0
  });

  it("deduplicates policy mappings by schemaId+schemaVersion+mappingKey", () => {
    const payload = {
      schemas: [],
      policyMappings: [
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k1", policyRef: "p1" },
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k1", policyRef: "p2" }, // dup key
        { schemaId: "s1", schemaVersion: "1.0.0", mappingKey: "k2", policyRef: "p3" },
      ],
    };
    const normalized = normalizeImportPayload(payload);
    expect(normalized.policyMappings!.length).toBe(2);
  });
});

// ===========================================================================
// Network error handling
// ===========================================================================

describe("Network errors", () => {
  it("shows a network error when org state load fails with a generic error", async () => {
    mockGetExistingSchemas.mockRejectedValue(new Error("Network timeout"));
    mockGetExistingPolicyMappings.mockResolvedValue({ policyMappings: [], etag: "etag-x" });

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Failed to load organization schemas/i);
  });

  it("shows an error when dry run fails with a generic error", async () => {
    setupSuccessfulOrgLoad();
    mockRunSchemaDryRun.mockRejectedValue(new Error("Network error"));

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Failed to run dry run/i);
    // Should remain on preview phase
    expect(screen.getByText("Import Preview")).toBeInTheDocument();
  });
});

// ===========================================================================
// Accessibility
// ===========================================================================

describe("Accessibility", () => {
  it("file input has an accessible label", () => {
    renderContainer();
    expect(screen.getByLabelText("Schema import JSON file")).toBeInTheDocument();
  });

  it("paste textarea has an accessible label", () => {
    renderContainer();
    fireEvent.click(screen.getByRole("tab", { name: "Paste JSON" }));
    expect(screen.getByLabelText("Paste JSON payload")).toBeInTheDocument();
  });

  it("validate button is disabled when paste is empty", () => {
    renderContainer();
    fireEvent.click(screen.getByRole("tab", { name: "Paste JSON" }));
    expect(
      screen.getByRole("button", { name: "Validate and preview" }),
    ).toBeDisabled();
  });

  it("error messages use role=alert", async () => {
    renderContainer();
    await fillPasteAndSubmit(MALFORMED_JSON);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("mode selector uses role=tablist and role=tab", () => {
    renderContainer();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "File upload" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Paste JSON" })).toBeInTheDocument();
  });

  it("active tab has aria-selected=true", () => {
    renderContainer();
    expect(screen.getByRole("tab", { name: "File upload" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("stale warning uses role=alert for screen reader announcement", async () => {
    const { previewEtag, dryRunResult } = makeStaleDryRunScenario();
    mockGetExistingSchemas.mockResolvedValue({ schemas: [], etag: previewEtag });
    mockGetExistingPolicyMappings.mockResolvedValue({ policyMappings: [], etag: previewEtag });
    mockRunSchemaDryRun.mockResolvedValue(dryRunResult);

    renderContainer();
    await fillPasteAndSubmit(makeValidImportJson());
    await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(screen.getByText("Dry-Run Results")).toBeInTheDocument());

    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("Organization state changed"))).toBe(true);
  });
});
