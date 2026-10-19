/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProofDisputeSubmissionForm } from "../proof-dispute-submission-form";

describe("ProofDisputeSubmissionForm", () => {
  it("does not call onSubmit when clicked with no evidence entered yet, and surfaces the validation message", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProofDisputeSubmissionForm onSubmit={onSubmit} submitting={false} />);

    expect(screen.getByRole("button", { name: /submit dispute/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /submit dispute/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/reference id or hash/i);
  });

  it("shows a validation message and does not call onSubmit for an unsafe evidence value", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProofDisputeSubmissionForm onSubmit={onSubmit} submitting={false} />);

    await user.type(screen.getByLabelText(/evidence commitment/i), "https://evil.example");
    await user.click(screen.getByRole("button", { name: /submit dispute/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/reference id or hash/i);
  });

  it("calls onSubmit with the selected category, trimmed evidence, and note", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProofDisputeSubmissionForm onSubmit={onSubmit} submitting={false} />);

    await user.click(screen.getByText("Stale data"));
    await user.type(screen.getByLabelText(/evidence commitment/i), "  valid-hash-123  ");
    await user.type(screen.getByLabelText(/note/i), "Some context");
    await user.click(screen.getByRole("button", { name: /submit dispute/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      category: "stale_data",
      evidenceCommitment: "valid-hash-123",
      note: "Some context",
    });
  });

  it("omits the note field entirely when left blank", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProofDisputeSubmissionForm onSubmit={onSubmit} submitting={false} />);

    await user.type(screen.getByLabelText(/evidence commitment/i), "valid-hash-123");
    await user.click(screen.getByRole("button", { name: /submit dispute/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ note: undefined }),
    );
  });

  it("shows a submitting state and disables the button while in flight", () => {
    render(<ProofDisputeSubmissionForm onSubmit={jest.fn()} submitting={true} />);
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();
  });

  it("enforces the note character limit via maxLength", () => {
    render(<ProofDisputeSubmissionForm onSubmit={jest.fn()} submitting={false} />);
    expect(screen.getByLabelText(/note/i)).toHaveAttribute("maxLength", "1000");
  });
});
