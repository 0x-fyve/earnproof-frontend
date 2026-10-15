"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredSession, type Session as SessionData } from "@/lib/session";
import {
  getRetentionPolicy,
  getRetentionPoliciesHistory,
  updateRetentionPolicySafe,
  formatRetentionPeriod,
  retentionPeriodToDays,
  type RetentionPolicy,
  type RetentionPeriod,
  type UpdateRetentionPolicyRequest,
} from "@/lib/api/retention";

const RETENTION_PERIODS: RetentionPeriod[] = [
  "7_DAYS",
  "30_DAYS",
  "90_DAYS",
  "1_YEAR",
  "3_YEARS",
  "5_YEARS",
  "INDEFINITE",
];

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Retention Policy Viewer Component
 * 
 * Displays the current retention policy and its history.
 * Compliance owners can understand:
 * - Current retention period
 * - When the policy became effective
 * - Historical policy changes
 * - Previous configurations
 * 
 * Server-side authorization ensures only ADMIN role can modify policies.
 */
export function RetentionPolicyViewer() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [currentPolicy, setCurrentPolicy] = useState<RetentionPolicy | null>(null);
  const [policyHistory, setPolicyHistory] = useState<RetentionPolicy[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<RetentionPeriod>("90_DAYS");
  const [updateDescription, setUpdateDescription] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionToken = session?.token ?? null;

  const loadPolicy = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const policy = await getRetentionPolicy(sessionToken, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setCurrentPolicy(policy);
      setSelectedPeriod(policy.period);
    } catch {
      if (!controller.signal.aborted) {
        setError("Failed to load retention policy. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sessionToken]);

  const loadHistory = useCallback(
    async (cursor?: string) => {
      if (!sessionToken) {
        return;
      }

      setHistoryLoading(true);

      try {
        const page = await getRetentionPoliciesHistory(sessionToken, new AbortController().signal, cursor);
        setPolicyHistory((prev) => (cursor ? [...prev, ...page.policies] : page.policies));
        setNextCursor(page.nextCursor);
      } catch {
        // Silently fail for history - it's not critical
      } finally {
        setHistoryLoading(false);
      }
    },
    [sessionToken],
  );

  useEffect(() => {
    void loadPolicy();
    void loadHistory();
  }, [loadPolicy, loadHistory]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleUpdatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdateError(null);

    if (!sessionToken) {
      setUpdateError("Not authenticated");
      return;
    }

    setUpdateLoading(true);

    try {
      const request: UpdateRetentionPolicyRequest = {
        period: selectedPeriod,
        description: updateDescription.trim() || undefined,
      };

      const result = await updateRetentionPolicySafe(sessionToken, request, new AbortController().signal);
      if (result.success) {
        setSuccessMessage("Retention policy updated successfully");
        setShowUpdateForm(false);
        setUpdateDescription("");
        void loadPolicy();
        void loadHistory();
      } else {
        setUpdateError(result.error.message);
      }
    } catch {
      setUpdateError("Failed to update retention policy. Please try again.");
    } finally {
      setUpdateLoading(false);
    }
  };

  const isAdmin = session?.user.role === "ADMIN" || session?.user.role === "ISSUER";

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to view retention policies.
        </p>
        <a
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          href="/proofs"
        >
          Connect Wallet
        </a>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Retention policy management requires administrative access. Contact your administrator if you need access to
          this tool.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      {/* Success message */}
      {successMessage && (
        <div className="rounded-md border border-emerald-300/30 bg-emerald-300/10 p-3">
          <p className="text-sm text-emerald-200" role="alert">
            {successMessage}
          </p>
        </div>
      )}

      {/* Current policy */}
      <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Current Retention Policy</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Defines how long audit records are retained before eligibility for cleanup.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowUpdateForm(!showUpdateForm)}
              className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30 disabled:opacity-50"
              disabled={updateLoading}
            >
              {showUpdateForm ? "Cancel" : "Update Policy"}
            </button>
          )}
        </div>

        {loading && !currentPolicy ? (
          <p className="mt-4 text-sm text-slate-300">Loading retention policy...</p>
        ) : currentPolicy ? (
          <div className="mt-6 grid gap-4 rounded-lg bg-slate-900/50 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-400">RETENTION PERIOD</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {formatRetentionPeriod(currentPolicy.period)}
                </p>
                {currentPolicy.period !== "INDEFINITE" && (
                  <p className="mt-1 text-xs text-slate-400">
                    ({retentionPeriodToDays(currentPolicy.period)} days)
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">EFFECTIVE FROM</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {formatDateForDisplay(currentPolicy.effectiveFrom)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">CREATED BY</p>
                <p className="mt-1 text-sm text-slate-300">{currentPolicy.createdBy}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">CREATED AT</p>
                <p className="mt-1 text-sm text-slate-300">{formatDateForDisplay(currentPolicy.createdAt)}</p>
              </div>
            </div>
            {currentPolicy.description && (
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold text-slate-400">DESCRIPTION</p>
                <p className="mt-2 text-sm text-slate-300">{currentPolicy.description}</p>
              </div>
            )}
          </div>
        ) : error ? (
          <div className="mt-4 rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          </div>
        ) : null}
      </section>

      {/* Update form */}
      {showUpdateForm && currentPolicy && (
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-lg font-semibold text-white">Update Retention Policy</h3>
          <form onSubmit={handleUpdatePolicy} className="mt-4 grid gap-4">
            <label className="grid gap-1 text-xs font-semibold text-slate-300">
              Retention Period
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value as RetentionPeriod)}
                className="h-11 rounded-md border border-white/10 bg-slate-900 px-4 text-white"
              >
                {RETENTION_PERIODS.map((period) => (
                  <option key={period} value={period} className="bg-slate-950 text-white">
                    {formatRetentionPeriod(period)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-300">
              Description (Optional)
              <textarea
                value={updateDescription}
                onChange={(e) => setUpdateDescription(e.target.value)}
                className="min-h-20 rounded-md border border-white/10 bg-slate-900 px-4 py-2 text-white"
                placeholder="Document the reason for this policy change"
              />
            </label>

            {updateError && (
              <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
                <p className="text-sm text-rose-200" role="alert">
                  {updateError}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                disabled={updateLoading}
              >
                {updateLoading ? "Updating..." : "Update Policy"}
              </button>
              <button
                type="button"
                onClick={() => setShowUpdateForm(false)}
                className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Policy history */}
      {policyHistory.length > 0 && (
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-lg font-semibold text-white">Policy History</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Previous retention policy configurations and changes.
          </p>

          <div className="mt-4 grid gap-3">
            {policyHistory.map((policy, index) => (
              <div key={`${policy.id}-${index}`} className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">RETENTION PERIOD</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatRetentionPeriod(policy.period)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400">EFFECTIVE FROM</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatDateForDisplay(policy.effectiveFrom)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400">CREATED BY</p>
                    <p className="mt-1 text-xs text-slate-300">{policy.createdBy}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400">CREATED AT</p>
                    <p className="mt-1 text-xs text-slate-300">{formatDateForDisplay(policy.createdAt)}</p>
                  </div>
                </div>
                {policy.description && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="text-xs font-semibold text-slate-400">DESCRIPTION</p>
                    <p className="mt-1 text-xs text-slate-300">{policy.description}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {nextCursor && (
            <button
              onClick={() => loadHistory(nextCursor)}
              className="mt-4 h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30 disabled:opacity-50"
              disabled={historyLoading}
            >
              {historyLoading ? "Loading..." : "Load More History"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
