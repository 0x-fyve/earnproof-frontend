import {
  decodeProposalAction,
  evaluateProposalApprovability,
  getProposalApprovalDisabledReason,
  hasConsistentActionHash,
  isGovernanceProposal,
  isProjectionStale,
  isProposalForNetwork,
  isProposalTerminal,
  isProposalVotingWindowElapsed,
  isSupportedProposalActionVersion,
  proposalLifecycleLabel,
  DEFAULT_PROJECTION_STALE_MS,
  type GovernanceProposal,
  type ActionHash,
} from "@/lib/api/governance-proposals";

const NOW = new Date("2026-06-01T12:00:00.000Z");

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
    action: {
      version: "1",
      rawPayload: { parameter: "feeBps", from: 10, to: 20 },
    },
    actionHash: "hash-abc123" as ActionHash,
    state: "pending",
    projectedAt: "2026-06-01T11:59:00.000Z",
    ...overrides,
  };
}

describe("governance-proposals: action decoding (fail-closed on unknown version)", () => {
  it("decodes a known v1 parameter-update action into a human-readable diff", () => {
    const decoded = decodeProposalAction({
      version: "1",
      rawPayload: { parameter: "feeBps", from: 10, to: 20 },
    });
    expect(decoded).not.toBeNull();
    expect(decoded?.summary).toContain("feeBps");
    expect(decoded?.fields[0]).toEqual({ label: "feeBps", before: "10", after: "20" });
  });

  it("decodes a known v2 role-grant action into a human-readable diff", () => {
    const decoded = decodeProposalAction({
      version: "2",
      rawPayload: { role: "TREASURER", grantee: "GNEW", previousGrantee: "GOLD" },
    });
    expect(decoded).not.toBeNull();
    expect(decoded?.summary).toContain("TREASURER");
    expect(decoded?.fields[0]).toEqual({ label: "Grantee", before: "GOLD", after: "GNEW" });
  });

  it("fails closed (returns null) for an unsupported/unknown action version", () => {
    const decoded = decodeProposalAction({
      version: "99",
      rawPayload: { somethingNew: true },
    });
    expect(decoded).toBeNull();
  });

  it("fails closed for a non-numeric/garbage version string", () => {
    const decoded = decodeProposalAction({
      version: "v2-beta",
      rawPayload: {},
    });
    expect(decoded).toBeNull();
  });

  it("isSupportedProposalActionVersion rejects anything outside the known set", () => {
    expect(isSupportedProposalActionVersion("1")).toBe(true);
    expect(isSupportedProposalActionVersion("2")).toBe(true);
    expect(isSupportedProposalActionVersion("3")).toBe(false);
    expect(isSupportedProposalActionVersion("")).toBe(false);
  });
});

describe("governance-proposals: isGovernanceProposal structural guard", () => {
  it("accepts a well-formed proposal", () => {
    expect(isGovernanceProposal(makeProposal())).toBe(true);
  });

  it("rejects null/non-object values", () => {
    expect(isGovernanceProposal(null)).toBe(false);
    expect(isGovernanceProposal("a string")).toBe(false);
    expect(isGovernanceProposal(42)).toBe(false);
  });

  it("rejects an object missing required fields", () => {
    const { approvals, ...rest } = makeProposal();
    expect(isGovernanceProposal(rest)).toBe(false);
  });

  it("rejects an unknown lifecycle state", () => {
    expect(isGovernanceProposal({ ...makeProposal(), state: "some-future-state" })).toBe(false);
  });
});

describe("governance-proposals: payload tampering (action hash consistency)", () => {
  it("is consistent when every approval's actionHash matches the proposal's", () => {
    const proposal = makeProposal({
      approvals: [
        {
          walletAddress: "GAPPROVER1",
          role: "VOTER",
          approvedAt: "2026-05-31T00:00:00.000Z",
          actionHash: "hash-abc123" as ActionHash,
        },
      ],
    });
    expect(hasConsistentActionHash(proposal)).toBe(true);
  });

  it("detects tampering when an approval's actionHash does not match (payload altered post-approval)", () => {
    const proposal = makeProposal({
      approvals: [
        {
          walletAddress: "GAPPROVER1",
          role: "VOTER",
          approvedAt: "2026-05-31T00:00:00.000Z",
          actionHash: "hash-TAMPERED" as ActionHash,
        },
      ],
    });
    expect(hasConsistentActionHash(proposal)).toBe(false);
  });

  it("an empty approvals list is trivially consistent", () => {
    expect(hasConsistentActionHash(makeProposal({ approvals: [] }))).toBe(true);
  });
});

describe("governance-proposals: network mismatch", () => {
  it("matches when proposal network equals current network", () => {
    const proposal = makeProposal({ network: "stellar:testnet" });
    expect(isProposalForNetwork(proposal, "stellar:testnet")).toBe(true);
  });

  it("detects a mismatch between proposal network and current network", () => {
    const proposal = makeProposal({ network: "stellar:mainnet" });
    expect(isProposalForNetwork(proposal, "stellar:testnet")).toBe(false);
  });
});

describe("governance-proposals: stale proposals / projections", () => {
  it("is not stale when projectedAt is recent", () => {
    const proposal = makeProposal({ projectedAt: "2026-06-01T11:59:30.000Z" });
    expect(isProjectionStale(proposal, DEFAULT_PROJECTION_STALE_MS, NOW)).toBe(false);
  });

  it("is stale when projectedAt is older than the max age", () => {
    const proposal = makeProposal({ projectedAt: "2026-06-01T11:00:00.000Z" });
    expect(isProjectionStale(proposal, DEFAULT_PROJECTION_STALE_MS, NOW)).toBe(true);
  });

  it("treats an unparsable projectedAt as stale (fail closed)", () => {
    const proposal = makeProposal({ projectedAt: "not-a-date" });
    expect(isProjectionStale(proposal, DEFAULT_PROJECTION_STALE_MS, NOW)).toBe(true);
  });

  it("treats the exact boundary age as NOT stale (age must exceed, not just reach, the max)", () => {
    const projectedAt = new Date(NOW.getTime() - DEFAULT_PROJECTION_STALE_MS).toISOString();
    const proposal = makeProposal({ projectedAt });
    expect(isProjectionStale(proposal, DEFAULT_PROJECTION_STALE_MS, NOW)).toBe(false);
  });
});

describe("governance-proposals: voting window / terminal states", () => {
  it("is not elapsed before votingEndsAt", () => {
    const proposal = makeProposal({ votingEndsAt: "2026-06-10T12:00:00.000Z" });
    expect(isProposalVotingWindowElapsed(proposal, NOW)).toBe(false);
  });

  it("is elapsed after votingEndsAt", () => {
    const proposal = makeProposal({ votingEndsAt: "2026-05-01T12:00:00.000Z" });
    expect(isProposalVotingWindowElapsed(proposal, NOW)).toBe(true);
  });

  it.each(["executed", "cancelled", "expired", "insufficient-approval"] as const)(
    "treats %s as a terminal state",
    (state) => {
      expect(isProposalTerminal(state)).toBe(true);
    },
  );

  it.each(["pending", "approved"] as const)("treats %s as non-terminal", (state) => {
    expect(isProposalTerminal(state)).toBe(false);
  });
});

describe("governance-proposals: evaluateProposalApprovability (the full policy gate)", () => {
  const baseParams = {
    currentNetwork: "stellar:testnet" as const,
    currentWalletAddress: "GVOTER0000000000000000000000000000000000000000000000",
    now: NOW,
  };

  it("allows approval when every condition is satisfied", () => {
    const proposal = makeProposal();
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(getProposalApprovalDisabledReason(result)).toBeNull();
  });

  it("self-approval policy: blocks the proposer from approving their own proposal", () => {
    const proposal = makeProposal({ proposedBy: baseParams.currentWalletAddress });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("self-approval");
  });

  it("self-approval policy is case-insensitive on wallet address", () => {
    const proposal = makeProposal({ proposedBy: baseParams.currentWalletAddress.toLowerCase() });
    const result = evaluateProposalApprovability(proposal, {
      ...baseParams,
      currentWalletAddress: baseParams.currentWalletAddress.toUpperCase(),
    });
    expect(result.reasons).toContain("self-approval");
  });

  it("network mismatch: blocks approval when proposal network differs from current", () => {
    const proposal = makeProposal({ network: "stellar:mainnet" });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("network-mismatch");
  });

  it("stale proposal: blocks approval when the projection is stale", () => {
    const proposal = makeProposal({ projectedAt: "2026-06-01T10:00:00.000Z" });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("stale-projection");
  });

  it("unsupported action version fails closed: never approvable, even if otherwise fully valid", () => {
    const proposal = makeProposal({ action: { version: "99", rawPayload: {} } });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("unsupported-action-version");
  });

  it("tampered action hash blocks approval", () => {
    const proposal = makeProposal({
      approvals: [
        {
          walletAddress: "GOTHER",
          role: "VOTER",
          approvedAt: "2026-05-31T00:00:00.000Z",
          actionHash: "hash-TAMPERED" as ActionHash,
        },
      ],
    });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("tampered-action-hash");
  });

  it("voting window elapsed blocks approval", () => {
    const proposal = makeProposal({ votingEndsAt: "2026-01-01T00:00:00.000Z" });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("voting-window-elapsed");
  });

  it.each(["executed", "cancelled", "expired", "insufficient-approval"] as const)(
    "terminal state %s blocks approval",
    (state) => {
      const proposal = makeProposal({ state });
      const result = evaluateProposalApprovability(proposal, baseParams);
      expect(result.canApprove).toBe(false);
      expect(result.reasons).toContain("proposal-terminal");
    },
  );

  it("blocks a user from approving the same proposal twice", () => {
    const proposal = makeProposal({
      approvals: [
        {
          walletAddress: baseParams.currentWalletAddress,
          role: "VOTER",
          approvedAt: "2026-05-31T00:00:00.000Z",
          actionHash: "hash-abc123" as ActionHash,
        },
      ],
    });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("already-approved");
  });

  it("insufficient-approval: blocks when there are no remaining approval slots", () => {
    const proposal = makeProposal({
      requiredApprovals: 1,
      approvals: [
        {
          walletAddress: "GSOMEONEELSE",
          role: "VOTER",
          approvedAt: "2026-05-31T00:00:00.000Z",
          actionHash: "hash-abc123" as ActionHash,
        },
      ],
    });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.canApprove).toBe(false);
    expect(result.reasons).toContain("insufficient-remaining-slots");
  });

  it("can accumulate multiple simultaneous denial reasons", () => {
    const proposal = makeProposal({
      network: "stellar:mainnet",
      proposedBy: baseParams.currentWalletAddress,
      state: "cancelled",
    });
    const result = evaluateProposalApprovability(proposal, baseParams);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["network-mismatch", "self-approval", "proposal-terminal"]),
    );
  });

  it("getProposalApprovalDisabledReason returns a human string for the first reason", () => {
    const proposal = makeProposal({ proposedBy: baseParams.currentWalletAddress });
    const result = evaluateProposalApprovability(proposal, baseParams);
    const reason = getProposalApprovalDisabledReason(result);
    expect(reason).toBe("You cannot approve a proposal you proposed.");
  });
});

describe("governance-proposals: lifecycle label distinctness", () => {
  it("distinguishes expired, cancelled, executed, and insufficient-approval as separate labels", () => {
    const labels = new Set([
      proposalLifecycleLabel("expired"),
      proposalLifecycleLabel("cancelled"),
      proposalLifecycleLabel("executed"),
      proposalLifecycleLabel("insufficient-approval"),
      proposalLifecycleLabel("pending"),
      proposalLifecycleLabel("approved"),
    ]);
    expect(labels.size).toBe(6);
  });
});
