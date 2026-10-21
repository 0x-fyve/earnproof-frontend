import { render, screen } from "@testing-library/react";
import { GovernanceProposalDetail } from "../governance-proposal-detail";
import type { GovernanceProposal } from "@/lib/api/governance-proposals";
import type { ActionHash } from "@/lib/api/governance-approvals";

jest.mock("@/lib/auth/recent-auth", () => ({
  useRecentAuth: () => ({
    isPromptOpen: false,
    status: "idle",
    error: null,
    challenge: null,
    requestRecentAuth: jest.fn(),
    confirmRecentAuth: jest.fn(),
    cancelRecentAuth: jest.fn(),
  }),
}));

jest.mock("@/components/common/recent-auth-gate", () => ({
  RecentAuthGate: () => null,
}));

jest.mock("@/lib/wallet/sign-message", () => ({
  signWithFreighter: jest.fn(),
}));

const PROPOSER = "GPROPOSER000000000000000000000000000000000000000000000";
const APPROVER = "GAPPROVER00000000000000000000000000000000000000000000";

function makeProposal(overrides: Partial<GovernanceProposal> = {}): GovernanceProposal {
  return {
    id: "prop-1",
    schemaVersion: "1.0",
    network: "stellar:testnet",
    targetContract: "CAAA...CONTRACT",
    proposedBy: PROPOSER,
    proposedAt: "2026-05-30T12:00:00.000Z",
    votingEndsAt: "2099-06-10T12:00:00.000Z",
    requiredApprovals: 2,
    approvals: [],
    action: { version: "1", rawPayload: { parameter: "feeBps", from: 10, to: 20 } },
    actionHash: "hash-abc123" as ActionHash,
    state: "pending",
    projectedAt: new Date().toISOString(),
    ...overrides,
  };
}

const baseProps = {
  token: "tok",
  walletAddress: APPROVER,
  currentNetwork: "stellar:testnet" as const,
  approvalRole: "VOTER" as const,
};

describe("GovernanceProposalDetail", () => {
  it("always shows the canonical action hash, even when the action decodes successfully", () => {
    render(<GovernanceProposalDetail proposal={makeProposal()} {...baseProps} />);
    expect(screen.getByTestId("action-hash")).toHaveTextContent("hash-abc123");
  });

  it("falls back to an inspect-only notice (and still shows the hash) for an unsupported action version", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({ action: { version: "99", rawPayload: {} } })}
        {...baseProps}
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => /does not recognize/i.test(el.textContent ?? ""))).toBe(true);
    expect(screen.getByTestId("action-hash")).toHaveTextContent("hash-abc123");
  });

  it("blocks approval and labels the proposal untrustworthy when the action hash was tampered with", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({
          approvals: [
            {
              walletAddress: "GOTHER0000000000000000000000000000000000000000000000",
              role: "VOTER",
              approvedAt: "2026-05-31T00:00:00.000Z",
              actionHash: "tampered-hash" as ActionHash,
            },
          ],
        })}
        {...baseProps}
      />,
    );
    const approveButton = screen.getByRole("button", { name: "Approve proposal" });
    expect(approveButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be trusted/i);
  });

  it("blocks approval and labels the proposal stale when the projection is stale", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({ projectedAt: "2020-01-01T00:00:00.000Z" })}
        {...baseProps}
      />,
    );
    const approveButton = screen.getByRole("button", { name: "Approve proposal" });
    expect(approveButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/out of date/i);
  });

  it("blocks approval when the current wallet is the proposer (self-approval policy)", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({ proposedBy: APPROVER })}
        {...baseProps}
      />,
    );
    const approveButton = screen.getByRole("button", { name: "Approve proposal" });
    expect(approveButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot approve a proposal you proposed/i);
  });

  it("blocks approval and shows a message when the connected network does not match the proposal's network", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({ network: "stellar:mainnet" })}
        {...baseProps}
        currentNetwork="stellar:testnet"
      />,
    );
    const approveButton = screen.getByRole("button", { name: "Approve proposal" });
    expect(approveButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/different network/i);
  });

  it("enables approval only when every check passes", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({ approvals: [] })}
        {...baseProps}
      />,
    );
    const approveButton = screen.getByRole("button", { name: "Approve proposal" });
    expect(approveButton).not.toBeDisabled();
  });

  it("exposes the lifecycle state via an accessible role=status element", () => {
    render(<GovernanceProposalDetail proposal={makeProposal({ state: "approved" })} {...baseProps} />);
    expect(screen.getByRole("status", { name: "Lifecycle state: Approved" })).toBeInTheDocument();
  });

  it("gives the approve button a stable accessible name regardless of enabled/disabled state", () => {
    render(
      <GovernanceProposalDetail
        proposal={makeProposal({ proposedBy: APPROVER })}
        {...baseProps}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve proposal" })).toHaveAccessibleName(
      "Approve proposal",
    );
  });
});
