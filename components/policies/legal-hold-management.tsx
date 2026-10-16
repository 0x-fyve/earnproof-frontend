"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredSession, type Session as SessionData } from "@/lib/session";
import {
  getLegalHolds,
  createLegalHoldSafe,
  releaseLegalHoldSafe,
  validateLegalHoldDateRange,
  validateLegalHoldReason,
  formatLegalHoldStatus,
  getLegalHoldStatusTone,
  type LegalHold,
  type LegalHoldsPage,
  type CreateLegalHoldRequest,
} from "@/lib/api/retention";

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateForInput(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Legal Hold Management Component
 * 
 * Allows compliance officers to:
 * - View active and released legal holds
 * - Create new legal holds to prevent audit record deletion
 * - Release legal holds with approval reason
 * 
 * Server-side authorization ensures only ADMIN role can create/release holds.
 * Held records are never shown as eligible for cleanup in the audit log.
 */
export function LegalHoldManagement() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<"ACTIVE" | "RELEASED" | "EXPIRED" | "ALL">("ACTIVE");
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionToken = session?.token ?? null;

  // Create hold form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [createFormData, setCreateFormData] = useState({
    startDate: "",
    endDate: "",
    reason: "",
    expiresAt: "",
  });
  const [createLoading, setCreateLoading] = useState(false);

  // Release hold form state
  const [releaseHoldId, setReleaseHoldId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const loadHolds = useCallback(
    async (cursor?: string) => {
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
        const status = activeStatus === "ALL" ? undefined : activeStatus;
        const page = await getLegalHolds(sessionToken, controller.signal, status, cursor);
        if (controller.signal.aborted) {
          return;
        }
        setHolds((prev) => (cursor ? [...prev, ...page.holds] : page.holds));
        setNextCursor(page.nextCursor);
      } catch {
        if (!controller.signal.aborted) {
          setError("Failed to load legal holds. Please try again.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [sessionToken, activeStatus],
  );

  useEffect(() => {
    setHolds([]);
    setNextCursor(null);
    void loadHolds();
  }, [activeStatus]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleCreateHold = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateFormError(null);

    // Validate required fields
    if (!createFormData.startDate || !createFormData.endDate || !createFormData.reason) {
      setCreateFormError("Start date, end date, and reason are required");
      return;
    }

    // Validate date range
    const dateRangeError = validateLegalHoldDateRange(createFormData.startDate, createFormData.endDate);
    if (dateRangeError) {
      setCreateFormError(dateRangeError);
      return;
    }

    // Validate reason
    const reasonError = validateLegalHoldReason(createFormData.reason);
    if (reasonError) {
      setCreateFormError(reasonError);
      return;
    }

    if (!sessionToken) {
      setCreateFormError("Not authenticated");
      return;
    }

    setCreateLoading(true);

    try {
      const request: CreateLegalHoldRequest = {
        startDate: createFormData.startDate,
        endDate: createFormData.endDate,
        reason: createFormData.reason.trim(),
        expiresAt: createFormData.expiresAt || undefined,
      };

      const result = await createLegalHoldSafe(sessionToken, request, new AbortController().signal);
      if (result.success) {
        setSuccessMessage("Legal hold created successfully");
        setShowCreateForm(false);
        setCreateFormData({ startDate: "", endDate: "", reason: "", expiresAt: "" });
        // Reload holds
        setHolds([]);
        setNextCursor(null);
        void loadHolds();
      } else {
        setCreateFormError(result.error.message);
      }
    } catch {
      setCreateFormError("Failed to create legal hold. Please try again.");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleReleaseHold = async (holdId: string) => {
    setReleaseError(null);

    if (!sessionToken) {
      setReleaseError("Not authenticated");
      return;
    }

    setReleaseLoading(true);

    try {
      const result = await releaseLegalHoldSafe(
        sessionToken,
        holdId,
        { reason: releaseReason.trim() || undefined },
        new AbortController().signal,
      );

      if (result.success) {
        setSuccessMessage("Legal hold released successfully");
        setReleaseHoldId(null);
        setReleaseReason("");
        // Reload holds
        setHolds([]);
        setNextCursor(null);
        void loadHolds();
      } else {
        setReleaseError(result.error.message);
      }
    } catch {
      setReleaseError("Failed to release legal hold. Please try again.");
    } finally {
      setReleaseLoading(false);
    }
  };

  const isAdmin = session?.user.role === "ADMIN" || session?.user.role === "ISSUER";

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to manage legal holds.
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
          Legal hold management requires administrative access. Contact your administrator if you need access to this
          tool.
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

      {/* Filters and controls */}
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Legal Holds</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Prevent audit record deletion by placing legal holds on date ranges.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30 disabled:opacity-50"
              disabled={createLoading}
            >
              {showCreateForm ? "Cancel" : "Create Hold"}
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex gap-2">
          {(["ACTIVE", "RELEASED", "EXPIRED", "ALL"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setActiveStatus(status)}
              className={`h-9 rounded-md border px-3 text-xs font-semibold transition ${
                activeStatus === status
                  ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-200"
                  : "border-white/15 text-slate-300 hover:border-white/30"
              }`}
            >
              {status === "ALL" ? "All" : status}
            </button>
          ))}
        </div>
      </section>

      {/* Create hold form */}
      {showCreateForm && (
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-lg font-semibold text-white">Create New Legal Hold</h3>
          <form onSubmit={handleCreateHold} className="mt-4 grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-300">
                Start Date
                <input
                  type="date"
                  value={createFormData.startDate}
                  onChange={(e) => setCreateFormData({ ...createFormData, startDate: e.target.value })}
                  className="h-11 rounded-md border border-white/10 bg-slate-900 px-4 text-white"
                  required
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-300">
                End Date
                <input
                  type="date"
                  value={createFormData.endDate}
                  onChange={(e) => setCreateFormData({ ...createFormData, endDate: e.target.value })}
                  className="h-11 rounded-md border border-white/10 bg-slate-900 px-4 text-white"
                  required
                />
              </label>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-slate-300">
              Reason
              <textarea
                value={createFormData.reason}
                onChange={(e) => setCreateFormData({ ...createFormData, reason: e.target.value })}
                className="min-h-20 rounded-md border border-white/10 bg-slate-900 px-4 py-2 text-white"
                placeholder="Explain the reason for this legal hold (minimum 10 characters)"
                required
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-300">
              Expiration Date (Optional)
              <input
                type="date"
                value={createFormData.expiresAt}
                onChange={(e) => setCreateFormData({ ...createFormData, expiresAt: e.target.value })}
                className="h-11 rounded-md border border-white/10 bg-slate-900 px-4 text-white"
              />
            </label>

            {createFormError && (
              <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
                <p className="text-sm text-rose-200" role="alert">
                  {createFormError}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                disabled={createLoading}
              >
                {createLoading ? "Creating..." : "Create Hold"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {error}
          </p>
        </div>
      )}

      {/* Holds list */}
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        {holds.length === 0 && !loading ? (
          <p className="text-sm text-slate-300">No legal holds found.</p>
        ) : (
          <div className="grid gap-3">
            {holds.map((hold) => {
              const tone = getLegalHoldStatusTone(hold.status);
              return (
                <div key={hold.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="grid gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-7 items-center rounded-lg border px-1.5 text-xs font-semibold ${
                            tone === "warning"
                              ? "border-amber-300/50 bg-amber-300/10 text-amber-200"
                              : tone === "success"
                                ? "border-emerald-300/50 bg-emerald-300/10 text-emerald-200"
                                : "border-cyan-300/50 bg-cyan-300/10 text-cyan-200"
                          }`}
                        >
                          {formatLegalHoldStatus(hold.status)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-white">{hold.reason}</p>
                      <p className="text-xs text-slate-400">
                        {formatDateForDisplay(hold.scope.startDate)} to {formatDateForDisplay(hold.scope.endDate)}
                      </p>
                      {hold.scope.affectedRecordCount !== undefined && (
                        <p className="text-xs text-slate-400">
                          Affected records: {hold.scope.affectedRecordCount}
                        </p>
                      )}
                      {hold.releaseApproval && (
                        <p className="text-xs text-slate-400">
                          Released by {hold.releaseApproval.approvedBy} on{" "}
                          {formatDateForDisplay(hold.releaseApproval.approvedAt)}
                        </p>
                      )}
                    </div>
                    {isAdmin && hold.status === "ACTIVE" && releaseHoldId !== hold.id && (
                      <button
                        onClick={() => setReleaseHoldId(hold.id)}
                        className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30"
                      >
                        Release
                      </button>
                    )}
                  </div>

                  {/* Release form */}
                  {releaseHoldId === hold.id && (
                    <div className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-4">
                      <label className="grid gap-1 text-xs font-semibold text-slate-300">
                        Release Reason (Optional)
                        <textarea
                          value={releaseReason}
                          onChange={(e) => setReleaseReason(e.target.value)}
                          className="min-h-16 rounded-md border border-white/10 bg-slate-900 px-4 py-2 text-white"
                          placeholder="Document why this hold is being released"
                        />
                      </label>
                      {releaseError && (
                        <div className="mt-3 rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
                          <p className="text-sm text-rose-200" role="alert">
                            {releaseError}
                          </p>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handleReleaseHold(hold.id)}
                          className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                          disabled={releaseLoading}
                        >
                          {releaseLoading ? "Releasing..." : "Confirm Release"}
                        </button>
                        <button
                          onClick={() => {
                            setReleaseHoldId(null);
                            setReleaseReason("");
                            setReleaseError(null);
                          }}
                          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {loading && holds.length === 0 && (
          <p className="text-sm text-slate-300">Loading legal holds...</p>
        )}

        {nextCursor && (
          <button
            onClick={() => loadHolds(nextCursor)}
            className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:border-white/30 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        )}
      </section>
    </div>
  );
}
