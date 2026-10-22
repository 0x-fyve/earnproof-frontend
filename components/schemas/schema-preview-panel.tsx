"use client";

import {
  schemaConflictLabel,
  mappingConflictLabel,
} from "@/lib/validation/schema-import";
import type {
  SchemaImportPayload,
  ConflictReport,
} from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaPreviewPanelProps = {
  payload: SchemaImportPayload;
  conflicts: ConflictReport;
  /** Called when the user confirms the preview and wants to run the dry run. */
  onRunDryRun: () => void;
  /** Called when the user wants to change the input. */
  onBack: () => void;
  isRunningDryRun: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Schema Preview Panel
 *
 * Displays the canonical (normalized) form of the import payload and any
 * detected conflicts with existing org schemas/mappings.
 *
 * This is a display-only panel — the actual dry-run request is triggered via
 * the onRunDryRun callback.  No write operation is performed here.
 *
 * Accessibility:
 *  - Sections use landmark headings
 *  - Conflict list uses role="list" and aria-label
 *  - The "Run dry run" button is labeled and keyboard-operable
 *  - Status text uses aria-live so screen readers announce state changes
 */
export function SchemaPreviewPanel({
  payload,
  conflicts,
  onRunDryRun,
  onBack,
  isRunningDryRun,
}: SchemaPreviewPanelProps) {
  const schemaCount = payload.schemas?.length ?? 0;
  const mappingCount = payload.policyMappings?.length ?? 0;
  const conflictCount =
    conflicts.schemaConflicts.length + conflicts.mappingConflicts.length;

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Import Preview</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Review the normalized canonical form below. Conflicts with your organization&apos;s
          existing schemas and mappings are highlighted. Run a dry run to see the server&apos;s
          evaluation without making any changes.
        </p>
      </div>

      {/* Summary counts */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Schemas", value: schemaCount },
          { label: "Mappings", value: mappingCount },
          { label: "Conflicts", value: conflictCount, warn: conflictCount > 0 },
        ].map(({ label, value, warn }) => (
          <div
            key={label}
            className={`rounded-lg border p-4 ${
              warn
                ? "border-amber-300/30 bg-amber-300/5"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <dt className="text-xs font-medium text-slate-400">{label}</dt>
            <dd className={`mt-1 text-2xl font-semibold ${warn ? "text-amber-200" : "text-white"}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Conflict warnings */}
      {conflicts.hasConflicts && (
        <section aria-labelledby="conflicts-heading">
          <h3
            id="conflicts-heading"
            className="mb-3 text-sm font-semibold text-amber-200"
          >
            Conflicts detected — these will be shown in the dry-run results
          </h3>

          {conflicts.schemaConflicts.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Schema conflicts
              </h4>
              <ul role="list" aria-label="Schema conflicts" className="grid gap-2">
                {conflicts.schemaConflicts.map((c, i) => (
                  <li
                    key={`sc-${i}`}
                    className="rounded-md border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm"
                  >
                    <p className="font-medium text-amber-200">
                      {schemaConflictLabel(c.kind)}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Incoming:{" "}
                      <span className="font-mono text-white">
                        {c.incoming.id}@{c.incoming.version}
                      </span>{" "}
                      · Existing:{" "}
                      <span className="font-mono text-white">
                        {c.existing.id}@{c.existing.version}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflicts.mappingConflicts.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Mapping conflicts
              </h4>
              <ul role="list" aria-label="Mapping conflicts" className="grid gap-2">
                {conflicts.mappingConflicts.map((c, i) => (
                  <li
                    key={`mc-${i}`}
                    className="rounded-md border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm"
                  >
                    <p className="font-medium text-amber-200">
                      {mappingConflictLabel(c.kind)}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Key:{" "}
                      <span className="font-mono text-white">{c.incoming.mappingKey}</span> ·
                      Incoming ref:{" "}
                      <span className="font-mono text-white">{c.incoming.policyRef}</span> ·
                      Existing ref:{" "}
                      <span className="font-mono text-white">{c.existing.policyRef}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Normalized schemas */}
      {schemaCount > 0 && (
        <section aria-labelledby="schemas-preview-heading">
          <h3
            id="schemas-preview-heading"
            className="mb-3 text-sm font-semibold text-slate-200"
          >
            Schemas ({schemaCount})
          </h3>
          <ul role="list" aria-label="Schema entries in import" className="grid gap-2">
            {(payload.schemas ?? []).map((schema) => (
              <li
                key={`${schema.id}@${schema.version}`}
                className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{schema.name}</span>
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-300">
                    {schema.id}
                  </span>
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-xs text-cyan-300">
                    v{schema.version}
                  </span>
                </div>
                {schema.description && (
                  <p className="mt-1 text-xs text-slate-400">{schema.description}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Normalized policy mappings */}
      {mappingCount > 0 && (
        <section aria-labelledby="mappings-preview-heading">
          <h3
            id="mappings-preview-heading"
            className="mb-3 text-sm font-semibold text-slate-200"
          >
            Policy Mappings ({mappingCount})
          </h3>
          <ul role="list" aria-label="Policy mapping entries in import" className="grid gap-2">
            {(payload.policyMappings ?? []).map((m) => (
              <li
                key={`${m.schemaId}@${m.schemaVersion}:${m.mappingKey}`}
                className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-slate-300">
                    {m.schemaId}@{m.schemaVersion}
                  </span>
                  <span className="text-slate-500">→</span>
                  <span className="font-mono text-cyan-300">{m.mappingKey}</span>
                  <span className="text-slate-500">:</span>
                  <span className="font-mono text-slate-300">{m.policyRef}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={isRunningDryRun}
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50 hover:bg-white/5 transition"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onRunDryRun}
          disabled={isRunningDryRun}
          aria-busy={isRunningDryRun}
          className="h-10 rounded-md bg-cyan-300 px-6 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-cyan-200 transition"
        >
          {isRunningDryRun ? "Running dry run…" : "Run dry run"}
        </button>
      </div>

      {/* Screen-reader announcement for in-progress dry run */}
      {isRunningDryRun && (
        <p aria-live="polite" className="sr-only">
          Dry run in progress. Please wait.
        </p>
      )}
    </div>
  );
}
