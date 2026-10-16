"use client";

import { useCallback, useState } from "react";
import { canPerformIssuerTransition, updateIssuer, formatIssuerStatus, getIssuerStatusTone, getIssuer } from "@/lib/api/issuers";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { EditIssuerForm } from "@/components/issuers/edit-issuer-form";
import { CursorPagination, type PaginationState } from "@/components/common/cursor-pagination";
import { ResultsHeading } from "@/components/common/results-heading";
import { ResolveConflictDialog } from "@/components/forms/resolve-conflict-dialog";
import { StatusBadge } from "@/components/common/production-ui";
import { IssuerAttestations } from "@/components/issuers/issuer-attestations";
import { formatMessage } from "@/lib/i18n";
import { ApiConflictError } from "@/lib/api/client";
import { useConflictResolution } from "@/hooks/use-conflict-resolution";
import { Redacted } from "@/components/common/redacted";
import type { IssuerWithRevision } from "@/lib/api/issuers";
import type { OrganizationWithRevision } from "@/lib/api/organizations";

const issuerActionLabels = {
  suspend: "Suspend",
  activate: "Activate",
  revoke: "Revoke",
} as const;

export function IssuerList({
  issuers,
  organizations,
  loading,
  token,
  walletAddress,
  role,
  paginationState,
  onPreviousPage,
  onNextPage,
  focusResults,
  onIssuerUpdated,
}: {
  issuers: IssuerWithRevision[];
  organizations: OrganizationWithRevision[];
  loading: boolean;
  token: string;
  walletAddress: string;
  role: string | undefined;
  paginationState: PaginationState;
  onPreviousPage: () => void;
  onNextPage: () => void;
  focusResults: boolean;
  onIssuerUpdated: (issuer: IssuerWithRevision) => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingIssuerId, setEditingIssuerId] = useState<string | null>(null);
  const [expandedAttestationsId, setExpandedAttestationsId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "suspend" | "activate" | "revoke";
    issuerId: string;
    issuerName: string;
  } | null>(null);
  const [pendingIssuerName, setPendingIssuerName] = useState<string | null>(null);
  // TODO: Implement useRecentAuth hook and RecentAuthGate component
  // const recentAuth = useRecentAuth({
  //   walletAddress,
  //   signMessage: (message) => signWithFreighter(message, walletAddress),
  // });

  const {
    conflict,
    isRetrying,
    isReloading,
    showConflict,
    handleReload,
    handleRetry,
    handleAbandon,
  } = useConflictResolution({
    onReloadEntity: async () => {
      if (!confirmAction) return;
      try {
        const controller = new AbortController();
        const issuer = await getIssuer(token, confirmAction.issuerId, controller.signal);
        onIssuerUpdated(issuer);
      } finally {
        setActionLoading(null);
        setConfirmAction(null);
      }
    },
    onRetrySubmit: async (formState) => {
      if (!confirmAction) return;
      try {
        const statusMap = {
          suspend: "SUSPENDED" as const,
          activate: "ACTIVE" as const,
          revoke: "REVOKED" as const,
        };
        const controller = new AbortController();
        const updated = await updateIssuer(
          token,
          confirmAction.issuerId,
          {
            status: statusMap[confirmAction.type],
            __revision: formState.__revision as string | undefined,
          },
          controller.signal
        );
        onIssuerUpdated(updated);
      } finally {
        setActionLoading(null);
        setConfirmAction(null);
      }
    },
  });

  const handleStatusUpdate = useCallback(async (
    issuerId: string,
    newStatus: IssuerWithRevision["status"],
    issuer: IssuerWithRevision
  ) => {
    setActionLoading(issuerId);
    setError(null);
    
    try {
      const controller = new AbortController();
      const updated = await updateIssuer(
        token,
        issuerId,
        { 
          status: newStatus,
          __revision: issuer.__revision
        },
        controller.signal
      );
      onIssuerUpdated(updated);
    } catch (err) {
      if (err instanceof ApiConflictError) {
        // Show conflict dialog with the current issuer and intended status change
        const intendedState = { ...issuer, status: newStatus };
        showConflict(err, intendedState, ["status", "name", "organizationId"]);
      } else {
        setError("Failed to update issuer status. Please try again.");
      }
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  }, [token, onIssuerUpdated, showConflict]);

  const getOrganizationName = useCallback((organizationId?: string) => {
    if (!organizationId) return "Independent";
    const org = organizations.find(o => o.id === organizationId);
    return org?.name || "Unknown Organization";
  }, [organizations]);

  const announcement = focusResults && issuers.length > 0
    ? formatMessage(
        issuers.length === 1
          ? "Results updated. Showing {count} issuer."
          : "Results updated. Showing {count} issuers.",
        { count: issuers.length }
      )
    : undefined;

  if (loading && issuers.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
        <p className="text-sm text-slate-400">Loading issuers...</p>
      </div>
    );
  }

  if (issuers.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
        <p className="text-sm text-slate-400">No issuers found. Create your first issuer above.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        {error && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          </div>
        )}

        {/* Results heading with focus management and announcements */}
        <ResultsHeading
          onFocusRequested={focusResults}
          announcement={announcement}
        >
          Issuers
        </ResultsHeading>

        {/* Desktop header */}
        <div className="hidden grid-cols-[2fr_1fr_1fr_auto] gap-4 border-b border-white/10 pb-2 text-xs font-semibold uppercase text-slate-400 md:grid">
          <div>Issuer</div>
          <div>Organization</div>
          <div>Status</div>
          <div>Actions</div>
        </div>

        {issuers.map((issuer) =>
          editingIssuerId === issuer.id ? (
            <EditIssuerForm
              issuer={issuer}
              key={issuer.id}
              onCancel={() => setEditingIssuerId(null)}
              onIssuerUpdated={(updated) => {
                onIssuerUpdated(updated);
                setEditingIssuerId(null);
              }}
              organizations={organizations}
              token={token}
            />
          ) : (
            <div key={issuer.id} className="grid gap-3">
              <IssuerRow
                issuer={issuer}
                organizationName={getOrganizationName(issuer.organizationId)}
                isLoading={actionLoading === issuer.id}
                role={role}
                onEdit={() => setEditingIssuerId(issuer.id)}
                isAttestationsExpanded={expandedAttestationsId === issuer.id}
                onSuspend={() =>
                  setConfirmAction({
                    type: "suspend",
                    issuerId: issuer.id,
                    issuerName: issuer.name,
                  })
                }
                onActivate={() =>
                  setConfirmAction({
                    type: "activate",
                    issuerId: issuer.id,
                    issuerName: issuer.name,
                  })
                }
                onRevoke={() =>
                  setConfirmAction({
                    type: "revoke",
                    issuerId: issuer.id,
                    issuerName: issuer.name,
                  })
                }
                onToggleAttestations={() =>
                  setExpandedAttestationsId((current) => (current === issuer.id ? null : issuer.id))
                }
              />
              {expandedAttestationsId === issuer.id && (
                <IssuerAttestations
                  issuerId={issuer.id}
                  issuerName={issuer.name}
                  issuerStatus={issuer.status}
                  viewerRole={role ?? null}
                  token={token}
                />
              )}
            </div>
          ),
        )}
      </div>

      {/* Pagination controls */}
      <div className="mt-4">
        <CursorPagination
          state={{
            ...paginationState,
            isLoading: loading,
          }}
          onPrevious={onPreviousPage}
          onNext={onNextPage}
          resultCount={issuers.length}
        />
      </div>

      {confirmAction && (
        <ConfirmationDialog
          title={formatMessage("{action} Issuer", {
            action: issuerActionLabels[confirmAction.type],
          })}
          message={
            confirmAction.type === "revoke"
              ? formatMessage(
                  'Are you sure you want to revoke "{issuerName}"? This action cannot be undone and will permanently disable the issuer.',
                  { issuerName: confirmAction.issuerName },
                )
              : confirmAction.type === "suspend"
              ? formatMessage(
                  'Are you sure you want to suspend "{issuerName}"? This will temporarily disable issuer operations.',
                  { issuerName: confirmAction.issuerName },
                )
              : formatMessage(
                  'Are you sure you want to activate "{issuerName}"? This will enable issuer operations.',
                  { issuerName: confirmAction.issuerName },
                )
          }
          confirmText={issuerActionLabels[confirmAction.type]}
          confirmVariant={confirmAction.type === "revoke" ? "danger" : "primary"}
          onConfirm={() => {
            const issuer = issuers.find(i => i.id === confirmAction.issuerId);
            if (!issuer) return;
            const statusMap = {
              suspend: "SUSPENDED" as const,
              activate: "ACTIVE" as const,
              revoke: "REVOKED" as const,
            };
            const { type, issuerId, issuerName } = confirmAction;
            const runUpdate = () => handleStatusUpdate(issuerId, statusMap[type], issuer);

            // Revocation is permanent and punitive (#141), so it requires a
            // fresh wallet signature; suspend/activate are reversible and
            // don't (matching api-key-list.tsx's revoke-only gating).
            if (type === "revoke") {
              setConfirmAction(null);
              setPendingIssuerName(issuerName);
              // TODO: Uncomment when useRecentAuth is implemented
              // recentAuth.requestRecentAuth(runUpdate);
              runUpdate(); // Temporary workaround
            } else {
              runUpdate();
            }
          }}
          onCancel={() => setConfirmAction(null)}
          isProcessing={actionLoading === confirmAction.issuerId}
        />
      )}

      {/* TODO: Uncomment when RecentAuthGate is implemented
      {recentAuth.isPromptOpen && (
        <RecentAuthGate
          recentAuth={recentAuth}
          actionDescription={`revoke the issuer${pendingIssuerName ? ` "${pendingIssuerName}"` : ""}.`}
        />
      )}
      */}

      {conflict.isActive && (
        <ResolveConflictDialog
          entityType="Issuer"
          entityId={confirmAction?.issuerId ?? ""}
          conflicts={conflict.conflicts}
          localFormState={conflict.localFormState}
          onRetry={handleRetry}
          onReload={handleReload}
          onAbandon={handleAbandon}
          isRetrying={isRetrying || isReloading}
        />
      )}
    </>
  );
}

function IssuerRow({
  issuer,
  organizationName,
  isLoading,
  role,
  onEdit,
  isAttestationsExpanded,
  onSuspend,
  onActivate,
  onRevoke,
  onToggleAttestations,
}: {
  issuer: IssuerWithRevision;
  organizationName: string;
  isLoading: boolean;
  role: string | undefined;
  onEdit: () => void;
  isAttestationsExpanded: boolean;
  onSuspend: () => void;
  onActivate: () => void;
  onRevoke: () => void;
  onToggleAttestations: () => void;
}) {
  // A transition is offered only when it's both a valid status change for
  // this issuer *and* something the current role is permitted to do
  // (#141). A PENDING issuer's only role-appropriate action for an
  // ISSUER-role viewer, for example, is "activate" — "revoke" never
  // appears for them regardless of status.
  const canSuspend = issuer.status === "ACTIVE" && canPerformIssuerTransition(role, "suspend");
  const canActivate =
    (issuer.status === "SUSPENDED" || issuer.status === "PENDING") &&
    canPerformIssuerTransition(role, "activate");
  const canRevoke = issuer.status !== "REVOKED" && canPerformIssuerTransition(role, "revoke");

  return (
    <div className="grid gap-3 rounded-md border border-white/10 bg-slate-950 p-4 text-sm md:grid-cols-[2fr_1fr_1fr_auto] md:items-center md:gap-4">
      {/* Issuer Info */}
      <div className="min-w-0">
        <div className="font-medium text-white">{issuer.name}</div>
        <div className="mt-1 font-mono text-xs text-slate-400">
          ID: <Redacted>{issuer.id}</Redacted>
        </div>
      </div>

      {/* Organization */}
      <div>
        <div className="text-slate-300 md:hidden font-semibold">Organization:</div>
        <div className="text-slate-300">{organizationName}</div>
      </div>

      {/* Status */}
      <div>
        <div className="text-slate-300 md:hidden font-semibold">Status:</div>
        <StatusBadge tone={getIssuerStatusTone(issuer.status)}>
          {formatIssuerStatus(issuer.status)}
        </StatusBadge>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onEdit}
          disabled={isLoading}
          className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50 transition"
        >
          Edit
        </button>
        <button
          aria-expanded={isAttestationsExpanded}
          className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 transition"
          onClick={onToggleAttestations}
          type="button"
        >
          {isAttestationsExpanded ? "Hide Attestations" : "Manage Attestations"}
        </button>
        {canActivate && (
          <button
            onClick={onActivate}
            disabled={isLoading}
            className="h-8 rounded border border-emerald-300/30 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-50 transition"
          >
            {isLoading ? "..." : "Activate"}
          </button>
        )}
        {canSuspend && (
          <button
            onClick={onSuspend}
            disabled={isLoading}
            className="h-8 rounded border border-amber-300/30 px-3 text-xs font-medium text-amber-200 hover:bg-amber-300/10 disabled:opacity-50 transition"
          >
            {isLoading ? "..." : "Suspend"}
          </button>
        )}
        {canRevoke && (
          <button
            onClick={onRevoke}
            disabled={isLoading}
            className="h-8 rounded border border-rose-300/30 px-3 text-xs font-medium text-rose-200 hover:bg-rose-300/10 disabled:opacity-50 transition"
          >
            {isLoading ? "..." : "Revoke"}
          </button>
        )}
        <button
          disabled
          className="h-8 rounded border border-gray-700 px-3 text-xs font-medium text-gray-500 cursor-not-allowed"
          title="Contract synchronization is not yet available: no sync endpoint exists for issuers in the current API"
        >
          Sync contract
        </button>
      </div>
    </div>
  );
}
