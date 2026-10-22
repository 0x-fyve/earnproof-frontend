"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeOutageReason,
  getCheckpointSeverity,
  getPaymentCheckpoints,
  retryCheckpoint,
  type PaymentCheckpoint,
} from "@/lib/api/payment-checkpoints";
import { Timestamp } from "@/components/common/timestamp";
import { readStoredSession, type Session as SessionData } from "@/lib/session";

type LoadState = "loading" | "ready" | "forbidden" | "error";

const statusCopy: Record<
  PaymentCheckpoint["status"],
  { label: string; tone: string }
> = {
  healthy: { label: "Healthy", tone: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" },
  lagging: { label: "Lagging", tone: "border-yellow-300/30 bg-yellow-300/10 text-yellow-100" },
  stalled: { label: "Stalled", tone: "border-rose-300/30 bg-rose-300/10 text-rose-100" },
  regressed: { label: "Regressed", tone: "border-rose-400/40 bg-rose-400/15 text-rose-100" },
  reorg: { label: "Reorg in progress", tone: "border-amber-300/30 bg-amber-300/10 text-amber-100" },
};

/**
 * Per-account payment sync checkpoint health (#240).
 *
 * Deliberately shows only ledger numbers, timestamps, and status - no
 * amount, memo, or counterparty is fetched or rendered here at all (the
 * checkpoint API this is built against, see payment-checkpoints.ts,
 * doesn't even return those fields), satisfying "No amount, memo, or
 * counterparty data appears in health summaries" by construction rather
 * than by filtering.
 */
export function CheckpointHealthDashboard() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [checkpoints, setCheckpoints] = useState<PaymentCheckpoint[]>([]);
  const [lagWarningThreshold, setLagWarningThreshold] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Capability/role gate (#240's "guarded by capability and role"),
  // matching the same session.user.role === "ADMIN" pattern already used
  // for the sibling payment-backfill admin surface.
  const isAuthorized = session?.user.role === "ADMIN";

  const load = useCallback(async () => {
    if (!session || !isAuthorized) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoadState((prev) => (prev === "ready" ? prev : "loading"));
    try {
      const response = await getPaymentCheckpoints(session.token, controller.signal);
      if (controller.signal.aborted) return;
      setCheckpoints(response.checkpoints);
      setLagWarningThreshold(response.lagWarningThresholdLedgers);
      setLoadState("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Error && err.message.includes("403")) {
        setLoadState("forbidden");
      } else {
        setLoadState("error");
      }
    }
  }, [session, isAuthorized]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      abortControllerRef.current?.abort();
    };
  }, [load]);

  const handleRetry = useCallback(
    async (accountId: string) => {
      if (!session) return;
      setRetrying(accountId);
      setRetryError(null);
      try {
        const controller = new AbortController();
        const response = await retryCheckpoint(session.token, accountId, controller.signal);
        setCheckpoints((prev) =>
          prev.map((cp) => (cp.accountId === accountId ? response.checkpoint : cp)),
        );
        if (!response.accepted) {
          setRetryError(
            response.reason ?? "Retry was not accepted. It may already be in progress.",
          );
        }
      } catch {
        setRetryError("Failed to retry this account's sync. Please try again.");
      } finally {
        setRetrying(null);
      }
    },
    [session],
  );

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to view checkpoint health.
        </p>
      </div>
    );
  }

  if (!isAuthorized || loadState === "forbidden") {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Checkpoint health diagnostics require administrator access.
        </p>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300"
        role="status"
        aria-live="polite"
      >
        Loading checkpoint health...
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-rose-100">Could not load checkpoint health</h2>
        <p className="mt-2 text-sm text-rose-200">Please try again in a moment.</p>
      </div>
    );
  }

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Payment Sync Checkpoint Health</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Per-account Stellar ingestion checkpoints, finality lag, and recovery actions.
          {lagWarningThreshold !== null && (
            <> Accounts more than {lagWarningThreshold} ledgers behind are flagged as lagging.</>
          )}
        </p>
      </div>

      {retryError && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {retryError}
          </p>
        </div>
      )}

      {checkpoints.length === 0 ? (
        <p className="text-sm text-slate-400">No accounts are currently tracked for sync.</p>
      ) : (
        <div className="grid gap-3">
          {checkpoints.map((checkpoint) => (
            <CheckpointRow
              key={checkpoint.accountId}
              checkpoint={checkpoint}
              isRetrying={retrying === checkpoint.accountId}
              onRetry={() => handleRetry(checkpoint.accountId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CheckpointRow({
  checkpoint,
  isRetrying,
  onRetry,
}: {
  checkpoint: PaymentCheckpoint;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const severity = getCheckpointSeverity(checkpoint);
  const copy = statusCopy[checkpoint.status];
  const outageExplanation = describeOutageReason(checkpoint.outageReason);
  const canRetry = checkpoint.status === "stalled" || checkpoint.status === "regressed";

  return (
    <div
      className={`grid gap-3 rounded-md border p-4 text-sm ${copy.tone}`}
      data-testid={`checkpoint-row-${checkpoint.accountId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs opacity-80">{checkpoint.accountId}</span>
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold"
          role={severity !== "normal" ? "status" : undefined}
        >
          {copy.label}
          {severity === "regressed" && (
            <span className="ml-1" aria-label="checkpoint regressed, not just lagging">
              ⚠
            </span>
          )}
          {severity === "stale" && (
            <span className="ml-1" aria-label="checkpoint is stale, past the stall threshold">
              ⏱
            </span>
          )}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="uppercase tracking-wide opacity-70">Checkpoint ledger</dt>
          <dd className="mt-0.5 font-semibold">{checkpoint.checkpointLedger}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide opacity-70">Latest finalized</dt>
          <dd className="mt-0.5 font-semibold">{checkpoint.latestFinalizedLedger}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide opacity-70">Lag</dt>
          <dd className="mt-0.5 font-semibold">{checkpoint.lagLedgers} ledgers</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide opacity-70">Last successful sync</dt>
          <dd className="mt-0.5 font-semibold">
            {checkpoint.lastSuccessfulSyncAt ? (
              <Timestamp value={checkpoint.lastSuccessfulSyncAt} />
            ) : (
              "Never"
            )}
          </dd>
        </div>
      </dl>

      {outageExplanation && (
        <p className="text-xs opacity-90" role="status">
          {outageExplanation}
        </p>
      )}

      {canRetry && (
        <div>
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="h-8 rounded border border-white/20 px-3 text-xs font-medium hover:bg-white/10 disabled:opacity-50 transition"
          >
            {isRetrying ? "Retrying..." : "Retry sync"}
          </button>
        </div>
      )}
    </div>
  );
}
