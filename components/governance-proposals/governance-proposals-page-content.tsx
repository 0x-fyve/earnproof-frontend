"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthSession } from "@/lib/auth/auth-context";
import {
  getGovernanceProposals,
  getGovernanceProposal,
  type GovernanceProposal,
} from "@/lib/api/governance-proposals";
import type { GovernanceNetwork } from "@/lib/api/governance-approvals";
import { GovernanceProposalList } from "./governance-proposal-list";
import { GovernanceProposalDetail } from "./governance-proposal-detail";

/**
 * Page content for the governance proposal review UI (#246). Mirrors the
 * loading/error/unauthenticated-state conventions in
 * contract-upgrade-review-page-content.tsx, but wired to the real
 * `useAuthSession` hook (that file's `useSessionToken` import does not
 * resolve to anything in this codebase today — pre-existing, left as is).
 */
export function GovernanceProposalsPageContent() {
  const searchParams = useSearchParams();
  const proposalId = searchParams.get("id");

  const { user, isAuthenticated, walletState, getToken } = useAuthSession();
  const token = getToken();
  const walletAddress = user?.walletAddress ?? walletState.address ?? "";
  const currentNetwork = (walletState.network || "stellar:testnet") as GovernanceNetwork;

  const [proposals, setProposals] = useState<GovernanceProposal[]>([]);
  const [detail, setDetail] = useState<GovernanceProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const data = await getGovernanceProposals(token, controller.signal);
      setProposals(data);
    } catch {
      setError("Failed to load governance proposals");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadDetail = useCallback(async () => {
    if (!token || !proposalId) return;
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const data = await getGovernanceProposal(token, proposalId, controller.signal);
      setDetail(data);
    } catch {
      setError("Failed to load this proposal");
    } finally {
      setLoading(false);
    }
  }, [token, proposalId]);

  useEffect(() => {
    if (proposalId) {
      loadDetail();
    } else {
      loadList();
    }
  }, [proposalId, loadDetail, loadList]);

  if (!isAuthenticated || !token || !walletAddress) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-6">
        <h3 className="font-semibold text-amber-300 mb-2">Please sign in</h3>
        <p className="text-sm text-amber-200">
          Connect your Freighter wallet and sign in to review governance proposals.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 bg-slate-800 rounded w-1/3" />
        <div className="h-4 bg-slate-800 rounded w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-900/10 p-6">
        <h3 className="font-semibold text-red-300 mb-2">Something went wrong</h3>
        <p className="text-sm text-red-200">{error}</p>
      </div>
    );
  }

  if (proposalId) {
    if (!detail) {
      return (
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-center">
          <p className="text-sm text-slate-300">Proposal not found</p>
        </div>
      );
    }
    return (
      <GovernanceProposalDetail
        proposal={detail}
        token={token}
        walletAddress={walletAddress}
        currentNetwork={currentNetwork}
        approvalRole="VOTER"
        onApproved={setDetail}
      />
    );
  }

  return <GovernanceProposalList proposals={proposals} />;
}
