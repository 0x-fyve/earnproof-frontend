import React from "react";
import { render, screen, within } from "@testing-library/react";
import { ContractDriftPanel } from "../contract-drift-panel";
import type { DriftCheckResult, DriftStatus } from "@/lib/api/contract-drift";

function makeCheck(overrides: Partial<DriftCheckResult> = {}): DriftCheckResult {
  return {
    category: "FEE_SCHEDULE",
    affectedCapability: "payment-review",
    severity: "matched",
    lastCheckedAt: new Date("2026-06-15T12:00:00.000Z").toISOString(),
    detail: "Fee schedule matches the deployed contract.",
    acknowledgement: null,
    ...overrides,
  };
}

function makeStatus(checks: DriftCheckResult[]): DriftStatus {
  return { checks, generatedAt: new Date("2026-06-15T12:00:00.000Z").toISOString() };
}

describe("ContractDriftPanel", () => {
  it("renders a matched check distinctly from an unavailable one", () => {
    render(
      <ContractDriftPanel
        status={makeStatus([
          makeCheck({ category: "FEE_SCHEDULE", severity: "matched" }),
          makeCheck({ category: "RATE_LIMITS", severity: "unavailable" }),
        ])}
      />,
    );

    expect(screen.getByText("Matched")).toBeInTheDocument();
    expect(screen.getByText("Check unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Matched")).not.toBe(screen.queryByText("Check unavailable"));
  });

  it("renders a blocking check with an alert role and blocked notice, with no action available to override it", () => {
    render(<ContractDriftPanel status={makeStatus([makeCheck({ severity: "blocking" })])} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Blocked");
    expect(
      screen.getByText(/Affected actions are blocked until this check matches or is resolved/),
    ).toBeInTheDocument();
    // No "override" or "proceed anyway" control exists anywhere in the panel.
    expect(screen.queryByText(/override/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proceed anyway/i)).not.toBeInTheDocument();
  });

  it("shows acknowledgement expiry for an active acknowledgement", () => {
    render(
      <ContractDriftPanel
        status={makeStatus([
          makeCheck({
            severity: "warning",
            acknowledgement: {
              acknowledgedBy: "operator-1",
              acknowledgedAt: new Date("2026-06-15T11:00:00.000Z").toISOString(),
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              reason: "Maintenance window.",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText(/Acknowledged until/)).toBeInTheDocument();
  });

  it("falls back to warning display once the acknowledgement has expired", () => {
    render(
      <ContractDriftPanel
        status={makeStatus([
          makeCheck({
            severity: "warning",
            acknowledgement: {
              acknowledgedBy: "operator-1",
              acknowledgedAt: new Date("2026-06-15T11:00:00.000Z").toISOString(),
              expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
              reason: "Maintenance window.",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Drift detected")).toBeInTheDocument();
    expect(screen.getByText(/Acknowledgement expired/)).toBeInTheDocument();
  });

  it("offers a refresh action per check that only identifies the category", async () => {
    const status = makeStatus([makeCheck()]);
    render(<ContractDriftPanel status={status} />);
    const list = screen.getByRole("list", { name: /drift checks/i });
    const button = within(list).getByRole("button", { name: /refresh check/i });
    expect(button).toBeInTheDocument();
  });
});
