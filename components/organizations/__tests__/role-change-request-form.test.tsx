/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleChangeRequestForm } from "../role-change-request-form";
import type { OrganizationMember } from "@/lib/api/organization-members";

const MEMBER: OrganizationMember = {
  id: "member-1",
  userId: "user-1",
  organizationId: "org-1",
  walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  role: "MEMBER",
  status: "ACTIVE",
};

describe("RoleChangeRequestForm", () => {
  it("does not call onSubmit when the proposed role is unchanged", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<RoleChangeRequestForm member={MEMBER} onSubmit={onSubmit} submitting={false} />);

    await user.type(
      screen.getByLabelText(/justification/i),
      "This member needs elevated access for the new project.",
    );
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/different from the member/i);
  });

  it("does not call onSubmit with a too-short justification", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<RoleChangeRequestForm member={MEMBER} onSubmit={onSubmit} submitting={false} />);

    await user.selectOptions(screen.getByLabelText(/proposed role/i), "ADMIN");
    await user.type(screen.getByLabelText(/justification/i), "short");
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least/i);
  });

  it("calls onSubmit with the proposed role and trimmed justification", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<RoleChangeRequestForm member={MEMBER} onSubmit={onSubmit} submitting={false} />);

    await user.selectOptions(screen.getByLabelText(/proposed role/i), "ADMIN");
    await user.type(
      screen.getByLabelText(/justification/i),
      "  This member needs elevated access for the new project.  ",
    );
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      proposedRole: "ADMIN",
      justification: "This member needs elevated access for the new project.",
    });
  });

  it("disables the form and shows the blocked reason when a pending request already exists", () => {
    render(
      <RoleChangeRequestForm
        member={MEMBER}
        onSubmit={jest.fn()}
        submitting={false}
        blockedReason="A pending role change request already exists for this member."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.getByLabelText(/proposed role/i)).toBeDisabled();
    expect(screen.getByLabelText(/justification/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("shows a submitting state", () => {
    render(<RoleChangeRequestForm member={MEMBER} onSubmit={jest.fn()} submitting={true} />);
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();
  });
});
