"use client";

import { useMemo, useRef, useState } from "react";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { StatusBadge } from "@/components/common/production-ui";
import { formatDateTime, formatMessage } from "@/lib/i18n";
import type { SessionRecord } from "@/lib/sessions/store";
import {
  listSessionSecurityEvents,
  resolveLinkedSession,
  signOutSessionFromRiskEvent,
  TenantSessionAccessError,
  type AuthHistoryEventType,
  type SessionSecurityEvent,
} from "@/lib/sessions/risk-history";

const EVENT_TYPE_LABELS: Record<AuthHistoryEventType, string> = {
  "wallet-sign-in": "Initial wallet sign-in",
  "reauth-verified": "Step-up signature verified",
  "reauth-expired": "Recent-auth window expired",
  "replay-blocked": "Challenge replay blocked",
  "session-revoked": "Remote session signed out",
  "risk-signal-observed": "Session risk signal observed",
};

export interface SessionRiskHistoryProps {
  userId: string;
  organizationId: string;
  viewerUserId?: string;
  viewerOrganizationId?: string;
  activeSessions: SessionRecord[];
  revokedSessions: SessionRecord[];
  /** Optional explicit events override for controlled rendering/testing. */
  events?: SessionSecurityEvent[];
  onRemoteSignOutCompleted?: (result: {
    activeSessions: SessionRecord[];
    revokedSessions: SessionRecord[];
    events: SessionSecurityEvent[];
  }) => void;
}

export function SessionRiskHistory({
  userId,
  organizationId,
  viewerUserId = userId,
  viewerOrganizationId = organizationId,
  activeSessions,
  revokedSessions,
  events: controlledEvents,
  onRemoteSignOutCompleted,
}: SessionRiskHistoryProps) {
  const [confirmTarget, setConfirmTarget] = useState<{
    eventId: string;
    sessionId: string;
    deviceLabel: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localEvents, setLocalEvents] = useState<SessionSecurityEvent[] | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const resolvedState = useMemo(() => {
    try {
      if (
        !organizationId ||
        !viewerOrganizationId ||
        organizationId !== viewerOrganizationId ||
        !userId ||
        !viewerUserId ||
        userId !== viewerUserId
      ) {
        throw new TenantSessionAccessError(
          "Cross-tenant or cross-user session history access is denied.",
        );
      }

      const sourceEvents =
        localEvents ??
        controlledEvents ??
        listSessionSecurityEvents({
          userId,
          organizationId,
          viewerUserId,
          viewerOrganizationId,
        });

      const tenantSafeEvents = sourceEvents.filter(
        (event) =>
          event.organizationId === viewerOrganizationId &&
          event.userId === viewerUserId,
      );

      return {
        accessError: null as string | null,
        events: tenantSafeEvents,
      };
    } catch (err) {
      return {
        accessError:
          err instanceof TenantSessionAccessError
            ? err.message
            : "Unable to load session security history for this organization.",
        events: [] as SessionSecurityEvent[],
      };
    }
  }, [
    controlledEvents,
    localEvents,
    organizationId,
    userId,
    viewerOrganizationId,
    viewerUserId,
  ]);

  if (resolvedState.accessError) {
    return (
      <section
        role="alert"
        aria-label="Session history tenant boundary alert"
        className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5"
      >
        <h2 className="text-lg font-semibold text-rose-100">
          Tenant Session History Restricted
        </h2>
        <p className="mt-2 text-sm text-rose-200">{resolvedState.accessError}</p>
      </section>
    );
  }

  const riskEvents = resolvedState.events.filter(
    (e) => e.riskDescriptor !== null,
  );

  const handleOpenConfirm = (
    event: SessionSecurityEvent,
    deviceLabel: string,
    button: HTMLButtonElement,
  ) => {
    triggerRef.current = button;
    setActionError(null);
    setConfirmTarget({
      eventId: event.id,
      sessionId: event.sessionId,
      deviceLabel,
    });
  };

  const handleConfirmRemoteSignOut = () => {
    if (!confirmTarget) return;
    setActionError(null);

    try {
      const updated = signOutSessionFromRiskEvent({
        userId,
        organizationId,
        sessionId: confirmTarget.sessionId,
        riskEventId: confirmTarget.eventId,
        viewerUserId,
        viewerOrganizationId,
      });
      setLocalEvents(updated.events);
      onRemoteSignOutCompleted?.(updated);
    } catch {
      setActionError(
        "Could not sign out the affected session. It may have already been revoked.",
      );
    } finally {
      setConfirmTarget(null);
      triggerRef.current?.focus();
    }
  };

  const handleCancelRemoteSignOut = () => {
    setConfirmTarget(null);
    triggerRef.current?.focus();
  };

  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="session-risk-signals-heading"
        className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
      >
        <div>
          <h2
            id="session-risk-signals-heading"
            className="text-xl font-semibold text-white"
          >
            Session Risk Signals
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Privacy-safe security observations reported by the server. Labels
            describe observed signals only and do not imply confirmed compromise
            beyond server evidence. Raw device fingerprints and precise
            locations are never stored or displayed.
          </p>
        </div>

        {actionError && (
          <div
            role="alert"
            className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200"
          >
            {actionError}
          </div>
        )}

        {riskEvents.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-sm text-slate-400">
            No session risk signals observed for this workspace.
          </div>
        ) : (
          <div className="grid gap-3">
            {riskEvents.map((event) => {
              const descriptor = event.riskDescriptor!;
              const linked = resolveLinkedSession(
                event,
                activeSessions,
                revokedSessions,
              );

              const badgeTone =
                descriptor.severity === "elevated"
                  ? "warning"
                  : descriptor.severity === "review"
                    ? "warning"
                    : "accent";

              return (
                <article
                  key={event.id}
                  data-testid={`risk-event-${event.id}`}
                  className="grid gap-3 rounded-md border border-white/10 bg-slate-950 p-4 text-sm"
                >
                  <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={badgeTone}>
                        {descriptor.label}
                      </StatusBadge>
                      <span className="text-xs text-slate-400">
                        Observed {formatDateTime(event.occurredAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {linked.state === "active-current" && (
                        <StatusBadge tone="success">
                          Linked: Current device ({linked.sessionId})
                        </StatusBadge>
                      )}
                      {linked.state === "active-remote" && (
                        <StatusBadge tone="warning">
                          Linked: Active session ({linked.sessionId})
                        </StatusBadge>
                      )}
                      {linked.state === "revoked" && (
                        <StatusBadge tone="accent">
                          Linked: Revoked session ({linked.sessionId})
                        </StatusBadge>
                      )}
                      {linked.state === "unknown-session" && (
                        <StatusBadge tone="accent">
                          Session: {linked.sessionId}
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <p className="text-slate-200">{event.detail}</p>
                  <p className="text-xs leading-5 text-slate-400">
                    <span className="font-semibold text-slate-300">
                      Server evidence note:{" "}
                    </span>
                    {descriptor.evidenceSummary}
                  </p>

                  <div className="flex flex-col justify-between gap-3 border-t border-white/10 pt-3 text-xs text-slate-400 sm:flex-row sm:items-center">
                    <div className="flex flex-wrap gap-4">
                      <span>
                        <strong className="text-slate-300">Coarse device:</strong>{" "}
                        {event.deviceLabel}
                      </span>
                      <span>
                        <strong className="text-slate-300">Coarse region:</strong>{" "}
                        {event.coarseRegion}
                      </span>
                      {linked.state === "revoked" && linked.revokedAt && (
                        <span>
                          <strong className="text-slate-300">Signed out:</strong>{" "}
                          {formatDateTime(linked.revokedAt)}
                        </span>
                      )}
                    </div>

                    {linked.canRemoteSignOut && (
                      <button
                        type="button"
                        onClick={(e) =>
                          handleOpenConfirm(
                            event,
                            linked.deviceLabel,
                            e.currentTarget,
                          )
                        }
                        className="h-8 rounded border border-rose-300/30 px-3 text-xs font-semibold text-rose-200 transition hover:bg-rose-300/10"
                      >
                        Revoke affected session
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        aria-labelledby="reauth-history-heading"
        className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
      >
        <div>
          <h2
            id="reauth-history-heading"
            className="text-xl font-semibold text-white"
          >
            Reauthentication &amp; Authentication Event History
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Recent wallet signature assertions, challenge verifications, and
            remote session revocations recorded for your account in this
            organization.
          </p>
        </div>

        <div className="grid gap-2">
          {resolvedState.events.map((event) => (
            <div
              key={`history-${event.id}`}
              className="grid gap-2 rounded-md border border-white/10 bg-slate-950 p-3.5 text-sm md:grid-cols-[1.4fr_1fr_1fr_1.6fr] md:items-center"
            >
              <div>
                <div className="font-medium text-white">
                  {EVENT_TYPE_LABELS[event.eventType]}
                </div>
                <div className="text-xs text-slate-400">
                  Session: {event.sessionId}
                </div>
              </div>
              <div className="text-xs text-slate-300">
                <div>{event.deviceLabel}</div>
                <div className="text-slate-400">{event.coarseRegion}</div>
              </div>
              <div className="text-xs text-slate-400">
                {formatDateTime(event.occurredAt)}
              </div>
              <div className="text-xs text-slate-300">{event.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {confirmTarget && (
        <ConfirmationDialog
          title="Revoke Affected Session"
          message={formatMessage(
            'Are you sure you want to remotely sign out "{deviceLabel}" ({sessionId}) linked to this security signal? That device will need a fresh wallet signature to sign in again.',
            {
              deviceLabel: confirmTarget.deviceLabel,
              sessionId: confirmTarget.sessionId,
            },
          )}
          confirmText="Revoke session"
          confirmVariant="danger"
          onConfirm={handleConfirmRemoteSignOut}
          onCancel={handleCancelRemoteSignOut}
        />
      )}
    </div>
  );
}
