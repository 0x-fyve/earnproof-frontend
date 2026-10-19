/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleChangeRequestWorkspace } from "../role-change-request-workspace";
import { submitRoleChangeRequest } from "@/lib/role-change-requests/store";
import { recordReauth } from "@/lib/role-change-requests/reauth-store";
import type { OrganizationMember } from "@/lib/api/organization-members";
import type { RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";

const ORG_ID = "org-1";
const REQUESTER = "requester-1";
const REVIEWER = "reviewer-1";

const MEMBER: OrganizationMember = {
  id: "member-1",
  userId: "user-1",
  organizationId: ORG_ID,
  walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  role: "MEMBER",
  status: "ACTIVE",
};

const POLICY: RoleApprovalPolicy = {
  schemaVersion: 1,
  policyVersion: 1,
  updatedAt: new Date().toISOString(),
  rules: [
    { role: "OWNER", requiresApproval: true },
    { role: "ADMIN", requiresApproval: true },
    { role: "MEMBER", requiresApproval: false },
    { role: "VIEWER", requiresApproval: false },
  ],
  approvalsRequired: 1,
  requestValidityHours: 72,
  allowSelfApproval: false,
};

describe("RoleChangeRequestWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("submits a request and shows it in the review list as pending", async () => {
    const user = userEvent.setup();
    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REQUESTER}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/proposed role/i), "ADMIN");
    await user.type(
      screen.getByLabelText(/justification/i),
      "This member is taking over billing administration duties.",
    );
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => expect(screen.getByTestId("request-state-badge")).toHaveTextContent("Pending"));
  });

  it("blocks a duplicate pending submission for the same member with a visible message", async () => {
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Existing request already in flight.",
      validityHours: 72,
    });

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REQUESTER}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("denies self-approval: the requester viewing their own request sees no approve control", () => {
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin for the Q1 launch window.",
      validityHours: 72,
    });

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REQUESTER}
      />,
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot approve or reject your own request/i)).toBeInTheDocument();
  });

  it("requires a fresh reauth before a reviewer can approve, then allows it after reauthenticating", async () => {
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin for the Q1 launch window.",
      validityHours: 72,
    });

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REVIEWER}
      />,
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-authenticate/i })).toBeInTheDocument();

    // Simulate a reauth having just completed (recordReauth is what the
    // Freighter-backed handler calls on success - tested here without the
    // wallet dependency, consistent with how
    // organization-archival-workflow.test.tsx avoids a real Freighter call).
    recordReauth(REVIEWER);

    // Re-render to pick up the now-fresh stored reauth timestamp.
    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REVIEWER}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("button", { name: /^approve$/i }).length).toBeGreaterThan(0));
  });

  it("approves a request once a reviewer with fresh reauth clicks Approve", async () => {
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin for the Q1 launch window.",
      validityHours: 72,
    });
    recordReauth(REVIEWER);

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REVIEWER}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByTestId("request-state-badge")).toHaveTextContent("Approved"));
  });

  it("rejects a request with a reviewer who has fresh reauth", async () => {
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin for the Q1 launch window.",
      validityHours: 72,
    });
    recordReauth(REVIEWER);

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REVIEWER}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    await waitFor(() => expect(screen.getByTestId("request-state-badge")).toHaveTextContent("Rejected"));
  });

  it("lets the requester cancel their own pending request", async () => {
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin for the Q1 launch window.",
      validityHours: 72,
    });

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={POLICY}
        currentActorId={REQUESTER}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel request/i }));

    await waitFor(() => expect(screen.getByTestId("request-state-badge")).toHaveTextContent("Cancelled"));
  });

  it("shows a visible error when double-approval is attempted (concurrency guard)", async () => {
    const twoApprovalPolicy: RoleApprovalPolicy = { ...POLICY, approvalsRequired: 2 };
    submitRoleChangeRequest(ORG_ID, {
      requesterId: REQUESTER,
      targetMemberId: MEMBER.id,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin for the Q1 launch window.",
      validityHours: 72,
    });
    recordReauth(REVIEWER);

    render(
      <RoleChangeRequestWorkspace
        organizationId={ORG_ID}
        member={MEMBER}
        policy={twoApprovalPolicy}
        currentActorId={REVIEWER}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() =>
      expect(screen.getByText(/1 of 2 independent approval/i)).toBeInTheDocument(),
    );

    // The same reviewer tries to approve again (e.g. a double submit) - the
    // control should still be present (request is still pending) but the
    // store refuses the duplicate approval and the workspace surfaces it.
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").some((el) => /already approved/i.test(el.textContent ?? ""))).toBe(true),
    );
  });
});
