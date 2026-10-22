"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CursorPagination } from "@/components/common/cursor-pagination";
import { StatusBadge } from "@/components/common/production-ui";
import { formatDateTime } from "@/lib/i18n";
import {
  acknowledgeSecurityNotification,
  createSeedNotifications,
  dismissSecurityNotification,
  querySecurityNotifications,
  type NotificationDeliveryStatus,
  type RawSecurityNotificationInput,
  type SecurityNotificationType,
} from "@/lib/api/security-notifications";

export interface SecurityNotificationInboxProps {
  viewerOrganizationId?: string;
  viewerUserId?: string;
  initialNotifications?: RawSecurityNotificationInput[];
  pageSize?: number;
  nowMs?: number;
}

const DELIVERY_STATUS_LABELS: Record<NotificationDeliveryStatus, string> = {
  delivered: "Delivered",
  pending: "Pending",
  acknowledged: "Acknowledged",
  failed: "Delivery failed",
};

function deliveryBadgeTone(
  status: NotificationDeliveryStatus,
): "success" | "warning" | "accent" {
  if (status === "acknowledged" || status === "delivered") return "success";
  if (status === "failed" || status === "pending") return "warning";
  return "accent";
}

export function SecurityNotificationInbox({
  viewerOrganizationId = "org-default",
  viewerUserId = "user-1",
  initialNotifications,
  pageSize = 3,
  nowMs,
}: SecurityNotificationInboxProps) {
  const [rawRecords, setRawRecords] = useState<RawSecurityNotificationInput[]>(
    () =>
      initialNotifications ??
      createSeedNotifications(viewerOrganizationId, viewerUserId, nowMs),
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [deliveryFilter, setDeliveryFilter] = useState<
    NotificationDeliveryStatus | "all"
  >("all");
  const [typeFilter, setTypeFilter] = useState<
    SecurityNotificationType | "all"
  >("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const pageResult = useMemo(
    () =>
      querySecurityNotifications(rawRecords, {
        viewerOrganizationId,
        viewerUserId,
        cursor,
        pageSize,
        deliveryStatusFilter: deliveryFilter,
        typeFilter,
        unreadOnly,
        nowMs,
      }),
    [
      cursor,
      deliveryFilter,
      nowMs,
      pageSize,
      rawRecords,
      typeFilter,
      unreadOnly,
      viewerOrganizationId,
      viewerUserId,
    ],
  );

  // Full tenant-scoped list to resolve selected detail across pages safely
  const allTenantScoped = useMemo(
    () =>
      querySecurityNotifications(rawRecords, {
        viewerOrganizationId,
        viewerUserId,
        pageSize: 50,
        nowMs,
      }).items,
    [nowMs, rawRecords, viewerOrganizationId, viewerUserId],
  );

  const selectedNotification = useMemo(() => {
    if (selectedId) {
      const match = allTenantScoped.find((item) => item.id === selectedId);
      if (match) return match;
    }
    return pageResult.items[0] ?? null;
  }, [allTenantScoped, pageResult.items, selectedId]);

  const handleAcknowledge = (notificationId: string) => {
    setErrorBanner(null);
    try {
      const result = acknowledgeSecurityNotification(rawRecords, {
        notificationId,
        viewerOrganizationId,
        viewerUserId,
        nowMs,
      });
      setRawRecords(result.updatedInputs);

      if (result.wasAlreadyAcknowledged) {
        setStatusBanner(
          result.record.hasUnresolvedIncident
            ? "Notice was already acknowledged. Underlying security incident remains unresolved."
            : "Notice was already acknowledged (no duplicate state change).",
        );
      } else if (result.record.hasUnresolvedIncident) {
        setStatusBanner(
          "Acknowledged receipt of notice. The underlying security incident remains active and is not dismissed.",
        );
      } else {
        setStatusBanner("Security notice acknowledged.");
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Unable to acknowledge security notice.",
      );
    }
  };

  const handleDismiss = (notificationId: string) => {
    setErrorBanner(null);
    setStatusBanner(null);
    try {
      const next = dismissSecurityNotification(rawRecords, {
        notificationId,
        viewerOrganizationId,
        viewerUserId,
      });
      setRawRecords(next);
      setStatusBanner("Notification dismissed from inbox.");
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Cannot dismiss notification while incident is unresolved.",
      );
    }
  };

  return (
    <div className="grid gap-6">
      <section
        aria-label="Notification inbox summary and preferences"
        className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
      >
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">
              Security Notification Inbox
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Tenant-scoped record of delivered, pending, acknowledged, and
              failed security notices for{" "}
              <span className="font-semibold text-white">
                {viewerOrganizationId}
              </span>
              .
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/settings/preferences"
              className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/5"
            >
              Display &amp; Notification Preferences
            </Link>
            <Link
              href="/settings/security"
              className="inline-flex h-9 items-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
            >
              Security Posture Settings
            </Link>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-white/10 bg-slate-950 p-3.5">
            <div className="text-xs font-semibold uppercase text-slate-400">
              Unread notices
            </div>
            <div
              data-testid="inbox-unread-count"
              className="mt-1 text-2xl font-semibold text-white"
            >
              {pageResult.summary.unreadCount}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-950 p-3.5">
            <div className="text-xs font-semibold uppercase text-slate-400">
              Unresolved incidents
            </div>
            <div
              data-testid="inbox-unresolved-count"
              className="mt-1 text-2xl font-semibold text-amber-200"
            >
              {pageResult.summary.unresolvedIncidentCount}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-950 p-3.5">
            <div className="text-xs font-semibold uppercase text-slate-400">
              Delivered / Acknowledged
            </div>
            <div className="mt-1 text-2xl font-semibold text-emerald-200">
              {pageResult.summary.byDeliveryStatus.delivered} /{" "}
              {pageResult.summary.byDeliveryStatus.acknowledged}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-950 p-3.5">
            <div className="text-xs font-semibold uppercase text-slate-400">
              Pending / Failed
            </div>
            <div className="mt-1 text-2xl font-semibold text-rose-200">
              {pageResult.summary.byDeliveryStatus.pending} /{" "}
              {pageResult.summary.byDeliveryStatus.failed}
            </div>
          </div>
        </div>
      </section>

      {statusBanner && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100"
        >
          {statusBanner}
        </div>
      )}

      {errorBanner && (
        <div
          role="alert"
          className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200"
        >
          {errorBanner}
        </div>
      )}

      <section
        aria-label="Notification filters and list"
        className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              Delivery state
              <select
                aria-label="Filter by delivery state"
                value={deliveryFilter}
                onChange={(e) => {
                  setCursor(null);
                  setDeliveryFilter(
                    e.target.value as NotificationDeliveryStatus | "all",
                  );
                }}
                className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-xs text-white"
              >
                <option value="all">All states</option>
                <option value="delivered">Delivered</option>
                <option value="pending">Pending</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="failed">Failed</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              Notice category
              <select
                aria-label="Filter by notice category"
                value={typeFilter}
                onChange={(e) => {
                  setCursor(null);
                  setTypeFilter(
                    e.target.value as SecurityNotificationType | "all",
                  );
                }}
                className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-xs text-white"
              >
                <option value="all">All categories</option>
                <option value="key-rotation">Key rotation</option>
                <option value="session-risk">Session risk</option>
                <option value="role-change">Role changes</option>
                <option value="dispute">Disputes</option>
                <option value="protocol-incident">Protocol incidents</option>
                <option value="unknown">Unclassified notices</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => {
                setCursor(null);
                setUnreadOnly(e.target.checked);
              }}
              className="h-4 w-4 rounded border-white/20 bg-slate-950"
            />
            Show unread only
          </label>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-3">
            {pageResult.items.length === 0 ? (
              <div className="rounded-md border border-white/10 bg-slate-950 p-5 text-sm text-slate-400">
                No security notifications match the selected filters for this
                tenant.
              </div>
            ) : (
              pageResult.items.map((item) => {
                const isSelected = selectedNotification?.id === item.id;
                return (
                  <article
                    key={item.id}
                    data-testid={`notification-row-${item.id}`}
                    className={`rounded-md border p-4 transition ${
                      isSelected
                        ? "border-cyan-300/50 bg-cyan-300/[0.06]"
                        : "border-white/10 bg-slate-950"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="accent">{item.typeLabel}</StatusBadge>
                        <StatusBadge
                          tone={deliveryBadgeTone(item.deliveryStatus)}
                        >
                          {DELIVERY_STATUS_LABELS[item.deliveryStatus]}
                        </StatusBadge>
                        {!item.isRead && (
                          <span className="rounded bg-cyan-300 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-950">
                            Unread
                          </span>
                        )}
                        {item.hasUnresolvedIncident && (
                          <StatusBadge tone="warning">
                            Unresolved incident
                          </StatusBadge>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
                        {formatDateTime(item.createdAt)}
                      </span>
                    </div>

                    <h3 className="mt-2 text-base font-semibold text-white">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-300">{item.summary}</p>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        aria-pressed={isSelected}
                        className="h-8 rounded border border-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/5"
                      >
                        {isSelected ? "Viewing details" : "Inspect notice"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAcknowledge(item.id)}
                        className="h-8 rounded bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                      >
                        {item.deliveryStatus === "acknowledged"
                          ? "Re-confirm acknowledgement"
                          : "Acknowledge notice"}
                      </button>
                    </div>
                  </article>
                );
              })
            )}

            <CursorPagination
              state={{
                nextCursor: pageResult.nextCursor,
                previousCursor: pageResult.previousCursor,
                isLoading: false,
              }}
              resultCount={pageResult.items.length}
              onNext={() => setCursor(pageResult.nextCursor)}
              onPrevious={() => setCursor(pageResult.previousCursor)}
            />
          </div>

          <aside
            aria-label="Selected notification details"
            className="rounded-md border border-white/10 bg-slate-950 p-5"
          >
            {selectedNotification ? (
              <div className="grid gap-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="accent">
                    {selectedNotification.typeLabel}
                  </StatusBadge>
                  <StatusBadge
                    tone={deliveryBadgeTone(
                      selectedNotification.deliveryStatus,
                    )}
                  >
                    {
                      DELIVERY_STATUS_LABELS[
                        selectedNotification.deliveryStatus
                      ]
                    }
                  </StatusBadge>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {selectedNotification.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Notice ID: {selectedNotification.id} &middot; Tenant:{" "}
                    {selectedNotification.organizationId}
                  </p>
                </div>

                <p className="leading-6 text-slate-200">
                  {selectedNotification.detail}
                </p>

                {selectedNotification.failureReason && (
                  <div
                    role="alert"
                    className="rounded border border-rose-300/30 bg-rose-300/10 p-3 text-xs text-rose-200"
                  >
                    <strong>Delivery failure diagnostic: </strong>
                    {selectedNotification.failureReason}
                  </div>
                )}

                {selectedNotification.hasUnresolvedIncident && (
                  <div className="rounded border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
                    <strong>Active incident ({selectedNotification.incidentId ?? selectedNotification.incidentState}): </strong>
                    Acknowledging this notice records receipt but does not
                    dismiss or resolve the underlying security incident.
                  </div>
                )}

                <dl className="grid gap-2 border-t border-white/10 pt-3 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <dt>Created</dt>
                    <dd className="text-slate-200">
                      {formatDateTime(selectedNotification.createdAt)}
                    </dd>
                  </div>
                  {selectedNotification.acknowledgedAt && (
                    <div className="flex justify-between">
                      <dt>Acknowledged at</dt>
                      <dd
                        data-testid="detail-acknowledged-at"
                        className="text-slate-200"
                      >
                        {formatDateTime(selectedNotification.acknowledgedAt)}
                      </dd>
                    </div>
                  )}
                </dl>

                {selectedNotification.deepLink.status === "valid" &&
                  selectedNotification.deepLink.safeHref && (
                    <div>
                      <a
                        href={selectedNotification.deepLink.safeHref}
                        className="inline-flex h-9 items-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                      >
                        {selectedNotification.deepLink.label}
                      </a>
                    </div>
                  )}

                {selectedNotification.deepLink.status !== "valid" &&
                  selectedNotification.deepLink.status !== "none" && (
                    <div
                      role="note"
                      data-testid="deep-link-warning"
                      className="rounded border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-200"
                    >
                      <strong>Action link unavailable: </strong>
                      {selectedNotification.deepLink.reason}
                    </div>
                  )}

                <div className="flex flex-wrap gap-3 border-t border-white/10 pt-3">
                  <button
                    type="button"
                    onClick={() => handleAcknowledge(selectedNotification.id)}
                    className="h-9 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                  >
                    {selectedNotification.deliveryStatus === "acknowledged"
                      ? "Acknowledged (idempotent)"
                      : "Acknowledge receipt"}
                  </button>

                  <button
                    type="button"
                    disabled={!selectedNotification.canDismiss}
                    onClick={() => handleDismiss(selectedNotification.id)}
                    className="h-9 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectedNotification.canDismiss
                      ? "Dismiss notice"
                      : "Cannot dismiss unresolved incident"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Select a notification to view its full details.
              </p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
