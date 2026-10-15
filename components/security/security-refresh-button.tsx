"use client";

import { useState } from "react";
import { useAuthSession } from "@/lib/auth";
import { evaluateSecurityChecks } from "@/lib/api/security-posture";

interface SecurityRefreshButtonProps {
  organizationId: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/**
 * Button to trigger evaluation of security checks.
 */
export function SecurityRefreshButton({
  organizationId,
  onRefresh,
  isRefreshing,
}: SecurityRefreshButtonProps) {
  const { token } = useAuthSession();
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    if (!token || isRefreshing) return;

    setError(null);

    try {
      const controller = new AbortController();
      await evaluateSecurityChecks(
        token,
        organizationId,
        { checkIds: [] },
        controller.signal
      );
      onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh";
      setError(message);
    }
  };

  return (
    <>
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        title={error ? error : "Refresh security checks"}
        className="inline-flex items-center gap-2 rounded-md bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-300/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg
          className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {isRefreshing ? "Evaluating..." : "Evaluate"}
      </button>
      {error && (
        <div className="absolute top-12 right-0 rounded-md border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300 whitespace-nowrap">
          {error}
        </div>
      )}
    </>
  );
}
