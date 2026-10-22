import {
  acknowledgeSecurityNotification,
  createSeedNotifications,
  dismissSecurityNotification,
  normalizeNotificationType,
  normalizeSecurityNotification,
  NotificationAccessDeniedError,
  querySecurityNotifications,
  redactNotificationText,
  UnresolvedIncidentDismissError,
  validateNotificationDeepLink,
  type RawSecurityNotificationInput,
} from "../security-notifications";

const ORG_A = "org-alpha";
const ORG_B = "org-beta";
const USER_A = "user-1";
const USER_B = "user-2";

describe("tenant-scoped security notification inbox (#255)", () => {
  describe("redaction and unknown type normalization", () => {
    it("redacts API keys, webhook secrets, and telemetry values", () => {
      const raw =
        "Webhook failed with secret whsec_abcdef1234567890 and live key ep_live_9876543210fedcba for account GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345";
      const redacted = redactNotificationText(raw);

      expect(redacted).not.toContain("whsec_abcdef1234567890");
      expect(redacted).not.toContain("ep_live_9876543210fedcba");
      expect(redacted).not.toContain(
        "GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345",
      );
      expect(redacted).toContain("<redacted-secret>");
    });

    it("normalizes unknown notification types safely without throwing", () => {
      const result = normalizeNotificationType("future_unknown_security_alert");
      expect(result.type).toBe("unknown");
      expect(result.rawType).toBe("future_unknown_security_alert");
      expect(result.typeLabel).toBe("Unclassified security notice");
    });

    it("normalizes known types correctly", () => {
      expect(normalizeNotificationType("key-rotation").type).toBe("key-rotation");
      expect(normalizeNotificationType("session-risk").type).toBe("session-risk");
      expect(normalizeNotificationType("role-change").type).toBe("role-change");
      expect(normalizeNotificationType("dispute").type).toBe("dispute");
      expect(normalizeNotificationType("protocol-incident").type).toBe(
        "protocol-incident",
      );
    });
  });

  describe("tenant-scoped deep links and stale link handling", () => {
    it("validates allowed internal tenant-scoped deep links", () => {
      const validated = validateNotificationDeepLink(
        {
          href: "/settings/security",
          label: "View security settings",
          targetOrganizationId: ORG_A,
        },
        ORG_A,
      );
      expect(validated.status).toBe("valid");
      expect(validated.safeHref).toBe("/settings/security");
    });

    it("blocks cross-tenant deep links", () => {
      const validated = validateNotificationDeepLink(
        {
          href: "/settings/security",
          label: "View other org settings",
          targetOrganizationId: ORG_B,
        },
        ORG_A,
      );
      expect(validated.status).toBe("cross-tenant-blocked");
      expect(validated.safeHref).toBeNull();
      expect(validated.reason).toContain("cross-tenant navigation");
    });

    it("detects expired deep links as stale", () => {
      const nowMs = 1_700_000_000_000;
      const validated = validateNotificationDeepLink(
        {
          href: "/developers/api-keys",
          label: "Rotate API key",
          targetOrganizationId: ORG_A,
          expiresAt: new Date(nowMs - 60_000).toISOString(),
        },
        ORG_A,
        nowMs,
      );
      expect(validated.status).toBe("stale-link");
      expect(validated.safeHref).toBeNull();
      expect(validated.reason).toContain("expired");
    });

    it("detects removed resources as stale", () => {
      const validated = validateNotificationDeepLink(
        {
          href: "/settings/issuers",
          label: "View removed issuer",
          targetOrganizationId: ORG_A,
          resourceRemoved: true,
        },
        ORG_A,
      );
      expect(validated.status).toBe("stale-link");
      expect(validated.safeHref).toBeNull();
    });

    it("blocks unsafe external or protocol-relative URLs", () => {
      const validated = validateNotificationDeepLink(
        {
          href: "https://evil.com/phish",
          label: "External phishing link",
        },
        ORG_A,
      );
      expect(validated.status).toBe("unsafe-route-blocked");
      expect(validated.safeHref).toBeNull();
    });
  });

  describe("querySecurityNotifications: tenant scoping, unread counts, and pagination", () => {
    it("never returns notifications from another tenant or another user", () => {
      const inputs: RawSecurityNotificationInput[] = [
        {
          id: "notice-a1",
          organizationId: ORG_A,
          recipientUserId: USER_A,
          type: "session-risk",
          deliveryStatus: "delivered",
          title: "Session risk A",
          summary: "Notice for A",
          detail: "Detail A",
          createdAt: "2026-10-19T10:00:00.000Z",
        },
        {
          id: "notice-b1",
          organizationId: ORG_B,
          recipientUserId: USER_A,
          type: "session-risk",
          deliveryStatus: "delivered",
          title: "Session risk B",
          summary: "Notice for Org B",
          detail: "Detail B",
          createdAt: "2026-10-19T10:00:00.000Z",
        },
        {
          id: "notice-a2-diff-user",
          organizationId: ORG_A,
          recipientUserId: USER_B,
          type: "session-risk",
          deliveryStatus: "delivered",
          title: "Session risk other user",
          summary: "Notice for user 2",
          detail: "Detail user 2",
          createdAt: "2026-10-19T10:00:00.000Z",
        },
      ];

      const result = querySecurityNotifications(inputs, {
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("notice-a1");
      expect(result.summary.totalCount).toBe(1);
    });

    it("accurately calculates unread counts and delivery breakdown", () => {
      const seeds = createSeedNotifications(ORG_A, USER_A);
      const result = querySecurityNotifications(seeds, {
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
        pageSize: 10,
      });

      expect(result.summary.totalCount).toBe(seeds.length);
      expect(result.summary.unreadCount).toBeGreaterThan(0);
      expect(result.summary.unresolvedIncidentCount).toBeGreaterThan(0);
      expect(result.summary.byDeliveryStatus.delivered).toBeGreaterThanOrEqual(1);
      expect(result.summary.byDeliveryStatus.pending).toBeGreaterThanOrEqual(1);
    });

    it("paginates notifications forward and backward cleanly", () => {
      const seeds = createSeedNotifications(ORG_A, USER_A);
      const page1 = querySecurityNotifications(seeds, {
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
        pageSize: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBe(seeds[2]?.id);
      expect(page1.previousCursor).toBeNull();

      const page2 = querySecurityNotifications(seeds, {
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
        pageSize: 2,
        cursor: page1.nextCursor,
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.items[0]?.id).toBe(seeds[2]?.id);
      expect(page2.previousCursor).not.toBeNull();
    });
  });

  describe("idempotent acknowledgement and unresolved incident protection", () => {
    it("acknowledges a notification idempotently without altering initial acknowledgedAt timestamp", () => {
      const seeds = createSeedNotifications(ORG_A, USER_A);
      const targetId = "notif-key-rotation-1";
      const now1 = 1_700_000_100_000;
      const now2 = 1_700_000_900_000;

      const firstAck = acknowledgeSecurityNotification(seeds, {
        notificationId: targetId,
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
        nowMs: now1,
      });

      expect(firstAck.wasAlreadyAcknowledged).toBe(false);
      expect(firstAck.record.deliveryStatus).toBe("acknowledged");
      expect(firstAck.record.isRead).toBe(true);
      const firstTimestamp = firstAck.record.acknowledgedAt;

      // Second acknowledgement call
      const secondAck = acknowledgeSecurityNotification(firstAck.updatedInputs, {
        notificationId: targetId,
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
        nowMs: now2,
      });

      expect(secondAck.wasAlreadyAcknowledged).toBe(true);
      expect(secondAck.record.acknowledgedAt).toBe(firstTimestamp);
    });

    it("acknowledging a notification does not dismiss or resolve an unresolved incident", () => {
      const seeds = createSeedNotifications(ORG_A, USER_A);
      const incidentNoticeId = "notif-session-risk-1"; // incidentState: "unresolved"

      const ackResult = acknowledgeSecurityNotification(seeds, {
        notificationId: incidentNoticeId,
        viewerOrganizationId: ORG_A,
        viewerUserId: USER_A,
      });

      expect(ackResult.record.deliveryStatus).toBe("acknowledged");
      expect(ackResult.record.hasUnresolvedIncident).toBe(true);
      expect(ackResult.record.incidentState).toBe("unresolved");
      expect(ackResult.record.canDismiss).toBe(false);

      // Attempting to dismiss an unresolved incident throws UnresolvedIncidentDismissError
      expect(() =>
        dismissSecurityNotification(ackResult.updatedInputs, {
          notificationId: incidentNoticeId,
          viewerOrganizationId: ORG_A,
          viewerUserId: USER_A,
        }),
      ).toThrow(UnresolvedIncidentDismissError);
    });

    it("rejects cross-tenant acknowledgement attempts", () => {
      const seeds = createSeedNotifications(ORG_A, USER_A);
      expect(() =>
        acknowledgeSecurityNotification(seeds, {
          notificationId: "notif-key-rotation-1",
          viewerOrganizationId: ORG_B,
          viewerUserId: USER_A,
        }),
      ).toThrow(NotificationAccessDeniedError);
    });
  });
});
