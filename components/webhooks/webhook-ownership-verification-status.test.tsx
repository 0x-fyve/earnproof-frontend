/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import { WebhookOwnershipVerificationStatus } from "./webhook-ownership-verification-status";

describe("WebhookOwnershipVerificationStatus", () => {
  it("shows verified and production delivery active", async () => {
    render(<WebhookOwnershipVerificationStatus url="https://example.com/hook" webhookId="hook-verified" />);
    await waitFor(() => expect(screen.getByTestId("webhook-verification-status")).toBeInTheDocument());
    expect(screen.getByTestId("webhook-verification-state")).toHaveTextContent("Verified");
    expect(screen.getByTestId("webhook-production-delivery")).toHaveTextContent("Active");
  });

  it("shows expired with production delivery inactive and a retry action", async () => {
    render(<WebhookOwnershipVerificationStatus url="https://example.com/hook" webhookId="hook-expired" />);
    await waitFor(() => expect(screen.getByTestId("webhook-verification-status")).toBeInTheDocument());
    expect(screen.getByTestId("webhook-verification-state")).toHaveTextContent("Expired");
    expect(screen.getByTestId("webhook-production-delivery")).toHaveTextContent("Inactive");
    expect(screen.getByRole("button", { name: /retry verification/i })).toBeInTheDocument();
  });

  it("shows pending with no verify/retry action available yet", async () => {
    render(<WebhookOwnershipVerificationStatus url="https://example.com/hook" webhookId="hook-pending" />);
    await waitFor(() => expect(screen.getByTestId("webhook-verification-status")).toBeInTheDocument());
    expect(screen.getByTestId("webhook-verification-state")).toHaveTextContent("Pending");
    expect(screen.queryByRole("button", { name: /verify ownership/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry verification/i })).not.toBeInTheDocument();
  });

  it("shows a forbidden message for an unauthorized webhook", async () => {
    render(<WebhookOwnershipVerificationStatus url="https://example.com/hook" webhookId="hook-forbidden" />);
    await waitFor(() => expect(screen.getByTestId("webhook-verification-forbidden")).toBeInTheDocument());
    expect(screen.queryByTestId("webhook-verification-status")).not.toBeInTheDocument();
  });

  it("re-fetches (and shows unverified) when the url prop changes", async () => {
    const { rerender } = render(
      <WebhookOwnershipVerificationStatus url="https://example.com/hook" webhookId="hook-verified" />,
    );
    await waitFor(() => expect(screen.getByTestId("webhook-verification-state")).toHaveTextContent("Verified"));

    rerender(<WebhookOwnershipVerificationStatus url="https://example.com/hook" webhookId="hook-default" />);
    await waitFor(() => expect(screen.getByTestId("webhook-verification-state")).toHaveTextContent("Unverified"));
  });
});
