import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  defaultRoleApprovalPolicy,
  type RoleApprovalPolicy,
} from "@/lib/api/organization-role-approval-policy";
import { RoleApprovalPolicyPanel } from "../role-approval-policy-panel";

function policy(overrides: Partial<RoleApprovalPolicy> = {}): RoleApprovalPolicy {
  return { ...defaultRoleApprovalPolicy(), ...overrides };
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof RoleApprovalPolicyPanel>> = {},
) {
  return render(
    <RoleApprovalPolicyPanel
      initialPolicy={policy()}
      organizationId="org-1"
      viewerRole="OWNER"
      {...overrides}
    />,
  );
}

describe("RoleApprovalPolicyPanel", () => {
  it("renders a read-only summary for viewers without a management role", () => {
    renderPanel({ viewerRole: "VIEWER" });
    expect(screen.getByText(/read-only access to this policy/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save policy/i })).toBeNull();
    expect(screen.getByLabelText("OWNER")).toBeDisabled();
  });

  it("shows the management controls for an owner", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeEnabled();
    expect(screen.getByTestId("policy-version")).toHaveTextContent("Version 1");
  });

  it("blocks removing approval from a role that must always require it", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("OWNER"));
    expect(screen.getByText(/OWNER role changes must always require approval/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
  });

  it("blocks an approvals count below the server minimum", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/independent approvals required/i), {
      target: { value: "0" },
    });
    expect(screen.getByText(/at least 1 independent approval/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
  });

  it("blocks a request validity outside the allowed bounds", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/request validity/i), {
      target: { value: "9999" },
    });
    expect(screen.getByText(/at most 720 hours/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
  });

  it("blocks enabling self-approval when the server forbids it", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText(/allow requesters to approve their own requests/i));
    expect(screen.getByText(/self-approval is not permitted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
  });

  it("previews a relaxation in the impact panel", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("ADMIN"));
    expect(screen.getByText(/relaxes the current policy/i)).toBeInTheDocument();
    expect(screen.getByText(/no longer be required for: ADMIN/i)).toBeInTheDocument();
  });

  it("saves a valid change, increments the version and reports success", () => {
    const onSaved = jest.fn();
    renderPanel({ onSaved });

    fireEvent.click(screen.getByLabelText("ADMIN"));
    fireEvent.click(screen.getByRole("button", { name: /save policy/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/saved policy version 2/i);
    expect(screen.getByTestId("policy-version")).toHaveTextContent("Version 2");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("discards draft changes back to the saved policy", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("ADMIN"));
    expect(screen.getByText(/relaxes the current policy/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discard changes/i }));
    expect(screen.getByText(/at least as strict as the current policy/i)).toBeInTheDocument();
  });

  it("compares an earlier version and rolls back to it", () => {
    const earlier = policy({ policyVersion: 1, approvalsRequired: 4 });
    renderPanel({
      initialPolicy: policy({ policyVersion: 3, approvalsRequired: 2 }),
      initialHistory: [earlier],
    });

    fireEvent.change(screen.getByLabelText(/compare with current version/i), {
      target: { value: "1" },
    });
    expect(screen.getByText(/approvalsRequired/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /roll back to version 1/i }));
    expect(screen.getByLabelText(/independent approvals required/i)).toHaveValue(4);
  });
});
