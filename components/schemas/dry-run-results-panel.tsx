"use client";

import { dryRunActionLabel, summarizeDryRun, isDryRunStale } from "@/lib/validation/schema-import";
import type { DryRunResult } from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DryRunResultsPanelProps = {
  result: DryRunResult;
  /** Etag captured when the preview was loaded; used for stale-state detection. */
  previewEtag: string;
  /** Called when the user wants to start over with a new import. */
  onStartOver: () => void;
  /** Called when the user wants to revise the preview before re-running. */
  onRevisePreview: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_COLORS: Record<string, { badge: string; row: string }> = {
  create: {
    badge: "bg-emerald-300/10 text-emerald-300 border border-emerald-300/20",
    row: "border-white/10 bg-white/[0.02]",
  },
  update: {
    badge: "bg-cyan-300/10 text-cyan-300 border border-cyan-300/20",
    row: "border-white/10 bg-white/[0.02]",
  },
  skip: {
    badge: "bg-slate-300/10 text-slate-400 border border-slate-300/10",
    row: "border-white/5 bg-transparent",
  },
  reject: {
    badge: "bg-rose-300/10 text-rose-300 border border-rose-300/20",
    row: "border-rose-300/10 bg-rose-300/[0.03]",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dry-Run Results Panel
 *
 * Displays the server's evaluation of what would be created, updated, skipped,
 * or rejected — without having made any mutations.
 *
 * Stale-state detection: if the org's schema registry etag changed between
 * when the preview was loaded and when the dry run was evaluated, a warning
 * banner is shown.  The user can re-run the dry run or revise their input.
 *
 * Accessibility:
 *  - Results sections use landmark headings
 *  - Action badges include text (not just color) for non-color discrimination
 *  - The stale-state banner uses role="alert"
 *  - aria-live announces the stale warning and results availability
 */
export function DryRunResultsPanel({
  result,
  previewEtag,
  onStartOver,
  onRevisePreview,
}: DryRunResultsPanelProps) {
  const summary = summarizeDryRun(result);
  const isStale = isDryRunStale(previewEtag, result.etag);

  const totalSchemas = result.schemas.length;
  const totalMappings = result.policyMappings.length;
  const hasRejections =
    summary.schemasToReject > 0 || summary.mappingsToReject > 0;

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Dry-Run Results</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          This is a preview only. No changes have been made to your organization.
          Review the results below before deciding whether to proceed with an actual import.
        </p>
      </div>

      {/* Stale-state warning */}
      {isStale && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-amber-300/30 bg-amber-300/10 p-4"
        >
          <div className="flex items-start gap-3">
            <svg
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-200"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-100">
                Organization state changed since preview was loaded
              </p>
              <p className="mt-1 text-xs text-amber-200">
                The schema registry was updated between when you loaded the preview and when this
                dry run was evaluated. The results below reflect the current server state. Review
                carefully or revise your input before proceeding.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rejection warning */}
      {hasRejections && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4"
        >
          <p className="text-sm font-semibold text-rose-200">
            Some entries would be rejected
          </p>
          <p className="mt-1 text-xs text-rose-200">
            {summary.schemasToReject > 0 &&
              `${summary.schemasToReject} schema${summary.schemasToReject !== 1 ? "s" : ""} would be rejected. `}
            {summary.mappingsToReject > 0 &&
              `${summary.mappingsToReject} mapping${summary.mappingsToReject !== 1 ? "s" : ""} would be rejected. `}
            Check the reasons below and fix your input before re-running.
          </p>
        </div>
      )}

      {/* Summary table */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Would create", schemas: summary.schemasToCreate, mappings: summary.mappingsToCreate, color: "text-emerald-300" },
          { label: "Would update", schemas: summary.schemasToUpdate, mappings: summary.mappingsToUpdate, color: "text-cyan-300" },
          { label: "Would skip", schemas: summary.schemasToSkip, mappings: summary.mappingsToSkip, color: "text-slate-400" },
          { label: "Would reject", schemas: summary.schemasToReject, mappings: summary.mappingsToReject, color: "text-rose-300" },
        ].map(({ label, schemas, mappings, color }) => (
          <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs font-medium text-slate-400">{label}</dt>
            <dd className={`mt-1 text-xl font-semibold ${color}`}>
              {schemas + mappings}
              <span className="ml-1 text-xs font-normal text-slate-500">
                ({schemas} schema{schemas !== 1 ? "s" : ""} / {mappings} mapping{mappings !== 1 ? "s" : ""})
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {/* Schema results */}
      {totalSchemas > 0 && (
        <section aria-labelledby="dry-run-schemas-heading">
          <h3
            id="dry-run-schemas-heading"
            className="mb-3 text-sm font-semibold text-slate-200"
          >
            Schema Results ({totalSchemas})
          </h3>
          <ul role="list" aria-label="Dry-run schema results" className="grid gap-2">
            {result.schemas.map((entry, i) => {
              const colors = ACTION_COLORS[entry.action] ?? ACTION_COLORS.skip;
              return (
                <li
                  key={`drs-${i}`}
                  className={`rounded-md border px-4 py-3 ${colors.row}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${colors.badge}`}
                      aria-label={`Action: ${dryRunActionLabel(entry.action)}`}
                    >
                      {dryRunActionLabel(entry.action)}
                    </span>
                    <span className="font-medium text-white">{entry.schema.name}</span>
                    <span className="font-mono text-xs text-slate-400">
                      {entry.schema.id}@{entry.schema.version}
                    </span>
                  </div>
                  {entry.existingVersion && (
                    <p className="mt-1 text-xs text-slate-400">
                      Replaces existing version{" "}
                      <span className="font-mono text-slate-300">{entry.existingVersion}</span>
                    </p>
                  )}
                  {entry.rejectReason && (
                    <p className="mt-1 text-xs text-rose-300">
                      Reason: {entry.rejectReason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Mapping results */}
      {totalMappings > 0 && (
        <section aria-labelledby="dry-run-mappings-heading">
          <h3
            id="dry-run-mappings-heading"
            className="mb-3 text-sm font-semibold text-slate-200"
          >
            Mapping Results ({totalMappings})
          </h3>
          <ul role="list" aria-label="Dry-run mapping results" className="grid gap-2">
            {result.policyMappings.map((entry, i) => {
              const colors = ACTION_COLORS[entry.action] ?? ACTION_COLORS.skip;
              return (
                <li
                  key={`drm-${i}`}
                  className={`rounded-md border px-4 py-3 ${colors.row}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${colors.badge}`}
                      aria-label={`Action: ${dryRunActionLabel(entry.action)}`}
                    >
                      {dryRunActionLabel(entry.action)}
                    </span>
                    <span className="font-mono text-slate-300">
                      {entry.mapping.schemaId}@{entry.mapping.schemaVersion}
                    </span>
                    <span className="text-slate-500">→</span>
                    <span className="font-mono text-cyan-300">{entry.mapping.mappingKey}</span>
                  </div>
                  {entry.existingPolicyRef && (
                    <p className="mt-1 text-xs text-slate-400">
                      Currently mapped to:{" "}
                      <span className="font-mono text-slate-300">{entry.existingPolicyRef}</span>
                    </p>
                  )}
                  {entry.rejectReason && (
                    <p className="mt-1 text-xs text-rose-300">
                      Reason: {entry.rejectReason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Metadata */}
      <p className="text-xs text-slate-500">
        Dry run evaluated at{" "}
        {new Date(result.generatedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        . No changes were made.
      </p>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={onRevisePreview}
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white hover:bg-white/5 transition"
        >
          Revise and re-run
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
        >
          Start over
        </button>
      </div>

      {/* Screen reader announcement */}
      <p aria-live="polite" className="sr-only">
        Dry-run results are now available. No changes were made to your organization.
        {isStale ? " Warning: the organization state changed since the preview was loaded." : ""}
      </p>
    </div>
  );
}
