import { render, screen, fireEvent } from "@testing-library/react";
import { ConsistencyIndicator } from "../consistency-indicator";
import type { ResourceConsistencyState } from "@/lib/query/read-after-write";

const ORG_A = "org-alpha";
const ORG_B = "org-beta";

describe("ConsistencyIndicator Component (#256)", () => {
  const pendingState: ResourceConsistencyState<{ title: string }> = {
    organizationId: ORG_A,
    resourceType: "organization-policy",
    resourceId: "policy-residency",
    routePathname: "/settings/organizations/data-residency",
    status: "pending-propagation",
    data: { title: "Updated Residency Policy" },
    rollbackSnapshot: null,
    expectedVersion: 3,
    observedReplicaVersion: 2,
    latestRequestSeq: 5,
    consistencyToken: {
      token: "tok-abc",
      organizationId: ORG_A,
      resourceType: "organization-policy",
      resourceId: "policy-residency",
      expectedVersion: 3,
      issuedAt: "2026-10-19T10:00:00.000Z",
      expiresAt: "2026-10-19T10:00:15.000Z",
      correlationId: "CORR-DATA-RES-101",
    },
    ignoredStaleReadCount: 1,
    droppedOutOfOrderCount: 0,
    updatedAt: "2026-10-19T10:00:01.000Z",
  };

  const expiredState: ResourceConsistencyState<{ title: string }> = {
    ...pendingState,
    status: "expired",
  };

  const consistentState: ResourceConsistencyState<{ title: string }> = {
    ...pendingState,
    status: "consistent",
    observedReplicaVersion: 3,
  };

  it("renders pending-propagation banner with version details and status role", () => {
    const onRetry = jest.fn();

    render(
      <ConsistencyIndicator
        state={pendingState}
        viewerOrganizationId={ORG_A}
        expectedResourceType="organization-policy"
        expectedResourceId="policy-residency"
        resourceLabel="Data residency policy"
        onRetryRead={onRetry}
      />,
    );

    expect(screen.getByTestId("consistency-pending-banner")).toBeInTheDocument();
    expect(screen.getByText("Syncing replicas")).toBeInTheDocument();
    expect(
      screen.getByText(/target v3/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/observed replica v2 of expected v3/i),
    ).toBeInTheDocument();

    const checkBtn = screen.getByRole("button", { name: "Check replica status" });
    fireEvent.click(checkBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders expired banner with alert role, retry button, support link, and correlation ID", () => {
    const onRetry = jest.fn();

    render(
      <ConsistencyIndicator
        state={expiredState}
        viewerOrganizationId={ORG_A}
        expectedResourceType="organization-policy"
        expectedResourceId="policy-residency"
        resourceLabel="Data residency policy"
        onRetryRead={onRetry}
      />,
    );

    expect(screen.getByTestId("consistency-expired-banner")).toBeInTheDocument();
    expect(screen.getByText("Propagation delayed")).toBeInTheDocument();
    expect(screen.getByText("CORR-DATA-RES-101")).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "System Status" }),
    ).toHaveAttribute("href", "/status");
    expect(
      screen.getByRole("link", { name: "Contact Support" }),
    ).toHaveAttribute("href", "/contact");

    const retryBtn = screen.getByRole("button", {
      name: "Retry consistency check",
    });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("clears completely and renders nothing when state is consistent", () => {
    const { container } = render(
      <ConsistencyIndicator
        state={consistentState}
        viewerOrganizationId={ORG_A}
        expectedResourceType="organization-policy"
        expectedResourceId="policy-residency"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("rejects cross-tenant state and renders nothing", () => {
    const { container } = render(
      <ConsistencyIndicator
        state={pendingState}
        viewerOrganizationId={ORG_B} // Viewer is Org B, but state is Org A
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("rejects mismatched-resource state and renders nothing", () => {
    const { container } = render(
      <ConsistencyIndicator
        state={pendingState}
        viewerOrganizationId={ORG_A}
        expectedResourceType="different-resource-type"
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
