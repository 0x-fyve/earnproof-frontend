/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import { KeyActivityDetailView } from "../key-activity-detail";

describe("KeyActivityDetailView", () => {
  it("renders the active state with categories and outcomes", async () => {
    render(<KeyActivityDetailView keyId="key-active" />);
    await waitFor(() => expect(screen.getByTestId("key-activity-detail")).toBeInTheDocument());
    expect(screen.getByTestId("key-activity-state")).toHaveTextContent("Active");
    expect(screen.getByTestId("key-activity-last-used")).toHaveTextContent("Last used");
  });

  it("renders never-used without categories", async () => {
    render(<KeyActivityDetailView keyId="key-never-used" />);
    await waitFor(() => expect(screen.getByTestId("key-activity-detail")).toBeInTheDocument());
    expect(screen.getByTestId("key-activity-state")).toHaveTextContent("Never used");
    expect(screen.getByTestId("key-activity-last-used")).toHaveTextContent("Never used");
  });

  it("renders revoked state", async () => {
    render(<KeyActivityDetailView keyId="key-revoked" />);
    await waitFor(() => expect(screen.getByTestId("key-activity-detail")).toBeInTheDocument());
    expect(screen.getByTestId("key-activity-state")).toHaveTextContent("Revoked");
  });

  it("renders stale state", async () => {
    render(<KeyActivityDetailView keyId="key-stale" />);
    await waitFor(() => expect(screen.getByTestId("key-activity-detail")).toBeInTheDocument());
    expect(screen.getByTestId("key-activity-state")).toHaveTextContent("Stale");
  });

  it("renders a forbidden message without leaking usage data", async () => {
    render(<KeyActivityDetailView keyId="key-forbidden" />);
    await waitFor(() => expect(screen.getByTestId("key-activity-forbidden")).toBeInTheDocument());
    expect(screen.queryByTestId("key-activity-detail")).not.toBeInTheDocument();
  });
});
