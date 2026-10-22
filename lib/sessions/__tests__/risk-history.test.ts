import {
  computeRecentAuthExpiryStatus,
  getSessionRiskDescriptor,
  listSessionSecurityEvents,
  recordSessionSecurityEvent,
  redactSessionSecurityText,
  resolveLinkedSession,
  sanitizeDeviceContext,
  sanitizeLocationContext,
  sanitizeSessionSecurityEvent,
  signOutSessionFromRiskEvent,
  TenantSessionAccessError,
} from "../risk-history";
import { listActiveSessions, listRecentlyRevokedSessions } from "../store";

const USER_A = "user-a";
const USER_B = "user-b";
const ORG_A = "org-alpha";
const ORG_B = "org-beta";

beforeEach(() => {
  window.localStorage.clear();
});

describe("session risk and reauthentication history (#244)", () => {
  describe("risk descriptors and non-overclaiming labels", () => {
    it("returns descriptive, evidence-bounded labels for known risk codes without implying certainty", () => {
      const unknownDevice = getSessionRiskDescriptor("unknown-device");
      const replayAlert = getSessionRiskDescriptor("replay-alert");
      const regionShift = getSessionRiskDescriptor("coarse-region-shift");

      expect(unknownDevice?.label).toBe(
        "Unrecognized browser or OS family observed",
      );
      expect(unknownDevice?.evidenceSummary).toContain("Shared or updated browsers");
      expect(replayAlert?.label).toBe(
        "Repeated challenge verification attempt observed",
      );
      expect(replayAlert?.evidenceSummary).toContain("duplicate network retry");
      expect(regionShift?.label).toBe("Coarse network region change observed");
    });

    it("falls back safely to unclassified-signal for unrecognized risk codes", () => {
      const fallback = getSessionRiskDescriptor("totally-unknown-server-code");
      expect(fallback?.code).toBe("unclassified-signal");
      expect(fallback?.label).toBe(
        "Unclassified server security signal observed",
      );
      expect(fallback?.evidenceSummary).toContain(
        "does not confirm unauthorized access",
      );
    });

    it("returns null when riskReasonCode is null or empty", () => {
      expect(getSessionRiskDescriptor(null)).toBeNull();
      expect(getSessionRiskDescriptor(undefined)).toBeNull();
      expect(getSessionRiskDescriptor("")).toBeNull();
    });
  });

  describe("privacy redaction for device fingerprints and precise locations", () => {
    it("reduces raw User-Agent strings to coarse OS and browser labels", () => {
      const result = sanitizeDeviceContext(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.91 Safari/537.36",
      );
      expect(result.label).toBe("macOS - Chrome");
      expect(result.wasRedacted).toBe(true);
    });

    it("strips precise GPS coordinates, IPv4/IPv6 addresses, and street addresses from location context", () => {
      expect(sanitizeLocationContext("37.7749, -122.4194")).toEqual({
        coarseRegion: "Coarse region (precise location redacted)",
        wasRedacted: true,
      });
      expect(sanitizeLocationContext("203.0.113.42")).toEqual({
        coarseRegion: "Coarse region (precise location redacted)",
        wasRedacted: true,
      });
      expect(sanitizeLocationContext("742 Evergreen Terrace Street")).toEqual({
        coarseRegion: "Coarse region (precise location redacted)",
        wasRedacted: true,
      });
      expect(sanitizeLocationContext("Europe")).toEqual({
        coarseRegion: "Europe",
        wasRedacted: false,
      });
    });

    it("redacts fingerprint hashes, IP addresses, GPS coordinates, and tokens from event detail text", () => {
      const raw =
        "Alert from 198.51.100.77 at 40.7128, -74.0060 with fp_hash=9f8e7d6c5b4a3210 and account GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345";
      const result = redactSessionSecurityText(raw);

      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain("198.51.100.77");
      expect(result.text).not.toContain("40.7128");
      expect(result.text).not.toContain("9f8e7d6c5b4a3210");
      expect(result.text).not.toContain(
        "GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345",
      );
    });

    it("strips rawFingerprint, ipAddress, coordinates, and rawToken fields when normalizing events", () => {
      const sanitized = sanitizeSessionSecurityEvent({
        id: "evt-raw-1",
        userId: USER_A,
        organizationId: ORG_A,
        sessionId: "seed-1",
        eventType: "risk-signal-observed",
        riskReasonCode: "unknown-device",
        occurredAt: "2026-10-19T12:00:00.000Z",
        deviceContext:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
        locationContext: "192.0.2.99",
        detail: "Observed from 192.0.2.99 with canvas_id=abcdef1234567890",
        rawFingerprint: "canvas-fp-999999",
        ipAddress: "192.0.2.99",
        coordinates: { lat: 51.5074, lon: -0.1278 },
        rawToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig12345",
      });

      expect(sanitized.deviceLabel).toBe("iOS - Safari");
      expect(sanitized.coarseRegion).toBe(
        "Coarse region (precise location redacted)",
      );
      expect(sanitized.detail).not.toContain("192.0.2.99");
      expect(sanitized.detail).not.toContain("abcdef1234567890");
      expect(sanitized.redactedFieldsCount).toBeGreaterThanOrEqual(6);
      expect(sanitized).not.toHaveProperty("rawFingerprint");
      expect(sanitized).not.toHaveProperty("ipAddress");
      expect(sanitized).not.toHaveProperty("coordinates");
      expect(sanitized).not.toHaveProperty("rawToken");
    });
  });

  describe("tenant and user authorization isolation", () => {
    it("prevents one organization from observing another tenant's session history", () => {
      listSessionSecurityEvents({
        userId: USER_A,
        organizationId: ORG_A,
      });

      expect(() =>
        listSessionSecurityEvents({
          userId: USER_A,
          organizationId: ORG_A,
          viewerUserId: USER_A,
          viewerOrganizationId: ORG_B,
        }),
      ).toThrow(TenantSessionAccessError);
    });

    it("prevents one user from observing another user's session history within the same tenant", () => {
      expect(() =>
        listSessionSecurityEvents({
          userId: USER_A,
          organizationId: ORG_A,
          viewerUserId: USER_B,
          viewerOrganizationId: ORG_A,
        }),
      ).toThrow(TenantSessionAccessError);
    });

    it("filters out any cross-tenant event injected into localStorage (defense-in-depth)", () => {
      window.localStorage.setItem(
        `earnproof.session-risk-history.${ORG_A}::${USER_A}`,
        JSON.stringify([
          {
            id: "legit-evt",
            userId: USER_A,
            organizationId: ORG_A,
            sessionId: "seed-1",
            eventType: "reauth-verified",
            occurredAt: "2026-10-19T12:00:00.000Z",
          },
          {
            id: "injected-cross-tenant",
            userId: USER_A,
            organizationId: ORG_B,
            sessionId: "seed-2",
            eventType: "replay-blocked",
            occurredAt: "2026-10-19T12:05:00.000Z",
          },
        ]),
      );

      const events = listSessionSecurityEvents({
        userId: USER_A,
        organizationId: ORG_A,
        viewerUserId: USER_A,
        viewerOrganizationId: ORG_A,
      });

      expect(events.map((e) => e.id)).toEqual(["legit-evt"]);
    });
  });

  describe("linking risk events to sessions and remote sign-out", () => {
    it("resolves active current, active remote, and revoked sessions accurately", () => {
      const active = listActiveSessions(USER_A);
      const revoked = listRecentlyRevokedSessions(USER_A);

      const currentResolution = resolveLinkedSession(
        { sessionId: `current-${USER_A}`, deviceLabel: "macOS - Chrome" },
        active,
        revoked,
      );
      expect(currentResolution.state).toBe("active-current");
      expect(currentResolution.canRemoteSignOut).toBe(false);

      const remoteResolution = resolveLinkedSession(
        { sessionId: "seed-1", deviceLabel: "iOS - Safari" },
        active,
        revoked,
      );
      expect(remoteResolution.state).toBe("active-remote");
      expect(remoteResolution.canRemoteSignOut).toBe(true);
    });

    it("signs out an affected remote session from a risk event and records a revocation event", () => {
      const result = signOutSessionFromRiskEvent({
        userId: USER_A,
        organizationId: ORG_A,
        sessionId: "seed-1",
        riskEventId: `evt-unknown-device-${ORG_A}`,
      });

      expect(result.activeSessions.some((s) => s.id === "seed-1")).toBe(false);
      expect(result.revokedSessions.some((s) => s.id === "seed-1")).toBe(true);
      expect(
        result.events.some(
          (e) => e.eventType === "session-revoked" && e.sessionId === "seed-1",
        ),
      ).toBe(true);

      const postRevokeResolution = resolveLinkedSession(
        { sessionId: "seed-1", deviceLabel: "iOS - Safari" },
        result.activeSessions,
        result.revokedSessions,
      );
      expect(postRevokeResolution.state).toBe("revoked");
      expect(postRevokeResolution.canRemoteSignOut).toBe(false);
    });

    it("records custom reauthentication events scoped to the tenant", () => {
      const recorded = recordSessionSecurityEvent(
        {
          id: "custom-step-up",
          userId: USER_A,
          organizationId: ORG_A,
          sessionId: `current-${USER_A}`,
          eventType: "reauth-verified",
          riskReasonCode: "sensitive-action-step-up",
          occurredAt: "2026-10-19T14:00:00.000Z",
          deviceContext: "macOS - Chrome",
          locationContext: "North America",
          detail: "Step-up signature completed for API key revocation.",
        },
        { viewerUserId: USER_A, viewerOrganizationId: ORG_A },
      );

      expect(recorded.riskReasonCode).toBe("sensitive-action-step-up");
      const all = listSessionSecurityEvents({
        userId: USER_A,
        organizationId: ORG_A,
      });
      expect(all[0]?.id).toBe("custom-step-up");
    });
  });

  describe("recent-auth expiry calculation", () => {
    const baseNow = 1_700_000_000_000;

    it("reports unverified when no signature has been verified in this tab", () => {
      const state = computeRecentAuthExpiryStatus({
        lastVerifiedAtMs: null,
        nowMs: baseNow,
      });
      expect(state.status).toBe("unverified");
      expect(state.isFresh).toBe(false);
    });

    it("reports fresh when verified well within the 5-minute window", () => {
      const state = computeRecentAuthExpiryStatus({
        lastVerifiedAtMs: baseNow - 60_000,
        nowMs: baseNow,
      });
      expect(state.status).toBe("fresh");
      expect(state.isFresh).toBe(true);
      expect(state.remainingMs).toBe(4 * 60_000);
    });

    it("reports expiring-soon when <= 60s remain", () => {
      const state = computeRecentAuthExpiryStatus({
        lastVerifiedAtMs: baseNow - (4 * 60_000 + 30_000),
        nowMs: baseNow,
      });
      expect(state.status).toBe("expiring-soon");
      expect(state.isFresh).toBe(true);
      expect(state.remainingMs).toBe(30_000);
    });

    it("reports expired once the recent-auth window elapses", () => {
      const state = computeRecentAuthExpiryStatus({
        lastVerifiedAtMs: baseNow - 5 * 60_000 - 1,
        nowMs: baseNow,
      });
      expect(state.status).toBe("expired");
      expect(state.isFresh).toBe(false);
      expect(state.remainingMs).toBe(0);
    });
  });
});
