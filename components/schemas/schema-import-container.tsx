"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SchemaImportForm } from "./schema-import-form";
import { SchemaPreviewPanel } from "./schema-preview-panel";
import { DryRunResultsPanel } from "./dry-run-results-panel";
import { detectImportConflicts } from "@/lib/validation/schema-import";
import { runSchemaDryRun, getExistingSchemas, getExistingPolicyMappings } from "@/lib/api/schema-import";
import { ApiError } from "@/lib/errors";
import type {
  SchemaImportPayload,
  ConflictReport,
  DryRunResult,
  ExistingSchema,
  ExistingPolicyMapping,
} from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaImportContainerProps = {
  token: string;
  organizationId: string;
};

type Phase = "input" | "preview" | "dry-run-results";

interface OrgState {
  schemas: ExistingSchema[];
  policyMappings: ExistingPolicyMapping[];
  /** Etag captured when this state was loaded — used for stale detection. */
  etag: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Schema Import Container
 *
 * Orchestrates the three-phase import validation and dry-run flow:
 *
 *   input ──► preview ──► dry-run-results
 *     ▲                         │
 *     └─────────── reset ───────┘
 *
 * Phase transitions:
 *  1. input → preview: when a valid payload is received from SchemaImportForm
 *  2. preview → dry-run-results: when "Run dry run" is clicked
 *  3. any → input: "Start over" resets all state
 *
 * Security invariants enforced here:
 *  - The dry-run API call uses `runSchemaDryRun` which sets `X-Dry-Run: true`
 *  - There is NO commit/import button — this container cannot trigger a write
 *  - No untrusted content from the payload is rendered as HTML
 *
 * Accessibility:
 *  - Phase changes move focus to the new region heading
 *  - Errors use role="alert" and aria-live="assertive"
 *  - Loading state is announced with aria-live="polite"
 *  - Authorization errors show a clear "Access denied" state
 */
export function SchemaImportContainer({
  token,
  organizationId,
}: SchemaImportContainerProps) {
  const [phase, setPhase] = useState<Phase>("input");
  const [payload, setPayload] = useState<SchemaImportPayload | null>(null);
  const [orgState, setOrgState] = useState<OrgState | null>(null);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [isLoadingOrgState, setIsLoadingOrgState] = useState(false);
  const [isRunningDryRun, setIsRunningDryRun] = useState(false);
  const [apiError, setApiError] = useState<{
    message: string;
    type: "authorization" | "network" | "server" | "unknown";
  } | null>(null);

  // Ref for focus management on phase transition — attached to the container
  // wrapper div so focus moves to the top of the new content region.
  const phaseRegionRef = useRef<HTMLDivElement>(null);

  // Focus the container top whenever the phase changes (after DOM update)
  useEffect(() => {
    if (phase !== "input") {
      setTimeout(() => {
        phaseRegionRef.current?.focus();
      }, 0);
    }
  }, [phase]);

  // ---------------------------------------------------------------------------
  // Load org state (schemas + mappings) for conflict detection
  // ---------------------------------------------------------------------------

  const loadOrgState = useCallback(
    async (signal: AbortSignal): Promise<OrgState | null> => {
      setIsLoadingOrgState(true);
      setApiError(null);
      try {
        const [schemasResp, mappingsResp] = await Promise.all([
          getExistingSchemas(token, organizationId, signal),
          getExistingPolicyMappings(token, organizationId, signal),
        ]);
        // Use the schemas etag as the canonical org-state marker
        const etag = schemasResp.etag;
        return {
          schemas: schemasResp.schemas,
          policyMappings: mappingsResp.policyMappings,
          etag,
        };
      } catch (err) {
        if (signal.aborted) return null;
        // ApiError uses `.status`; raw test mocks may attach `.statusCode`
        const statusCode =
          err instanceof ApiError
            ? err.status
            : (err as Error & { statusCode?: number }).statusCode;
        if (statusCode === 401 || statusCode === 403) {
          setApiError({
            message:
              statusCode === 401
                ? "You are not authenticated. Please sign in."
                : "You do not have permission to access the schema registry.",
            type: "authorization",
          });
        } else {
          setApiError({
            message: "Failed to load organization schemas. Please try again.",
            type: "network",
          });
        }
        return null;
      } finally {
        setIsLoadingOrgState(false);
      }
    },
    [token, organizationId],
  );

  // ---------------------------------------------------------------------------
  // Phase: input → preview
  // ---------------------------------------------------------------------------

  const handleValidPayload = useCallback(
    async (validPayload: SchemaImportPayload) => {
      setApiError(null);
      setPayload(validPayload);

      const controller = new AbortController();
      const state = await loadOrgState(controller.signal);
      if (!state) return; // error already set

      setOrgState(state);

      const conflictReport = detectImportConflicts(validPayload, {
        schemas: state.schemas,
        policyMappings: state.policyMappings,
      });
      setConflicts(conflictReport);
      setPhase("preview");
    },
    [loadOrgState],
  );

  // ---------------------------------------------------------------------------
  // Phase: preview → dry-run-results
  // ---------------------------------------------------------------------------

  const handleRunDryRun = useCallback(async () => {
    if (!payload) return;
    setIsRunningDryRun(true);
    setApiError(null);

    const controller = new AbortController();
    try {
      const result = await runSchemaDryRun(token, organizationId, payload, controller.signal);
      setDryRunResult(result);
      setPhase("dry-run-results");
    } catch (err) {
      // ApiError uses `.status`; test mocks may attach `.statusCode`
      const statusCode =
        err instanceof ApiError
          ? err.status
          : (err as Error & { statusCode?: number }).statusCode;
      if (statusCode === 401 || statusCode === 403) {
        setApiError({
          message:
            statusCode === 401
              ? "Your session has expired. Please sign in again."
              : "You do not have permission to run a schema dry run.",
          type: "authorization",
        });
      } else if (err instanceof ApiError) {
        setApiError({
          message: `Server rejected the dry run: ${err.message}`,
          type: "server",
        });
      } else {
        setApiError({
          message: "Failed to run dry run. Please check your connection and try again.",
          type: "network",
        });
      }
    } finally {
      setIsRunningDryRun(false);
    }
  }, [token, organizationId, payload]);

  // ---------------------------------------------------------------------------
  // Resets
  // ---------------------------------------------------------------------------

  const handleStartOver = useCallback(() => {
    setPhase("input");
    setPayload(null);
    setOrgState(null);
    setConflicts(null);
    setDryRunResult(null);
    setApiError(null);
  }, []);

  const handleRevisePreview = useCallback(() => {
    setPhase("preview");
    setDryRunResult(null);
    setApiError(null);
  }, []);

  const handleBackToInput = useCallback(() => {
    setPhase("input");
    setDryRunResult(null);
    setApiError(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Authorization denied — show a dedicated, clear denied state
  // ---------------------------------------------------------------------------

  if (apiError?.type === "authorization") {
    return (
      <div
        ref={phaseRegionRef}
        tabIndex={-1}
        className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-6 focus:outline-none"
      >
        <h2 className="text-lg font-semibold text-rose-200">
          Access denied
        </h2>
        <p className="mt-2 text-sm text-rose-200">{apiError.message}</p>
        <button
          type="button"
          onClick={handleStartOver}
          className="mt-4 h-9 rounded-md border border-rose-300/30 px-4 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 transition"
        >
          Start over
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading org state
  // ---------------------------------------------------------------------------

  if (isLoadingOrgState) {
    return (
      <div aria-live="polite" className="rounded-lg border border-white/10 bg-white/[0.02] p-8 text-center">
        <p className="text-sm text-slate-300">Loading organization schemas…</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render active phase
  // ---------------------------------------------------------------------------

  return (
    <div ref={phaseRegionRef} tabIndex={-1} className="grid gap-6 focus:outline-none">
      {/* Non-auth API errors */}
      {apiError && apiError.type !== "authorization" && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4"
        >
          <p className="text-sm text-rose-200">{apiError.message}</p>
        </div>
      )}

      {phase === "input" && (
        <SchemaImportForm onValidPayload={handleValidPayload} />
      )}

      {phase === "preview" && payload && conflicts && (
        <SchemaPreviewPanel
          payload={payload}
          conflicts={conflicts}
          onRunDryRun={handleRunDryRun}
          onBack={handleBackToInput}
          isRunningDryRun={isRunningDryRun}
        />
      )}

      {phase === "dry-run-results" && dryRunResult && (
        <DryRunResultsPanel
          result={dryRunResult}
          previewEtag={orgState?.etag ?? ""}
          onStartOver={handleStartOver}
          onRevisePreview={handleRevisePreview}
        />
      )}
    </div>
  );
}
