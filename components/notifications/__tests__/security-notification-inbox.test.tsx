import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SecurityNotificationInbox } from "../security-notification-inbox";
import type { RawSecurityNotificationInput } from "@/lib/api/security-notifications";

const ORG_A = "org-alpha";
const USER_A = "user-1";

describe("SecurityNotificationInbox Component (#255)", () => {
  const customNotices: RawSecurityNotificationInput[] = [
    {
      id: "notice-unknown-type",
      organizationId: ORG_A,
      recipientUserId: USER_A,
      type: "custom-unrecognized-signal",
      deliveryStatus: "delivered",
      title: "Unknown security telemetry notice",
      summary: "Summary of unknown notice with secret whsec_topsecret12345678",
      detail:
        "Detailed notice containing secret whsec_topsecret12345678 and account GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345",
      createdAt: "2026-10-19T10:00:00.000Z",
      isRead: false,
      incidentState: "none",
      deepLink: {
        href: "/settings/security",
        label: "Security posture",
        targetOrganizationId: ORG_A,
      },
    },
    {
      id: "notice-stale-link",
      organizationId: ORG_A,
      recipientUserId: USER_A,
      type: "key-rotation",
      deliveryStatus: "delivered",
      title: "Stale link rotation notice",
      summary: "Rotation link has expired",
      detail: "Action link expired 1 hour ago.",
      createdAt: "2026-10-19T09:00:00.000Z",
      isRead: false,
      incidentState: "none",
      deepLink: {
        href: "/developers/api-keys",
        label: "Expired link",
        targetOrganizationId: ORG_A,
        expiresAt: "2026-10-19T08:00:00.000Z", // expired
      },
    },
    {
      id: "notice-unresolved-incident",
      organizationId: ORG_A,
      recipientUserId: USER_A,
      type: "protocol-incident",
      deliveryStatus: "pending",
      title: "Protocol outage incident",
      summary: "Unresolved incident that cannot be dismissed",
      detail: "Outage is currently under investigation.",
      createdAt: "2026-10-19T08:00:00.000Z",
      isRead: false,
      incidentState: "unresolved",
      incidentId: "INC-999",
    },
    {
      id: "notice-extra-page",
      organizationId: ORG_A,
      recipientUserId: USER_A,
      type: "role-change",
      deliveryStatus: "acknowledged",
      title: "Role elevation notice",
      summary: "Notice on page 2",
      detail: "Detail for page 2.",
      createdAt: "2026-10-19T07:00:00.000Z",
      acknowledgedAt: "2026-10-19T07:30:00.000Z",
      isRead: true,
      incidentState: "none",
    },
  ];

  it("renders unread counts, status metrics, and preference links", () => {
    render(
      <SecurityNotificationInbox
        viewerOrganizationId={ORG_A}
        viewerUserId={USER_A}
        initialNotifications={customNotices}
        pageSize={2}
        nowMs={new Date("2026-10-19T12:00:00.000Z").getTime()}
      />,
    );

    expect(screen.getByTestId("inbox-unread-count")).toHaveTextContent("3");
    expect(screen.getByTestId("inbox-unresolved-count")).toHaveTextContent("1");
    expect(
      screen.getByRole("link", { name: "Display & Notification Preferences" }),
    ).toHaveAttribute("href", "/settings/preferences");
    expect(
      screen.getByRole("link", { name: "Security Posture Settings" }),
    ).toHaveAttribute("href", "/settings/security");
  });

  it("safely renders unknown notice types and redacts sensitive secrets", () => {
    render(
      <SecurityNotificationInbox
        viewerOrganizationId={ORG_A}
        viewerUserId={USER_A}
        initialNotifications={customNotices}
        pageSize={2}
        nowMs={new Date("2026-10-19T12:00:00.000Z").getTime()}
      />,
    );

    expect(screen.getAllByText("Unclassified security notice").length).toBeGreaterThan(0);
    expect(screen.queryByText(/whsec_topsecret12345678/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/GABCDEFGHIJKLMNOPQRSTUVWXYZ2345672345672345672345672345/),
    ).not.toBeInTheDocument();
  });

  it("handles pagination between pages with CursorPagination", async () => {
    render(
      <SecurityNotificationInbox
        viewerOrganizationId={ORG_A}
        viewerUserId={USER_A}
        initialNotifications={customNotices}
        pageSize={2}
        nowMs={new Date("2026-10-19T12:00:00.000Z").getTime()}
      />,
    );

    expect(
      screen.getAllByText("Unknown security telemetry notice").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Stale link rotation notice")).toBeInTheDocument();
    expect(screen.queryByText("Role elevation notice")).not.toBeInTheDocument();

    const nextButton = screen.getByRole("button", { name: "Next page" });
    expect(nextButton).not.toBeDisabled();
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(
        screen.getAllByText("Protocol outage incident").length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("Role elevation notice")).toBeInTheDocument();
    });

    const prevButton = screen.getByRole("button", { name: "Previous page" });
    expect(prevButton).not.toBeDisabled();
    fireEvent.click(prevButton);

    await waitFor(() => {
      expect(
        screen.getAllByText("Unknown security telemetry notice").length,
      ).toBeGreaterThan(0);
    });
  });

  it("displays warnings for stale or expired deep links in the detail panel", () => {
    render(
      <SecurityNotificationInbox
        viewerOrganizationId={ORG_A}
        viewerUserId={USER_A}
        initialNotifications={customNotices}
        pageSize={2}
        nowMs={new Date("2026-10-19T12:00:00.000Z").getTime()}
      />,
    );

    // Inspect the stale link notice directly
    const staleRow = screen.getByTestId("notification-row-notice-stale-link");
    fireEvent.click(
      within(staleRow).getByRole("button", { name: "Inspect notice" }),
    );

    expect(screen.getByTestId("deep-link-warning")).toBeInTheDocument();
    expect(screen.getByTestId("deep-link-warning")).toHaveTextContent(
      "This action link has expired",
    );
  });

  it("acknowledges notices idempotently and disables dismiss for unresolved incidents", async () => {
    render(
      <SecurityNotificationInbox
        viewerOrganizationId={ORG_A}
        viewerUserId={USER_A}
        initialNotifications={customNotices}
        pageSize={5}
        nowMs={new Date("2026-10-19T12:00:00.000Z").getTime()}
      />,
    );

    // Select the unresolved incident notice
    const incidentRow = screen.getByTestId(
      "notification-row-notice-unresolved-incident",
    );
    fireEvent.click(
      within(incidentRow).getByRole("button", { name: "Inspect notice" }),
    );

    // Dismiss button should be disabled because incidentState is unresolved
    const dismissBtn = screen.getByRole("button", {
      name: "Cannot dismiss unresolved incident",
    });
    expect(dismissBtn).toBeDisabled();

    // Acknowledge notice
    const ackBtn = within(incidentRow).getByRole("button", {
      name: "Acknowledge notice",
    });
    fireEvent.click(ackBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Acknowledged receipt of notice/i),
      ).toBeInTheDocument();
    });

    // Re-clicking acknowledge is idempotent
    const reAckBtn = within(incidentRow).getByRole("button", {
      name: "Re-confirm acknowledgement",
    });
    fireEvent.click(reAckBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Notice was already acknowledged/i),
      ).toBeInTheDocument();
    });
  });
});
