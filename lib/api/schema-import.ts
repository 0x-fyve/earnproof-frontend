/**
 * API client functions for schema import dry-run.
 *
 * IMPORTANT: This module exposes ONLY read and dry-run operations.
 *
 * - `runSchemaDryRun` sends POST /schemas/dry-run with the header
 *   `X-Dry-Run: true`.  The server MUST NOT mutate state on this path.
 * - `getExistingSchemas` and `getExistingPolicyMappings` fetch the org's
 *   current registry so the client can detect conflicts before the request.
 *
 * There is intentionally no "commit" or "import" function here.  The actual
 * import commit flow is out of scope for this feature (issue #280); if it
 * is added in the future it must live in a separate module and MUST require
 * a successful dry-run etag to gate the write.
 */

import { apiClient, bearer, retryRead, retryMutation } from "./client";
import type {
  SchemaImportPayload,
  DryRunResult,
  ExistingSchema,
  ExistingPolicyMapping,
} from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** List response for the org's schema registry. */
export interface ListSchemasResponse {
  schemas: ExistingSchema[];
  /** Org-state etag at the time this list was fetched. */
  etag: string;
}

/** List response for the org's policy mappings. */
export interface ListPolicyMappingsResponse {
  policyMappings: ExistingPolicyMapping[];
  etag: string;
}

// ---------------------------------------------------------------------------
// Read — existing org state for conflict detection and stale-state check
// ---------------------------------------------------------------------------

/**
 * Fetch the org's existing schema registry.
 * Used to populate the conflict-detection panel before submission.
 */
export async function getExistingSchemas(
  token: string,
  organizationId: string,
  signal: AbortSignal,
): Promise<ListSchemasResponse> {
  return retryRead(async (signal) => {
    return apiClient<ListSchemasResponse>({
      path: `/organizations/${organizationId}/schemas`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Fetch the org's existing policy mappings.
 * Used to populate the conflict-detection panel before submission.
 */
export async function getExistingPolicyMappings(
  token: string,
  organizationId: string,
  signal: AbortSignal,
): Promise<ListPolicyMappingsResponse> {
  return retryRead(async (signal) => {
    return apiClient<ListPolicyMappingsResponse>({
      path: `/organizations/${organizationId}/schemas/policy-mappings`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

// ---------------------------------------------------------------------------
// Dry run — never mutates state
// ---------------------------------------------------------------------------

/**
 * Submit the import payload for a dry run.
 *
 * The `X-Dry-Run: true` header signals the server that this is a
 * preview-only evaluation.  The server MUST NOT mutate any state and MUST
 * return a `DryRunResult` describing what WOULD happen.
 *
 * `retryMutation` is used (single attempt, no auto-retry) because the
 * idempotency of the dry-run path cannot be guaranteed externally — two
 * identical payloads MUST produce identical results (deterministic) but we
 * don't retry automatically to avoid confusing duplicate in-flight requests.
 *
 * The caller is responsible for ensuring this function is never called from
 * a path that could write state.  No commit/import endpoint is exposed from
 * this module.
 */
export async function runSchemaDryRun(
  token: string,
  organizationId: string,
  payload: SchemaImportPayload,
  signal: AbortSignal,
): Promise<DryRunResult> {
  return retryMutation(async (signal) => {
    return apiClient<DryRunResult>({
      path: `/organizations/${organizationId}/schemas/dry-run`,
      method: "POST",
      headers: {
        ...bearer(token),
        /** Signals the server: DO NOT mutate — return a preview only. */
        "X-Dry-Run": "true",
      },
      body: JSON.stringify(payload),
      signal,
    });
  }, signal);
}
