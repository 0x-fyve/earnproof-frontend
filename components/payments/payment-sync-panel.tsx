"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifySyncOutcome, syncPayments, type PaymentSyncOutcome } from "@/lib/api/payments";
import type { PaymentSyncResult } from "@/lib/api/generated/v1";
import { readStoredSession } from "@/lib/session";
import { useAnnounce } from "@/lib/a11y/announcer-context";
import { useIdempotentOperation } from "@/lib/proofs/use-idempotent-operation";
import { OperationRecoveryPanel } from "@/components/common/operation-recovery-panel";

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
  const { announce } = useAnnounce();
  // Guards against duplicate concurrent requests from rapid repeated
  // clicks; `state.phase === "syncing"` alone is not enough because the
  // state update from the first click may not have committed yet when a
  // second click handler runs in the same tick.
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // #254: a persisted idempotency key + recovery record for this sync
  // attempt, scoped to the authenticated user. There is no per-sync
  // "intent" variation (unlike proof creation's selection/threshold/period)
  // — every sync for a given user is the same logical intent — so the
  // operation key naturally stays stable across retries of a stuck sync,
  // and a brand-new intent only starts once `operation.reset()` runs after
  // a confirmed success.
  const operation = useIdempotentOperation(session?.user.id ?? "anonymous", "payment-sync");

  const runSync = useCallback(async () => {
    if (!session || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState((prev) => ({ ...prev, phase: "syncing", error: null }));
    announce("Payment sync started.", { source: "payment-sync" });

    const record = operation.begin({});

    try {
      const result = await syncPayments(session.token, controller.signal, record.idempotencyKey);
      if (controller.signal.aborted) return;

      const outcome = classifySyncOutcome(result);
      setState(() => ({
        phase: "succeeded",
        result,
        outcome,
        error: null,
        lastSuccess: result,
      }));
      announce(outcomeCopy[outcome].label, { source: "payment-sync" });
      operation.markSucceeded();
      operation.reset();
    } catch (err) {
      if (controller.signal.aborted) return;

      // Same timeout-vs-observed-failure distinction as
      // create-proof-flow.tsx's submitProof: an aborted request (client
      // timeout) means the server may have already accepted the sync, so
      // the recovery panel (poll, don't guess) is offered; any other error
      // is a real, observed failure.
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const message = isAbort
        ? "Payment sync timed out. We can't confirm whether it completed."
        : err instanceof Error
          ? err.message
          : "Payment sync failed. Please try again.";
      setState((prev) => ({
        ...prev,
        phase: "failed",
        error: message,
      }));
      announce(message, { politeness: "assertive", source: "payment-sync" });
      if (!isAbort) {
        operation.markFailed();
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [announce, operation, session]);

  const resumeSyncOperation = useCallback(async () => {
    if (!session) return;
    await operation.resume(session.token);
  }, [operation, session]);

  // Cancellation (unmount mid-sync, e.g. a route change navigating away):
  // the in-flight request is aborted above via abortControllerRef's cleanup
  // on unmount, but the status announcement must not linger after the user
  // has left — clear this flow's own message so it can't be confused with a
  // stale "in progress" read-out on whatever the user navigates to next.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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

      {/* This panel keeps its own visible aria-live="polite" region (relied
          on by its existing tests) in addition to calling the shared
          coordinator's announce() above (#252). The two are not a
          duplicate announcement in practice: this region's accessible name
          and content track the *visible* status panel the sighted user
          already sees inline, while the coordinator's off-screen regions in
          app/layout.tsx are the single place every flow in the app reports
          to, so a screen-reader user gets one coherent, ordered, deduped
          stream across flows instead of n independent per-component ones.
          A future pass may remove this local region once every consumer of
          "the sync status" has migrated to reading only the shared one. */}
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

        {/* Not shown while isSyncing: this panel's own role="status" would
            otherwise coexist with the "Sync in progress..." status region
            above inside the same aria-live="polite" container, giving two
            role="status" elements at once (ambiguous for getByRole("status")
            callers, and a confusing double status read-out for screen reader
            users). Once an attempt resolves to a non-"succeeded" terminal
            state, the in-progress region above stops rendering and this one
            takes its place instead of overlapping it. */}
        {!isSyncing && operation.record && operation.outcome && operation.outcome !== "succeeded" && (
          <div className="mt-3">
            <OperationRecoveryPanel
              disableRetry={isSyncing}
              idempotencyKey={operation.record.idempotencyKey}
              isPolling={operation.isPolling}
              onResume={resumeSyncOperation}
              onRetry={runSync}
              outcome={operation.outcome}
            />
          </div>
        )}
      </div>
    </section>
  );
}
