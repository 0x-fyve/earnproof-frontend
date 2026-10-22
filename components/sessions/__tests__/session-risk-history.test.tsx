import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { SessionRiskHistory } from "../session-risk-history";
import { RecentAuthExplainer } from "@/components/auth/recent-auth-explainer";
import {
  listActiveSessions,
  listRecentlyRevokedSessions,
} from "@/lib/sessions/store";
import { sanitizeSessionSecurityEvent } from "@/lib/sessions/risk-history";

const USER_ID = "user-1";
const ORG_ID = "org-alpha";

beforeEach(() => {
  window.localStorage.clear();
});

describe("SessionRiskHistory and RecentAuthExplainer (#244)", () => {
  it("renders descriptive risk labels for unknown devices and replay alerts without overclaiming", () => {
    const active = listActiveSessions(USER_ID);
    const revoked = listRecentlyRevokedSessions(USER_ID);

    render(
      <SessionRiskHistory
        userId={USER_ID}
        organizationId={ORG_ID}
        activeSessions={active}
        revokedSessions={revoked}
      />,
    );

    expect(
      screen.getByText("Unrecognized browser or OS family observed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Repeated challenge verification attempt observed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Labels describe observed signals only/i),
    ).toBeInTheDocument();
  });

  it("links risk events to active remote sessions and completes remote sign-out with confirmation", async () => {
    const active = listActiveSessions(USER_ID);
    const revoked = listRecentlyRevokedSessions(USER_ID);
    const onRemoteSignOutCompleted = jest.fn();

    render(
      <SessionRiskHistory
        userId={USER_ID}
        organizationId={ORG_ID}
        activeSessions={active}
        revokedSessions={revoked}
        onRemoteSignOutCompleted={onRemoteSignOutCompleted}
      />,
    );

    const revokeButtons = screen.getAllByRole("button", {
      name: "Revoke affected session",
    });
    expect(revokeButtons.length).toBeGreaterThan(0);

    fireEvent.click(revokeButtons[0]!);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Revoke session",
        hidden: true,
      }),
    );

    await waitFor(() => {
      expect(onRemoteSignOutCompleted).toHaveBeenCalledTimes(1);
    });

    const payload = onRemoteSignOutCompleted.mock.calls[0][0];
    expect(
      payload.revokedSessions.some((s: { id: string }) => s.id === "seed-1"),
    ).toBe(true);
  });

  it("blocks cross-tenant observation when viewerOrganizationId differs from organizationId", () => {
    const active = listActiveSessions(USER_ID);
    const revoked = listRecentlyRevokedSessions(USER_ID);

    render(
      <SessionRiskHistory
        userId={USER_ID}
        organizationId={ORG_ID}
        viewerUserId={USER_ID}
        viewerOrganizationId="org-other-tenant"
        activeSessions={active}
        revokedSessions={revoked}
      />,
    );

    expect(
      screen.getByText("Tenant Session History Restricted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Unrecognized browser or OS family observed"),
    ).not.toBeInTheDocument();
  });

  it("displays redacted device and location context and never leaks raw IPs or fingerprints", () => {
    const active = listActiveSessions(USER_ID);
    const revoked = listRecentlyRevokedSessions(USER_ID);
    const customEvent = sanitizeSessionSecurityEvent({
      id: "evt-redacted-check",
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: "seed-1",
      eventType: "risk-signal-observed",
      riskReasonCode: "unknown-device",
      occurredAt: "2026-10-19T15:00:00.000Z",
      deviceContext:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0",
      locationContext: "198.51.100.12",
      detail: "Login from 198.51.100.12 with fp_id=secretfingerprint999",
    });

    render(
      <SessionRiskHistory
        userId={USER_ID}
        organizationId={ORG_ID}
        activeSessions={active}
        revokedSessions={revoked}
        events={[customEvent]}
      />,
    );

    expect(screen.queryAllByText(/198\.51\.100\.12/)).toHaveLength(0);
    expect(screen.queryAllByText(/secretfingerprint999/)).toHaveLength(0);
    expect(screen.getAllByText("Windows - Chrome").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Coarse region (precise location redacted)").length,
    ).toBeGreaterThan(0);
  });

  it("explains when sensitive actions require a fresh wallet signature and shows recent-auth expiry", () => {
    const nowMs = 1_700_000_000_000;
    const onVerify = jest.fn();

    const { rerender } = render(
      <RecentAuthExplainer
        lastVerifiedAtMs={nowMs - 10 * 60_000}
        nowMs={nowMs}
        onVerifyFreshSignature={onVerify}
      />,
    );

    expect(screen.getByText("Window expired")).toBeInTheDocument();
    expect(
      screen.getByText("Creating or revoking API keys"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Verify fresh wallet signature" }),
    );
    expect(onVerify).toHaveBeenCalledTimes(1);

    rerender(
      <RecentAuthExplainer
        lastVerifiedAtMs={nowMs - 60_000}
        nowMs={nowMs}
        onVerifyFreshSignature={onVerify}
      />,
    );
    expect(screen.getByText("Fresh signature active")).toBeInTheDocument();
  });
});
