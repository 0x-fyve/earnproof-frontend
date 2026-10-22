import { render, screen } from "@testing-library/react";
import { GovernanceProposalList } from "../governance-proposal-list";
import type { GovernanceProposal } from "@/lib/api/governance-proposals";
import type { ActionHash } from "@/lib/api/governance-approvals";

jest.mock("next/link", () => {
  function MockLink({ children, href }: { children: React.ReactNode; href: string }) {
    return <a href={href}>{children}</a>;
  }
  MockLink.displayName = "MockLink";
  return MockLink;
});

function makeProposal(overrides: Partial<GovernanceProposal> = {}): GovernanceProposal {
  return {
    id: "prop-1",
    schemaVersion: "1.0",
    network: "stellar:testnet",
    targetContract: "CAAA...CONTRACT",
    proposedBy: "GPROPOSER000000000000000000000000000000000000000000000",
    proposedAt: "2026-05-30T12:00:00.000Z",
    votingEndsAt: "2026-06-10T12:00:00.000Z",
    requiredApprovals: 2,
    approvals: [],
    action: { version: "1", rawPayload: { parameter: "feeBps", from: 10, to: 20 } },
    actionHash: "hash-abc123" as ActionHash,
    state: "pending",
    projectedAt: "2026-06-01T11:59:00.000Z",
    ...overrides,
  };
}

describe("GovernanceProposalList", () => {
  it("renders an empty state when there are no proposals", () => {
    render(<GovernanceProposalList proposals={[]} />);
    expect(screen.getByText(/No governance proposals/i)).toBeInTheDocument();
  });

  it("renders a list with lifecycle state, network, and target contract per proposal", () => {
    render(
      <GovernanceProposalList
        proposals={[
          makeProposal({ id: "p1", targetContract: "CONTRACT_A", network: "stellar:testnet", state: "pending" }),
          makeProposal({ id: "p2", targetContract: "CONTRACT_B", network: "stellar:mainnet", state: "executed" }),
        ]}
      />,
    );

    expect(screen.getByRole("list", { name: "Governance proposals" })).toBeInTheDocument();
    expect(screen.getByText("CONTRACT_A")).toBeInTheDocument();
    expect(screen.getByText("stellar:testnet")).toBeInTheDocument();
    expect(screen.getByText("CONTRACT_B")).toBeInTheDocument();
    expect(screen.getByText("stellar:mainnet")).toBeInTheDocument();
  });

  it("exposes lifecycle state with an accessible name via role=status", () => {
    render(<GovernanceProposalList proposals={[makeProposal({ state: "insufficient-approval" })]} />);
    expect(
      screen.getByRole("status", { name: "Lifecycle state: Insufficient approval" }),
    ).toBeInTheDocument();
  });

  it("links each proposal row to its detail view", () => {
    render(<GovernanceProposalList proposals={[makeProposal({ id: "prop-42" })]} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings/governance-proposals/prop-42");
  });
});
