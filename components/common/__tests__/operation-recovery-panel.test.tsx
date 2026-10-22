import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperationRecoveryPanel } from "../operation-recovery-panel";

describe("OperationRecoveryPanel", () => {
  it("offers 'check status' (resume) for a pending operation, not retry", () => {
    render(
      <OperationRecoveryPanel
        idempotencyKey="key-1"
        outcome="pending"
        onResume={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByTestId("operation-recovery-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("operation-recovery-retry")).not.toBeInTheDocument();
  });

  it("offers retry for a failed operation", async () => {
    const onRetry = jest.fn();
    render(
      <OperationRecoveryPanel
        idempotencyKey="key-1"
        outcome="failed"
        onResume={jest.fn()}
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByTestId("operation-recovery-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers retry for a cancelled operation", () => {
    render(
      <OperationRecoveryPanel
        idempotencyKey="key-1"
        outcome="cancelled"
        onResume={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByTestId("operation-recovery-retry")).toBeInTheDocument();
  });

  // Acceptance criterion: an unknown/expired record must never offer an
  // action that presumes a definite success or failure.
  it("never offers resume or retry for an unknown outcome, and surfaces a support reference instead", () => {
    render(
      <OperationRecoveryPanel
        idempotencyKey="key-unknown"
        outcome="unknown"
        onResume={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("operation-recovery-resume")).not.toBeInTheDocument();
    expect(screen.queryByTestId("operation-recovery-retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("operation-recovery-reference")).toHaveTextContent("key-unknown");
  });

  it("never offers retry for a succeeded operation, to avoid duplicating completed work", () => {
    render(
      <OperationRecoveryPanel
        idempotencyKey="key-1"
        outcome="succeeded"
        onResume={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("operation-recovery-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("operation-recovery-resume")).not.toBeInTheDocument();
  });

  it("disables the resume button while polling", () => {
    render(
      <OperationRecoveryPanel
        idempotencyKey="key-1"
        outcome="pending"
        isPolling
        onResume={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByTestId("operation-recovery-resume")).toBeDisabled();
  });
});
