"use client";

import type { PermissionDiff } from "@/lib/validation/permission-diff";
import { DataTable, DataTableBody, DataTableCell, DataTableEmptyState, DataTableHead, DataTableHeadCell, DataTableRow } from "@/components/common/data-table";

interface PermissionChangeDiffViewerProps {
  /**
   * The permission diff to display (before/after comparison).
   */
  diff: PermissionDiff;

  /**
   * Optional title for the diff viewer (e.g., "API Key Changes", "Role Changes").
   */
  title?: string;

  /**
   * Optional CSS class for the container.
   */
  className?: string;

  /**
   * Optional flag to show all permissions (including unchanged).
   * If false, only shows changed (added/removed) and inherited.
   * @default false
   */
  showUnchanged?: boolean;

  /**
   * Optional callback when diff is confirmed/approved for mutation.
   * If provided, a confirm button is rendered.
   */
  onConfirm?: () => void;

  /**
   * Optional callback when diff is cancelled/dismissed.
   * If provided, a cancel button is rendered.
   */
  onCancel?: () => void;

  /**
   * Optional text for the confirm button. Defaults to "Confirm Changes".
   */
  confirmText?: string;

  /**
   * Optional text for the cancel button. Defaults to "Cancel".
   */
  cancelText?: string;

  /**
   * If true, buttons are disabled and a loading indicator is shown.
   * @default false
   */
  isProcessing?: boolean;
}

/**
 * Semantic diff viewer for permission changes.
 *
 * Displays added, removed, unchanged, and inherited permissions with:
 * - Clear visual indication of each change status
 * - Risk summaries (broad permissions, destructive removals)
 * - Accessibility support (semantic HTML, ARIA labels)
 * - Optional confirmation dialog
 *
 * Unknown permissions are filtered out (fail-closed pattern).
 * All rendering is driven by the input diff; no client-side recalculation.
 *
 * @example
 * <PermissionChangeDiffViewer
 *   diff={diff}
 *   title="API Key Permission Changes"
 *   showUnchanged={false}
 *   onConfirm={() => submitChanges()}
 *   confirmText="Update Key"
 * />
 */
export function PermissionChangeDiffViewer({
  diff,
  title = "Permission Changes",
  className = "",
  showUnchanged = false,
  onConfirm,
  onCancel,
  confirmText = "Confirm Changes",
  cancelText = "Cancel",
  isProcessing = false,
}: PermissionChangeDiffViewerProps) {
  // Decide which permissions to display based on options.
  const displayPermissions = showUnchanged
    ? diff.all
    : [...diff.added, ...diff.removed, ...diff.inherited];

  const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.inherited.length > 0;

  return (
    <div className={`rounded-md border border-white/10 bg-slate-950 p-6 ${className}`}>
      {/* Header with title and risk indicators */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>

        {/* Risk summary alerts */}
        {diff.riskSummary.hasDestructiveRemovals && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200"
          >
            <strong>Destructive removals detected:</strong> Some permissions being removed could
            cause integrations to fail. Please review carefully.
          </div>
        )}

        {diff.riskSummary.hasRemovals && !diff.riskSummary.hasDestructiveRemovals && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-200"
          >
            <strong>Permissions being removed:</strong> {diff.removed.length} permission
            {diff.removed.length === 1 ? "" : "s"} will no longer be available.
          </div>
        )}

        {diff.riskSummary.hasBroadPermissions && diff.added.length > 0 && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-200"
          >
            <strong>Broad permissions being added:</strong> This change includes permissions that
            can create, modify, or delete data. Only grant to trusted integrations.
          </div>
        )}
      </div>

      {/* Diff table */}
      {hasChanges || showUnchanged ? (
        <DataTable caption={`${title} - Permission details`}>
          <DataTableHead>
            <DataTableHeadCell>Permission</DataTableHeadCell>
            <DataTableHeadCell>Description</DataTableHeadCell>
            <DataTableHeadCell className="w-24 text-center">Status</DataTableHeadCell>
            <DataTableHeadCell className="w-20 text-center">Risk</DataTableHeadCell>
          </DataTableHead>
          <DataTableBody>
            {displayPermissions.map((permission) => (
              <DataTableRow key={permission.id}>
                <DataTableCell className="font-mono text-xs font-medium text-cyan-300">
                  {permission.title}
                </DataTableCell>
                <DataTableCell className="text-xs text-slate-300">
                  {permission.description}
                </DataTableCell>
                <DataTableCell className="text-center">
                  <PermissionStatusBadge status={permission.status} />
                </DataTableCell>
                <DataTableCell className="text-center">
                  {permission.isBroad && (
                    <span
                      className="inline-block rounded bg-amber-300/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-amber-200"
                      title="Broad permission can create, modify, or delete data"
                    >
                      Broad
                    </span>
                  )}
                  {permission.isDestructiveRemoval && (
                    <span
                      className="inline-block rounded bg-rose-300/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-rose-200"
                      title="Removal of this permission could cause critical failures"
                    >
                      Critical
                    </span>
                  )}
                  {!permission.isBroad && !permission.isDestructiveRemoval && (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      ) : (
        <DataTable caption={`${title} - No changes`}>
          <DataTableHead>
            <DataTableHeadCell>Permission</DataTableHeadCell>
            <DataTableHeadCell>Description</DataTableHeadCell>
            <DataTableHeadCell className="w-24 text-center">Status</DataTableHeadCell>
            <DataTableHeadCell className="w-20 text-center">Risk</DataTableHeadCell>
          </DataTableHead>
          <DataTableEmptyState colSpan={4}>
            No permission changes to display.
          </DataTableEmptyState>
        </DataTable>
      )}

      {/* Summary stats */}
      {hasChanges && (
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {diff.added.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Added
              </div>
              <div className="mt-1 text-lg font-semibold text-green-300">{diff.added.length}</div>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Removed
              </div>
              <div className="mt-1 text-lg font-semibold text-rose-300">{diff.removed.length}</div>
            </div>
          )}
          {diff.inherited.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Inherited
              </div>
              <div className="mt-1 text-lg font-semibold text-blue-300">{diff.inherited.length}</div>
            </div>
          )}
          {showUnchanged && diff.unchanged.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Unchanged
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-400">{diff.unchanged.length}</div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {(onConfirm || onCancel) && (
        <div className="mt-6 flex justify-end gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50 transition"
            >
              {cancelText}
            </button>
          )}
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={isProcessing || !diff.requiresConfirmation}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                diff.requiresConfirmation
                  ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
                  : "bg-slate-700 text-slate-300 cursor-not-allowed"
              }`}
              title={
                !diff.requiresConfirmation
                  ? "No changes to confirm"
                  : diff.confirmationReason || "Review and confirm changes"
              }
            >
              {isProcessing ? "Processing..." : confirmText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Badge component showing permission change status.
 */
function PermissionStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<
    string,
    { label: string; className: string; title: string }
  > = {
    added: {
      label: "Added",
      className: "inline-block rounded bg-green-300/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-green-200",
      title: "This permission is new",
    },
    removed: {
      label: "Removed",
      className: "inline-block rounded bg-rose-300/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-rose-200",
      title: "This permission will be revoked",
    },
    unchanged: {
      label: "Unchanged",
      className: "inline-block rounded bg-slate-300/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400",
      title: "This permission remains the same",
    },
    inherited: {
      label: "Inherited",
      className: "inline-block rounded bg-blue-300/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-blue-200",
      title: "This permission is inherited from a higher-level grant",
    },
  };

  const config = statusConfig[status] || statusConfig.unchanged;

  return (
    <span className={config.className} title={config.title}>
      {config.label}
    </span>
  );
}
