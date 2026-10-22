"use client";

import { useMemo } from "react";
import { ExternalLink } from "@/components/common/external-link";
import { StatusBadge } from "@/components/common/production-ui";
import { formatDateTime } from "@/lib/i18n";
import {
  recoverTrackedOperationsForNetwork,
  resolveOperationPresentation,
  type OperationPresentationView,
  type TrackedOperationRecord,
  type TransactionConfirmationStatus,
} from "@/lib/stellar/transaction-tracker";
import { localStorageDriver, type StorageDriver } from "@/lib/storage";

export interface TransactionConfirmationTrackerProps {
  /** Active Stellar network selected by the viewer/application ("testnet" | "public"). */
  activeNetwork: string;
  /** Optional explicit list of operations; when omitted, recovers from bounded storage. */
  operations?: TrackedOperationRecord[];
  /** Optional custom storage driver for testing. */
  storageDriver?: StorageDriver;
  /** Optional reference clock (ms) for deterministic timeout evaluation. */
  nowMs?: number;
  /** Optional retry callback for timed-out or failed operations. */
  onRetryOperation?: (operation: TrackedOperationRecord) => void;
}

const STATUS_LABELS: Record<TransactionConfirmationStatus, string> = {
  submitted: "Submitted to network",
  included: "Included in ledger (awaiting finality)",
  finalized: "Finalized on network",
  failed: "Transaction failed",
  replaced: "Replaced by fee-bump / new transaction",
  "timed-out": "Confirmation timed out",
};

function statusTone(
  status: TransactionConfirmationStatus,
  isNetworkMatch: boolean,
): "success" | "warning" | "accent" {
  if (!isNetworkMatch) return "warning";
  if (status === "finalized") return "success";
  if (status === "failed" || status === "replaced" || status === "timed-out") {
    return "warning";
  }
  return "accent";
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

export function TransactionConfirmationTracker({
  activeNetwork,
  operations,
  storageDriver = localStorageDriver,
  nowMs,
  onRetryOperation,
}: TransactionConfirmationTrackerProps) {
  const views = useMemo<OperationPresentationView[]>(() => {
    if (operations) {
      return operations.map((op) =>
        resolveOperationPresentation(op, activeNetwork),
      );
    }
    return recoverTrackedOperationsForNetwork(
      activeNetwork,
      storageDriver,
      nowMs,
    );
  }, [activeNetwork, nowMs, operations, storageDriver]);

  if (views.length === 0) {
    return (
      <section
        aria-label="Transaction confirmation tracker"
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-400"
      >
        No active or recent Stellar transaction operations tracked in this
        browser.
      </section>
    );
  }

  return (
    <section
      aria-labelledby="tx-tracker-heading"
      className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
    >
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h2
            id="tx-tracker-heading"
            className="text-xl font-semibold text-white"
          >
            Transaction Confirmation Tracker
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Durable confirmation progress for Stellar and contract mutations on{" "}
            <span className="font-semibold text-white">{activeNetwork}</span>.
          </p>
        </div>
        <StatusBadge tone="accent">Active network: {activeNetwork}</StatusBadge>
      </div>

      <div className="grid gap-3">
        {views.map((view) => {
          const {
            operation,
            isNetworkMatch,
            networkMismatchReason,
            explorerHref,
            relatedResourceHref,
          } = view;

          const isFinalizedOnMatchingNetwork =
            isNetworkMatch && operation.status === "finalized";

          return (
            <article
              key={operation.operationId}
              data-testid={`tracked-tx-${operation.operationId}`}
              className="grid gap-3 rounded-md border border-white/10 bg-slate-950 p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={statusTone(operation.status, isNetworkMatch)}
                  >
                    {STATUS_LABELS[operation.status]}
                  </StatusBadge>
                  <StatusBadge tone="accent">
                    Op network: {operation.network}
                  </StatusBadge>
                  {operation.reorgCount > 0 && (
                    <StatusBadge tone="warning">
                      Reorg recovered ({operation.reorgCount})
                    </StatusBadge>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  Updated {formatDateTime(operation.updatedAt)}
                </span>
              </div>

              {!isNetworkMatch && networkMismatchReason && (
                <div
                  role="alert"
                  data-testid={`network-mismatch-${operation.operationId}`}
                  className="rounded border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100"
                >
                  <strong>Network mismatch protection: </strong>
                  {networkMismatchReason}
                </div>
              )}

              <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                <div>
                  <span className="text-slate-400">Operation: </span>
                  <span className="font-mono text-white">
                    {operation.operationId}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Transaction hash: </span>
                  <span className="font-mono text-white">
                    {truncateHash(operation.transactionHash)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Confirmations: </span>
                  <span className="font-semibold text-white">
                    {operation.confirmations} /{" "}
                    {operation.requiredConfirmations}
                  </span>
                  {operation.ledger !== null && (
                    <span className="text-slate-400">
                      {" "}
                      (Ledger #{operation.ledger})
                    </span>
                  )}
                </div>
              </div>

              {/* Step progress bar */}
              <ol
                aria-label="Confirmation lifecycle steps"
                className="grid grid-cols-3 gap-2 text-xs"
              >
                <li
                  className={`rounded border px-2.5 py-1.5 ${
                    operation.status !== "failed"
                      ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                      : "border-rose-300/30 bg-rose-300/10 text-rose-200"
                  }`}
                >
                  1. Submitted
                </li>
                <li
                  className={`rounded border px-2.5 py-1.5 ${
                    operation.status === "included" ||
                    operation.status === "finalized"
                      ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-white/[0.02] text-slate-400"
                  }`}
                >
                  2. Included in ledger
                </li>
                <li
                  className={`rounded border px-2.5 py-1.5 ${
                    isFinalizedOnMatchingNetwork
                      ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100"
                      : "border-white/10 bg-white/[0.02] text-slate-400"
                  }`}
                >
                  3. Finalized
                </li>
              </ol>

              {operation.diagnosticMessage && (
                <p className="text-xs text-slate-300">
                  {operation.diagnosticMessage}
                </p>
              )}

              {operation.status === "replaced" && operation.replacedByHash && (
                <div
                  role="note"
                  className="rounded border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100"
                >
                  Original transaction was superseded and is{" "}
                  <strong>not finalized</strong>. Replacement hash:{" "}
                  <span className="font-mono">
                    {truncateHash(operation.replacedByHash)}
                  </span>
                </div>
              )}

              {operation.status === "failed" && (
                <div
                  role="alert"
                  className="rounded border border-rose-300/30 bg-rose-300/10 p-3 text-xs text-rose-200"
                >
                  Transaction failed on-chain and is{" "}
                  <strong>not finalized</strong>.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs">
                <span className="text-slate-400">
                  Resource: {operation.resourceType} ({operation.resourceId})
                </span>

                <div className="flex flex-wrap items-center gap-3">
                  {isFinalizedOnMatchingNetwork && explorerHref && (
                    <a
                      href={explorerHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center rounded border border-cyan-300/40 bg-cyan-300/10 px-3 font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                    >
                      View on Stellar Explorer
                    </a>
                  )}

                  {isFinalizedOnMatchingNetwork && relatedResourceHref && (
                    <a
                      href={relatedResourceHref}
                      className="inline-flex h-8 items-center rounded border border-white/15 px-3 font-semibold text-white transition hover:bg-white/5"
                    >
                      Open related resource
                    </a>
                  )}

                  {isNetworkMatch &&
                    (operation.status === "timed-out" ||
                      operation.status === "failed") &&
                    onRetryOperation && (
                      <button
                        type="button"
                        onClick={() => onRetryOperation(operation)}
                        className="h-8 rounded bg-cyan-300 px-3 font-semibold text-slate-950 transition hover:bg-cyan-200"
                      >
                        Retry submission
                      </button>
                    )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
