/**
 * Tenant-scoped security notification inbox module (#255).
 *
 * Provides an in-product record of delivered, pending, acknowledged, and
 * failed security notices across typed categories:
 *   - key-rotation
 *   - session-risk
 *   - role-change
 *   - dispute
 *   - protocol-incident
 *   - unknown (fail-closed fallback for unrecognized server notice types)
 *
 * Key security and privacy guarantees:
 * 1. Tenant & user isolation: notifications belonging to another organization
 *    or another user are never returned, inspected, or acknowledged.
 * 2. Idempotent acknowledgement: acknowledging an already-acknowledged notice
 *    preserves the original `acknowledgedAt` timestamp and state without
 *    duplicate mutations.
 * 3. Unresolved incident protection: acknowledging receipt of a notice NEVER
 *    dismisses or resolves an active/unresolved security incident.
 * 4. Redaction: secret keys, bearer tokens, webhook secrets, Stellar addresses,
 *    and raw payloads are redacted before storage or rendering.
 * 5. Tenant-scoped deep links: links are validated against an allowlist of
 *    internal routes, checked for tenant ownership, and checked for staleness.
 */

import { redactMessage } from "@/lib/telemetry/redact";

export const KNOWN_NOTIFICATION_TYPES = [
  "key-rotation",
  "session-risk",
  "role-change",
  "dispute",
  "protocol-incident",
] as const;

export type KnownSecurityNotificationType =
  (typeof KNOWN_NOTIFICATION_TYPES)[number];

export type SecurityNotificationType =
  | KnownSecurityNotificationType
  | "unknown";

export const DELIVERY_STATES = [
  "delivered",
  "pending",
  "acknowledged",
  "failed",
] as const;

export type NotificationDeliveryStatus = (typeof DELIVERY_STATES)[number];

export type IncidentResolutionState =
  | "none"
  | "unresolved"
  | "investigating"
  | "resolved";

export interface RawSecurityNotificationInput {
  id: string;
  organizationId: string;
  recipientUserId: string;
  type: string;
  deliveryStatus: NotificationDeliveryStatus;
  title: string;
  summary: string;
  detail: string;
  createdAt: string;
  deliveredAt?: string | null;
  acknowledgedAt?: string | null;
  failureReason?: string | null;
  isRead?: boolean;
  incidentState?: IncidentResolutionState;
  incidentId?: string | null;
  deepLink?: {
    href: string;
    label: string;
    targetOrganizationId?: string;
    expiresAt?: string | null;
    resourceRemoved?: boolean;
  } | null;
}

export type DeepLinkValidationStatus =
  | "valid"
  | "stale-link"
  | "cross-tenant-blocked"
  | "unsafe-route-blocked"
  | "none";

export interface ValidatedNotificationDeepLink {
  status: DeepLinkValidationStatus;
  /** Non-null only when status === "valid". */
  safeHref: string | null;
  label: string;
  reason: string | null;
}

export interface SecurityNotificationRecord {
  id: string;
  organizationId: string;
  recipientUserId: string;
  type: SecurityNotificationType;
  rawType: string;
  typeLabel: string;
  deliveryStatus: NotificationDeliveryStatus;
  title: string;
  summary: string;
  detail: string;
  createdAt: string;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  failureReason: string | null;
  isRead: boolean;
  incidentState: IncidentResolutionState;
  incidentId: string | null;
  /** True when an underlying security incident is unresolved or investigating. */
  hasUnresolvedIncident: boolean;
  /** Unresolved incidents can never be dismissed even after acknowledgement. */
  canDismiss: boolean;
  dismissed: boolean;
  deepLink: ValidatedNotificationDeepLink;
}

export interface NotificationInboxSummary {
  totalCount: number;
  unreadCount: number;
  unresolvedIncidentCount: number;
  byDeliveryStatus: Record<NotificationDeliveryStatus, number>;
}

export interface PaginatedSecurityNotifications {
  items: SecurityNotificationRecord[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount: number;
  summary: NotificationInboxSummary;
}

export class NotificationAccessDeniedError extends Error {
  constructor(
    message = "Access denied: notification belongs to another tenant or user.",
  ) {
    super(message);
    this.name = "NotificationAccessDeniedError";
  }
}

export class UnresolvedIncidentDismissError extends Error {
  constructor(
    message = "Cannot dismiss a notification while its security incident remains unresolved.",
  ) {
    super(message);
    this.name = "UnresolvedIncidentDismissError";
  }
}

const ALLOWED_INTERNAL_PATHS: ReadonlySet<string> = new Set([
  "/settings",
  "/settings/security",
  "/settings/sessions",
  "/settings/organizations",
  "/settings/organizations/role-approval",
  "/settings/organizations/data-residency",
  "/settings/issuers",
  "/settings/trusted-sources",
  "/settings/assets",
  "/settings/audit",
  "/settings/approvals",
  "/settings/governance",
  "/settings/policies",
  "/settings/preferences",
  "/settings/usage",
  "/settings/wallet",
  "/settings/notifications",
  "/developers/api-keys",
  "/developers/webhooks",
  "/proofs/anchoring",
  "/proofs/history",
  "/security",
  "/status",
]);

const API_KEY_SECRET_PATTERN = /\b(?:ep_live|ep_test|whsec|sk_live|rk_live)_[A-Za-z0-9_-]{8,}\b/g;

const TYPE_LABELS: Record<SecurityNotificationType, string> = {
  "key-rotation": "Key rotation notice",
  "session-risk": "Session risk alert",
  "role-change": "Organization role change",
  "dispute": "Credential or proof dispute",
  "protocol-incident": "Protocol security incident",
  unknown: "Unclassified security notice",
};

/**
 * Redacts API secrets, webhook secrets, bearer tokens, Stellar addresses,
 * emails, and hex blobs from notification fields.
 */
export function redactNotificationText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }
  const secretRedacted = value.replace(API_KEY_SECRET_PATTERN, "<redacted-secret>");
  return redactMessage(secretRedacted);
}

export function normalizeNotificationType(rawType: unknown): {
  type: SecurityNotificationType;
  rawType: string;
  typeLabel: string;
} {
  if (typeof rawType !== "string" || rawType.trim().length === 0) {
    return {
      type: "unknown",
      rawType: "unknown",
      typeLabel: TYPE_LABELS.unknown,
    };
  }
  const normalized = rawType.trim().toLowerCase();
  if ((KNOWN_NOTIFICATION_TYPES as readonly string[]).includes(normalized)) {
    const typed = normalized as KnownSecurityNotificationType;
    return {
      type: typed,
      rawType: normalized,
      typeLabel: TYPE_LABELS[typed],
    };
  }
  return {
    type: "unknown",
    rawType: normalized,
    typeLabel: TYPE_LABELS.unknown,
  };
}

/**
 * Validates a notification deep link to ensure it is tenant-scoped, points to
 * an allowed internal route, and has not expired or become stale.
 */
export function validateNotificationDeepLink(
  deepLink: RawSecurityNotificationInput["deepLink"],
  viewerOrganizationId: string,
  nowMs = Date.now(),
): ValidatedNotificationDeepLink {
  if (!deepLink || typeof deepLink.href !== "string" || deepLink.href.trim() === "") {
    return {
      status: "none",
      safeHref: null,
      label: "",
      reason: null,
    };
  }

  const label = redactNotificationText(deepLink.label) || "View related resource";
  const rawHref = deepLink.href.trim();

  // Reject external, protocol-relative, or script URLs
  if (
    !rawHref.startsWith("/") ||
    rawHref.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawHref)
  ) {
    return {
      status: "unsafe-route-blocked",
      safeHref: null,
      label,
      reason: "External or unsafe deep link was blocked by security policy.",
    };
  }

  // Enforce tenant scoping on deep links
  if (
    deepLink.targetOrganizationId &&
    deepLink.targetOrganizationId !== viewerOrganizationId
  ) {
    return {
      status: "cross-tenant-blocked",
      safeHref: null,
      label,
      reason:
        "Deep link targets a different organization and has been blocked to prevent cross-tenant navigation.",
    };
  }

  const basePath = rawHref.split("?")[0]?.split("#")[0] ?? "";
  if (!ALLOWED_INTERNAL_PATHS.has(basePath)) {
    return {
      status: "stale-link",
      safeHref: null,
      label,
      reason:
        "The linked route is no longer available or is not a recognized workspace path.",
    };
  }

  // Check staleness (resource removed or link expired)
  if (deepLink.resourceRemoved) {
    return {
      status: "stale-link",
      safeHref: null,
      label,
      reason: "The referenced resource has been removed or superseded.",
    };
  }

  if (deepLink.expiresAt) {
    const expiryMs = new Date(deepLink.expiresAt).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) {
      return {
        status: "stale-link",
        safeHref: null,
        label,
        reason: "This action link has expired. Navigate via settings to review current state.",
      };
    }
  }

  return {
    status: "valid",
    safeHref: basePath,
    label,
    reason: null,
  };
}

export function normalizeSecurityNotification(
  raw: RawSecurityNotificationInput,
  viewerOrganizationId: string,
  nowMs = Date.now(),
): SecurityNotificationRecord {
  const { type, rawType, typeLabel } = normalizeNotificationType(raw.type);
  const deliveryStatus: NotificationDeliveryStatus = (
    DELIVERY_STATES as readonly string[]
  ).includes(raw.deliveryStatus)
    ? raw.deliveryStatus
    : "pending";

  const incidentState: IncidentResolutionState =
    raw.incidentState === "unresolved" ||
    raw.incidentState === "investigating" ||
    raw.incidentState === "resolved"
      ? raw.incidentState
      : "none";

  const hasUnresolvedIncident =
    incidentState === "unresolved" || incidentState === "investigating";

  const acknowledgedAt =
    deliveryStatus === "acknowledged"
      ? (raw.acknowledgedAt ?? raw.createdAt)
      : (raw.acknowledgedAt ?? null);

  return {
    id: raw.id,
    organizationId: raw.organizationId,
    recipientUserId: raw.recipientUserId,
    type,
    rawType,
    typeLabel,
    deliveryStatus,
    title: redactNotificationText(raw.title) || typeLabel,
    summary: redactNotificationText(raw.summary),
    detail: redactNotificationText(raw.detail),
    createdAt: raw.createdAt,
    deliveredAt: raw.deliveredAt ?? null,
    acknowledgedAt,
    failureReason: raw.failureReason
      ? redactNotificationText(raw.failureReason)
      : null,
    isRead: Boolean(raw.isRead || deliveryStatus === "acknowledged"),
    incidentState,
    incidentId: raw.incidentId ?? null,
    hasUnresolvedIncident,
    canDismiss: !hasUnresolvedIncident,
    dismissed: false,
    deepLink: validateNotificationDeepLink(
      raw.deepLink,
      viewerOrganizationId,
      nowMs,
    ),
  };
}

export function createSeedNotifications(
  organizationId = "org-default",
  userId = "user-1",
  nowMs = Date.now(),
): RawSecurityNotificationInput[] {
  return [
    {
      id: "notif-key-rotation-1",
      organizationId,
      recipientUserId: userId,
      type: "key-rotation",
      deliveryStatus: "delivered",
      title: "Production API key rotation scheduled",
      summary:
        "Signing key rotation is due within 48 hours for your primary verification key.",
      detail:
        "Rotate the expiring API key ep_live_9876543210abcdef before the grace window closes to avoid verification interruptions.",
      createdAt: new Date(nowMs - 30 * 60 * 1000).toISOString(),
      deliveredAt: new Date(nowMs - 29 * 60 * 1000).toISOString(),
      isRead: false,
      incidentState: "none",
      deepLink: {
        href: "/developers/api-keys",
        label: "Manage API keys",
        targetOrganizationId: organizationId,
        expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    {
      id: "notif-session-risk-1",
      organizationId,
      recipientUserId: userId,
      type: "session-risk",
      deliveryStatus: "delivered",
      title: "Unfamiliar device session signal observed",
      summary:
        "Server telemetry observed a sign-in from an unrecognized browser family.",
      detail:
        "Review active sessions and revoke any unfamiliar device. Signal observed for account GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345.",
      createdAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
      deliveredAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
      isRead: false,
      incidentState: "unresolved",
      incidentId: "INC-SESSION-204",
      deepLink: {
        href: "/settings/sessions",
        label: "Inspect active sessions",
        targetOrganizationId: organizationId,
      },
    },
    {
      id: "notif-role-change-1",
      organizationId,
      recipientUserId: userId,
      type: "role-change",
      deliveryStatus: "pending",
      title: "Role approval threshold updated",
      summary:
        "Dual-administrator approval is now required for issuer role elevations.",
      detail:
        "Policy revision applied by organization administrator. Pending webhook confirmation to secondary audit sink.",
      createdAt: new Date(nowMs - 4 * 60 * 60 * 1000).toISOString(),
      isRead: false,
      incidentState: "none",
      deepLink: {
        href: "/settings/organizations/role-approval",
        label: "Review role approval policy",
        targetOrganizationId: organizationId,
      },
    },
    {
      id: "notif-dispute-1",
      organizationId,
      recipientUserId: userId,
      type: "dispute",
      deliveryStatus: "acknowledged",
      title: "Attestation dispute review recorded",
      summary:
        "An issuer attestation dispute was opened and acknowledged for audit tracking.",
      detail:
        "Dispute reference recorded for proof EP-8A42-91DC. Evidence bundle remains locked under retention policy.",
      createdAt: new Date(nowMs - 12 * 60 * 60 * 1000).toISOString(),
      deliveredAt: new Date(nowMs - 12 * 60 * 60 * 1000).toISOString(),
      acknowledgedAt: new Date(nowMs - 10 * 60 * 60 * 1000).toISOString(),
      isRead: true,
      incidentState: "investigating",
      incidentId: "INC-DISPUTE-118",
      deepLink: {
        href: "/settings/audit",
        label: "Open audit log",
        targetOrganizationId: organizationId,
      },
    },
    {
      id: "notif-protocol-incident-1",
      organizationId,
      recipientUserId: userId,
      type: "protocol-incident",
      deliveryStatus: "failed",
      title: "Protocol verifier latency advisory",
      summary:
        "Primary webhook delivery failed during elevated Stellar Horizon latency.",
      detail:
        "In-app notice recorded after webhook endpoint returned 503 with secret whsec_secretvalue1234567890.",
      createdAt: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
      failureReason:
        "Webhook delivery timed out after 3 attempts (secret whsec_secretvalue1234567890 redacted).",
      isRead: false,
      incidentState: "unresolved",
      incidentId: "INC-PROTO-901",
      deepLink: {
        href: "/settings/security",
        label: "View security posture",
        targetOrganizationId: organizationId,
      },
    },
  ];
}

export interface QueryNotificationsOptions {
  viewerOrganizationId: string;
  viewerUserId: string;
  cursor?: string | null;
  pageSize?: number;
  deliveryStatusFilter?: NotificationDeliveryStatus | "all";
  typeFilter?: SecurityNotificationType | "all";
  unreadOnly?: boolean;
  nowMs?: number;
}

/**
 * Filters, normalizes, and paginates notifications for a specific tenant and user.
 * Notifications from any other organization or user are strictly excluded.
 */
export function querySecurityNotifications(
  rawInputs: ReadonlyArray<RawSecurityNotificationInput>,
  options: QueryNotificationsOptions,
): PaginatedSecurityNotifications {
  const {
    viewerOrganizationId,
    viewerUserId,
    cursor = null,
    pageSize = 3,
    deliveryStatusFilter = "all",
    typeFilter = "all",
    unreadOnly = false,
    nowMs = Date.now(),
  } = options;

  if (!viewerOrganizationId || !viewerUserId) {
    throw new NotificationAccessDeniedError(
      "Viewer organization and user identifiers are required.",
    );
  }

  // Strict tenant & user scoping: never expose notices from another org or user
  const tenantScoped = rawInputs
    .filter(
      (item) =>
        item.organizationId === viewerOrganizationId &&
        item.recipientUserId === viewerUserId,
    )
    .map((item) => normalizeSecurityNotification(item, viewerOrganizationId, nowMs));

  const summary: NotificationInboxSummary = {
    totalCount: tenantScoped.length,
    unreadCount: tenantScoped.filter((n) => !n.isRead).length,
    unresolvedIncidentCount: tenantScoped.filter((n) => n.hasUnresolvedIncident)
      .length,
    byDeliveryStatus: {
      delivered: tenantScoped.filter((n) => n.deliveryStatus === "delivered")
        .length,
      pending: tenantScoped.filter((n) => n.deliveryStatus === "pending").length,
      acknowledged: tenantScoped.filter(
        (n) => n.deliveryStatus === "acknowledged",
      ).length,
      failed: tenantScoped.filter((n) => n.deliveryStatus === "failed").length,
    },
  };

  const filtered = tenantScoped.filter((item) => {
    if (
      deliveryStatusFilter !== "all" &&
      item.deliveryStatus !== deliveryStatusFilter
    ) {
      return false;
    }
    if (typeFilter !== "all" && item.type !== typeFilter) {
      return false;
    }
    if (unreadOnly && item.isRead) {
      return false;
    }
    return true;
  });

  const safePageSize = Math.max(1, Math.min(50, pageSize));
  let startIndex = 0;

  if (cursor) {
    const idx = filtered.findIndex((item) => item.id === cursor);
    if (idx !== -1) {
      startIndex = idx;
    }
  }

  const pageItems = filtered.slice(startIndex, startIndex + safePageSize);
  const nextItem = filtered[startIndex + safePageSize];
  const previousIndex = startIndex - safePageSize;
  const previousItem =
    startIndex > 0 ? filtered[Math.max(0, previousIndex)] : undefined;

  return {
    items: pageItems,
    nextCursor: nextItem ? nextItem.id : null,
    previousCursor: previousItem ? previousItem.id : null,
    totalCount: filtered.length,
    summary,
  };
}

/**
 * Acknowledges a notification idempotently.
 *
 * Guarantees:
 * - Rejects cross-tenant or cross-user acknowledgement attempts.
 * - Idempotent: acknowledging an already-acknowledged notice returns the same
 *   record without altering `acknowledgedAt`.
 * - Does NOT dismiss or resolve an unresolved incident (`hasUnresolvedIncident`
 *   remains true and `incidentState` is preserved).
 */
export function acknowledgeSecurityNotification(
  rawInputs: ReadonlyArray<RawSecurityNotificationInput>,
  params: {
    notificationId: string;
    viewerOrganizationId: string;
    viewerUserId: string;
    nowMs?: number;
  },
): {
  updatedInputs: RawSecurityNotificationInput[];
  record: SecurityNotificationRecord;
  wasAlreadyAcknowledged: boolean;
} {
  const {
    notificationId,
    viewerOrganizationId,
    viewerUserId,
    nowMs = Date.now(),
  } = params;

  const target = rawInputs.find((n) => n.id === notificationId);
  if (!target) {
    throw new NotificationAccessDeniedError("Notification not found.");
  }

  if (
    target.organizationId !== viewerOrganizationId ||
    target.recipientUserId !== viewerUserId
  ) {
    throw new NotificationAccessDeniedError(
      "Cannot acknowledge a notification belonging to another tenant or user.",
    );
  }

  if (target.deliveryStatus === "acknowledged" && target.acknowledgedAt) {
    return {
      updatedInputs: [...rawInputs],
      record: normalizeSecurityNotification(target, viewerOrganizationId, nowMs),
      wasAlreadyAcknowledged: true,
    };
  }

  const acknowledgedAt = new Date(nowMs).toISOString();
  const updatedTarget: RawSecurityNotificationInput = {
    ...target,
    deliveryStatus: "acknowledged",
    acknowledgedAt,
    isRead: true,
    // Explicitly preserve incidentState: acknowledgement never dismisses an unresolved incident
    incidentState: target.incidentState,
  };

  const updatedInputs = rawInputs.map((item) =>
    item.id === notificationId ? updatedTarget : item,
  );

  return {
    updatedInputs,
    record: normalizeSecurityNotification(
      updatedTarget,
      viewerOrganizationId,
      nowMs,
    ),
    wasAlreadyAcknowledged: false,
  };
}

/**
 * Attempts to dismiss a notification from the active inbox list.
 * Fails closed if the notification has an unresolved security incident.
 */
export function dismissSecurityNotification(
  rawInputs: ReadonlyArray<RawSecurityNotificationInput>,
  params: {
    notificationId: string;
    viewerOrganizationId: string;
    viewerUserId: string;
  },
): RawSecurityNotificationInput[] {
  const target = rawInputs.find((n) => n.id === params.notificationId);
  if (!target) {
    throw new NotificationAccessDeniedError("Notification not found.");
  }

  if (
    target.organizationId !== params.viewerOrganizationId ||
    target.recipientUserId !== params.viewerUserId
  ) {
    throw new NotificationAccessDeniedError(
      "Cannot dismiss a notification belonging to another tenant or user.",
    );
  }

  if (
    target.incidentState === "unresolved" ||
    target.incidentState === "investigating"
  ) {
    throw new UnresolvedIncidentDismissError();
  }

  return rawInputs.filter((n) => n.id !== params.notificationId);
}
