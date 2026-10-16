"use client";

import { useSearchParams } from "next/navigation";
import { useSessionToken } from "@/lib/auth/use-session-token";
import { RecentAuthGate } from "@/components/common/recent-auth-gate";
import { useRecentAuth } from "@/lib/auth/recent-auth";
import { signWithFreighter } from "@/lib/wallet/sign-message";
import { ContractUpgradeReviewPanel } from "./contract-upgrade-review-panel";

/**
 * Page content component with authentication gating
 */
export function ContractUpgradeReviewPageContent() {
  const searchParams = useSearchParams();
  const upgradePlanId = searchParams.get("id");

  const { token, loading: tokenLoading, error: tokenError, walletAddress } = useSessionToken();

  const recentAuth = useRecentAuth({
    walletAddress: walletAddress || "",
    signMessage: (message) => signWithFreighter(message, walletAddress || ""),
  });

  // Loading state
  if (tokenLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-slate-800 rounded w-1/3" />
          <div className="h-4 bg-slate-800 rounded w-2/3" />
        </div>
      </div>
    );
  }

  // Auth error state
  if (tokenError) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-900/10 p-6">
        <h3 className="font-semibold text-red-300 mb-2">Authentication Required</h3>
        <p className="text-sm text-red-200">{tokenError}</p>
      </div>
    );
  }

  // Token not available
  if (!token || !walletAddress) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-6">
        <h3 className="font-semibold text-amber-300 mb-2">Please Sign In</h3>
        <p className="text-sm text-amber-200">
          Connect your Freighter wallet and sign in to review contract upgrades.
        </p>
      </div>
    );
  }

  // Recent auth gate
  return (
    <RecentAuthGate
      recentAuth={recentAuth}
      requiredSignatureAgeSec={300}
      fallback={
        <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-6">
          <h3 className="font-semibold text-amber-300 mb-2">Recent Authentication Required</h3>
          <p className="text-sm text-amber-200">
            Please sign a fresh challenge to review and approve contract upgrades for security.
          </p>
        </div>
      }
      fallbackWidth="full"
    >
      {upgradePlanId ? (
        <ContractUpgradeReviewPanel
          upgradePlanId={upgradePlanId}
          token={token}
          walletAddress={walletAddress}
        />
      ) : (
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
          <h3 className="font-semibold text-white mb-2">No upgrade specified</h3>
          <p className="text-sm text-slate-300">
            Please provide an upgrade plan ID in the URL (e.g., ?id=upgrade-123)
          </p>
        </div>
      )}
    </RecentAuthGate>
  );
}
