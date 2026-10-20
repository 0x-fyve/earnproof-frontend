"use client";

import Link from "next/link";
import type { GovernanceProposal } from "@/lib/api/governance-proposals";
import { proposalLifecycleLabel } from "@/lib/api/governance-proposals";

export interface GovernanceProposalListProps {
  proposals: GovernanceProposal[];
}

/**
 * Lists bounded governance proposals: lifecycle state, network, and target
 * contract for each. Links through to the inspect/detail view for the
 * decoded diff + approval controls (see governance-proposal-detail.tsx).
 */
export function GovernanceProposalList({ proposals }: GovernanceProposalListProps) {
  if (proposals.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-center">
        <p className="text-sm text-slate-300">No governance proposals available yet</p>
      </div>
    );
  }

  return (
    <ul
      role="list"
      aria-label="Governance proposals"
      className="divide-y divide-white/10 rounded-lg border border-white/10 bg-slate-900/50"
    >
      {proposals.map((proposal) => (
        <li key={proposal.id} className="p-4">
          <Link
            href={`/settings/governance-proposals/${proposal.id}`}
            className="flex flex-col gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium text-white">{proposal.targetContract}</p>
              <p className="text-xs text-slate-400">{proposal.network}</p>
            </div>
            <span
              role="status"
              aria-label={`Lifecycle state: ${proposalLifecycleLabel(proposal.state)}`}
              className="inline-flex w-fit items-center rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200"
            >
              {proposalLifecycleLabel(proposal.state)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
