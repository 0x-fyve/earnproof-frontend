"use client";

import { useCallback, useRef, useState } from "react";
import { classifySyncOutcome, syncPayments, type PaymentSyncOutcome } from "@/lib/api/payments";
import type { PaymentSyncResult } from "@/lib/api/generated/v1";
import { readStoredSession } from "@/lib/session";

type SessionData = {
  token: string;
  user: {
    id: string;
    role: string;
  };
};

type SyncPhase = "idle" | "syncing" | "succeeded" | "failed";

interface SyncState {
  phase: SyncPhase;
  result: PaymentSyncResult | null;
  outcome: PaymentSyncOutcome | null;
  error: string | null;
  /** The last successful result, kept even after a later attempt fails, so
   * an operator can see what the last known-good checkpoint was (#138). */
  lastSuccess: PaymentSyncResult | null;
}

const INITIAL_STATE: SyncState = {
  phase: "idle",
  result: null,
  outcome: null,
  error: null,
  lastSuccess: null,
};

const outcomeCopy: Record<PaymentSyncOutcome, { label: string; tone: string }> = {
  noop: { label: "No new payments to sync", tone: "border-white/15 bg-white/[0.04] text-slate-300" },
  partial: {
    label: "Sync completed with some payments skipped",
    tone: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  },
  complete: {
    label: "Sync completed successfully",
    tone: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  },
};

export function PaymentSyncPanel() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [state, setState] = useState<SyncState>(INITIAL_STATE);
  // Guards against duplicate concurrent requests from rapid repeated
  // clicks; `state.phase === "syncing"` alone is not enough because the
  // state update from the first click may not have committed yet when a
  // second click handler runs in the same tick.
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runSync = useCallback(async () => {
    if (!session || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState((prev) => ({ ...prev, phase: "syncing", error: null }));

    try {
      const result = await syncPayments(session.token, controller.signal);
      if (controller.signal.aborted) return;

      setState(() => ({
        phase: "succeeded",
        result,
        outcome: classifySyncOutcome(result),
        error: null,
        lastSuccess: result,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;

      setState((prev) => ({
        ...prev,
        phase: "failed",
        error: err instanceof Error ? err.message : "Payment sync failed. Please try again.",
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [session]);

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to sync payments.
        </p>
      </div>
    );
  }

  const isSyncing = state.phase === "syncing";

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-semibold text-white">Payment Synchronization</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Pull the latest payments from the network into EarnProof.
          </p>
        </div>
        <button
          aria-busy={isSyncing}
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSyncing}
          onClick={runSync}
          type="button"
        >
          {isSyncing ? "Syncing..." : state.phase === "failed" ? "Retry sync" : "Sync payments"}
        </button>
      </div>

      {/* A single aria-live="polite" region wrapping whichever status panel
          is visible: screen readers announce it on every phase change
          without moving focus off whatever the operator was doing (#138:
          "do not steal focus"). Kept as one region (rather than a
          separate sr-only duplicate of the same text) so there is exactly
          one accessible name for "the sync status", not two competing
          copies of it. */}
      <div aria-live="polite" role="status">
        {isSyncing && (
          <div className="flex items-center gap-3 rounded-md border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100">
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-200 border-t-transparent"
            />
            Sync in progress...
          </div>
        )}

        {state.phase === "succeeded" && state.outcome && state.result && (
          <div className={`rounded-md border p-3 text-sm ${outcomeCopy[state.outcome].tone}`}>
            <p className="font-medium">{outcomeCopy[state.outcome].label}</p>
            <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="uppercase tracking-wide opacity-70">Created</dt>
                <dd className="mt-0.5 text-sm font-semibold">{state.result.created ?? 0}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide opacity-70">Updated</dt>
                <dd className="mt-0.5 text-sm font-semibold">{state.result.updated ?? 0}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide opacity-70">Skipped</dt>
                <dd className="mt-0.5 text-sm font-semibold">{state.result.skipped ?? 0}</dd>
              </div>
            </dl>
          </div>
        )}

        {state.phase === "failed" && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {state.error}
            </p>
            {state.lastSuccess && (
              <p className="mt-2 text-xs text-rose-200/80">
                Last successful sync: {state.lastSuccess.created ?? 0} created,{" "}
                {state.lastSuccess.updated ?? 0} updated, {state.lastSuccess.skipped ?? 0} skipped.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
