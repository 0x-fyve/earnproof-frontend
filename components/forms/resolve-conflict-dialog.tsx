"use client";

import { useEffect, useRef, useMemo } from "react";

export interface ConflictValue {
  field: string;
  label: string;
  serverValue?: unknown;
  localValue: unknown;
  changed: boolean; // Did the local value differ from what was loaded?
}

export interface ResolveConflictDialogProps {
  /** Title of the entity being edited (e.g., "Organization") */
  entityType: string;
  /** Entity ID (for accessibility/logging) */
  entityId: string;
  /** Array of conflicting field values */
  conflicts: ConflictValue[];
  /** Current local form state (entire object, not just changed fields) */
  localFormState: Record<string, unknown>;
  /** Callback to retry the submission after review */
  onRetry: (formState: Record<string, unknown>) => void;
  /** Callback to abandon the edit and reload the form */
  onReload: () => void;
  /** Callback to abandon the edit without reloading */
  onAbandon: () => void;
  /** Whether a retry is currently in progress */
  isRetrying?: boolean;
}

/**
 * ResolveConflictDialog shows a stale-write conflict and offers the user choices:
 * 1. Review the differences (server vs. local)
 * 2. Retry: Submit again with local edits (server values from user's perspective)
 * 3. Reload: Discard local edits and reload the current server state
 * 4. Abandon: Close the dialog and return to the form with local edits intact
 *
 * Local edits are preserved throughout and never auto-overwritten.
 */
export function ResolveConflictDialog({
  entityType,
  conflicts,
  localFormState,
  onRetry,
  onReload,
  onAbandon,
  isRetrying = false,
}: ResolveConflictDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the retry button when dialog opens (primary action)
  useEffect(() => {
    retryButtonRef.current?.focus();
  }, []);

  // Handle escape key - treat as abandon (keep local edits)
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isRetrying) {
        onAbandon();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onAbandon, isRetrying]);

  // Categorize conflicts: fields that changed on server, fields we changed locally, fields unchanged
  const categorized = useMemo(() => {
    const changedByServer = conflicts.filter(c => c.serverValue !== c.localValue && !c.changed);
    const changedByUs = conflicts.filter(c => c.changed);
    const bothChanged = conflicts.filter(c => c.serverValue !== c.localValue && c.changed);

    return { changedByServer, changedByUs, bothChanged };
  }, [conflicts]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        aria-describedby="conflict-dialog-description"
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg border border-amber-600/30 bg-slate-900 p-6 shadow-xl"
      >
        {/* Header */}
        <div className="border-b border-white/10 pb-4">
          <h2 id="conflict-dialog-title" className="text-lg font-semibold text-white">
            Update Conflict: {entityType}
          </h2>
          <p id="conflict-dialog-description" className="mt-2 text-sm text-slate-300">
            This {entityType.toLowerCase()} was modified on the server after you loaded this form.&nbsp;
            Review the changes below and decide how to proceed.
          </p>
        </div>

        {/* Conflict details */}
        <div className="my-6 space-y-6">
          {/* Fields changed only on server */}
          {categorized.changedByServer.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-200 mb-3">
                Changed on server (will overwrite your version):
              </h3>
              <div className="space-y-3">
                {categorized.changedByServer.map((conflict) => (
                  <FieldConflict key={conflict.field} conflict={conflict} />
                ))}
              </div>
            </div>
          )}

          {/* Fields we changed locally */}
          {categorized.changedByUs.length > 0 && categorized.bothChanged.length === 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-200 mb-3">
                Changed by you (will be submitted):
              </h3>
              <div className="space-y-3">
                {categorized.changedByUs.map((conflict) => (
                  <FieldConflict key={conflict.field} conflict={conflict} />
                ))}
              </div>
            </div>
          )}

          {/* Fields both changed (conflict) */}
          {categorized.bothChanged.length > 0 && (
            <div className="rounded-md border border-amber-600/30 bg-amber-600/10 p-4">
              <h3 className="text-sm font-medium text-amber-200 mb-3">
                ⚠️ Conflicting changes (both you and server modified):
              </h3>
              <div className="space-y-3">
                {categorized.bothChanged.map((conflict) => (
                  <FieldConflict key={conflict.field} conflict={conflict} highlight />
                ))}
              </div>
              <p className="mt-3 text-xs text-amber-300">
                Your changes will override the server values if you choose &quot;Retry&quot;.
              </p>
            </div>
          )}

          {conflicts.length === 0 && (
            <p className="text-sm text-slate-400">
              No conflicts detected. This may indicate a timing issue. Try reloading.
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="border-t border-white/10 pt-6 flex flex-wrap justify-between gap-3">
          <div className="flex gap-3">
            <button
              onClick={onAbandon}
              disabled={isRetrying}
              className="h-10 rounded-md border border-white/15 px-4 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50 transition"
              type="button"
              title="Close dialog and return to editing your local changes"
            >
              Keep Editing
            </button>
            <button
              onClick={onReload}
              disabled={isRetrying}
              className="h-10 rounded-md border border-white/15 px-4 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50 transition"
              type="button"
              title="Discard your changes and reload the current server state"
            >
              Reload from Server
            </button>
          </div>
          <button
            ref={retryButtonRef}
            onClick={() => onRetry(localFormState)}
            disabled={isRetrying}
            className="h-10 rounded-md bg-cyan-300 hover:bg-cyan-200 text-slate-950 px-4 text-sm font-medium disabled:opacity-50 transition"
            type="button"
            title="Try to apply your changes again (your local edits will override conflicting server changes)"
          >
            {isRetrying ? "Retrying..." : "Retry with My Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Display a single field conflict with server vs. local values.
 */
function FieldConflict({
  conflict,
  highlight = false,
}: {
  conflict: ConflictValue;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-md p-3 ${highlight ? "bg-amber-600/20 border border-amber-600/40" : "bg-white/5 border border-white/10"}`}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <p className="text-sm font-medium text-white">{conflict.label}</p>
        {highlight && <span className="text-xs font-medium text-amber-300">CONFLICT</span>}
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase text-slate-400 mb-1">Server Value</p>
          <p className="text-slate-100 font-mono text-xs break-words">
            {formatValue(conflict.serverValue)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400 mb-1">Your Value</p>
          <p className={`font-mono text-xs break-words ${conflict.changed ? "text-cyan-300" : "text-slate-100"}`}>
            {formatValue(conflict.localValue)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Format a value for display in the conflict dialog.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "(empty)";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
