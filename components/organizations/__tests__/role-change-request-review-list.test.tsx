/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { RoleChangeRequestReviewList } from "../role-change-request-review-list";
import type { RoleChangeRequest } from "@/lib/role-change-requests/store";
import type { RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";

// Uses the real current time (not a fixed historical date): the
// component under test always evaluates expiry/reauth-recency against
// Date.now() internally (it has no `now` override param, unlike the
// pure functions in lib/validation/role-change-request.ts), so fixtures
// must be relative to "now" to stay meaningfully fresh/non-expired.
const NOW = new Date();

function request(overrides: Partial<RoleChangeRequest> = {}): RoleChangeRequest {
  return {
    id: "request-1",
    organizationId: "org-1",
    requesterId: "requester-1",
    targetMemberId: "member-1",
    oldRole: "MEMBER",
    proposedRole: "ADMIN",
    justification: "Needs admin access for the launch.",
    state: "pending",
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    approvals: [],
    ...overrides,
  };
}

const POLICY: RoleApprovalPolicy = {
  schemaVersion: 1,
  policyVersion: 1,
  updatedAt: NOW.toISOString(),
  rules: [
    { role: "OWNER", requiresApproval: true },
    { role: "ADMIN", requiresApproval: true },
    { role: "MEMBER", requiresApproval: false },
    { role: "VIEWER", requiresApproval: false },
  ],
  approvalsRequired: 2,
  requestValidityHours: 72,
  allowSelfApproval: false,
};

const noop = () => undefined;

describe("RoleChangeRequestReviewList", () => {
  it("shows an empty state with no requests", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[]}
        policy={POLICY}
        currentActorId="viewer-1"
        reauthedAt={null}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );
    expect(screen.getByText(/no role change requests/i)).toBeInTheDocument();
  });

  it("renders requester, target member, old/proposed roles, and justification", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request()]}
        policy={POLICY}
        currentActorId="reviewer-1"
        reauthedAt={NOW.toISOString()}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.getByText("requester-1")).toBeInTheDocument();
    expect(screen.getByText("member-1")).toBeInTheDocument();
    expect(screen.getByText(/needs admin access/i)).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "Member → to Admin")).toBeInTheDocument();
  });

  it("renders every lifecycle state with a visible, accessible label", () => {
    const states: RoleChangeRequest["state"][] = ["pending", "approved", "rejected", "cancelled", "expired"];
    for (const state of states) {
      const { unmount } = render(
        <RoleChangeRequestReviewList
          requests={[request({ id: `request-${state}`, state })]}
          policy={POLICY}
          currentActorId="reviewer-1"
          reauthedAt={NOW.toISOString()}
          onApprove={noop}
          onReject={noop}
          onCancel={noop}
          onRequestReauth={noop}
        />,
      );
      expect(screen.getByTestId("request-state-badge").textContent?.toLowerCase()).toContain(state === "expired" ? "expired" : state);
      unmount();
    }
  });

  it("hides approve/reject controls and shows a denial message for the requester viewing their own request", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request()]}
        policy={POLICY}
        currentActorId="requester-1"
        reauthedAt={NOW.toISOString()}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot approve or reject your own request/i)).toBeInTheDocument();
  });

  it("shows a cancel control to the requester on their own pending request", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request()]}
        policy={POLICY}
        currentActorId="requester-1"
        reauthedAt={null}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /cancel request/i })).toBeInTheDocument();
  });

  it("prompts for reauthentication instead of showing approve/reject when reauth is stale", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request()]}
        policy={POLICY}
        currentActorId="reviewer-1"
        reauthedAt={null}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-authenticate/i })).toBeInTheDocument();
  });

  it("shows approve/reject once a non-requester has fresh reauth", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request()]}
        policy={POLICY}
        currentActorId="reviewer-1"
        reauthedAt={NOW.toISOString()}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("never shows approve/reject/cancel for a non-pending request regardless of actor", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request({ state: "approved" })]}
        policy={POLICY}
        currentActorId="requester-1"
        reauthedAt={NOW.toISOString()}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel request/i })).not.toBeInTheDocument();
  });

  it("shows the rejection reason when present", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request({ state: "rejected", rejection: { approverId: "reviewer-1", decidedAt: NOW.toISOString(), reason: "Not enough context" } })]}
        policy={POLICY}
        currentActorId="viewer-1"
        reauthedAt={null}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.getByText(/not enough context/i)).toBeInTheDocument();
  });

  it("shows how many approvals are still needed for a pending request", () => {
    render(
      <RoleChangeRequestReviewList
        requests={[request({ approvals: [{ approverId: "reviewer-1", decidedAt: NOW.toISOString() }] })]}
        policy={POLICY}
        currentActorId="viewer-1"
        reauthedAt={null}
        onApprove={noop}
        onReject={noop}
        onCancel={noop}
        onRequestReauth={noop}
      />,
    );

    expect(screen.getByText(/1 of 2 independent approval/i)).toBeInTheDocument();
  });
});
