"use client";

/**
 * Backend-to-contract drift and acknowledgement panel (#220).
 *
 * Renders each drift check's category, affected capability, last-check
 * time, and acknowledgement expiry. Severity is read verbatim from the
 * server; this component never computes its own override of a "blocking"
 * decision, and "unavailable" is rendered with distinct copy/tone from
 * "matched" (see lib/api/contract-drift.ts for the invariants).
 */

import { useCallback, useEffect, useState } from "react";
import {
  canPerformAction,
  effectiveDriftState,
  driftStateCopy,
  formatAcknowledgementExpiry,
  fetchMockContractDrift,
  refreshMockDriftCheck,
  type DriftCheckResult,
  type DriftStatus,
} from "@/lib/api/contract-drift";

function toneClasses(tone: "success" | "warning" | "danger" | "neutral"): string {
  switch (tone) {
    case "success":
      return "border-emerald-300/40 bg-emerald-300/10 text-emerald-100";
    case "warning":
      return "border-amber-300/40 bg-amber-300/10 text-amber-100";
    case "danger":
      return "border-rose-300/40 bg-rose-300/10 text-rose-100";
    case "neutral":
      return "border-white/10 bg-white/[0.04] text-slate-300";
  }
}

export interface ContractDriftPanelProps {
  status: DriftStatus;
  onStatusChange?: (next: DriftStatus) => void;
  className?: string;
}

export function ContractDriftPanel({ status, onStatusChange, className = "" }: ContractDriftPanelProps) {
  const [refreshingCategory, setRefreshingCategory] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const handleRefresh = useCallback(
    async (check: DriftCheckResult) => {
      setRefreshingCategory(check.category);
      try {
        const refreshed = await refreshMockDriftCheck({ category: check.category }, status);
        onStatusChange?.(refreshed);
        setNow(Date.now());
      } finally {
        setRefreshingCategory(null);
      }
    },
    [status, onStatusChange],
  );

  return (
    <div className={`grid gap-3 ${className}`} role="list" aria-label="Backend-to-contract drift checks">
      {status.checks.map((check) => {
        const effective = effectiveDriftState(check, now);
        const copy = driftStateCopy(effective);
        const canProceed = canPerformAction(check, now);
        const expiryLabel = formatAcknowledgementExpiry(check.acknowledgement, now);

        return (
          <div
            key={check.category}
            role="listitem"
            className={`rounded-lg border px-4 py-3 text-sm ${toneClasses(copy.tone)}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{check.category.replace(/_/g, " ")}</p>
                <p className="text-xs opacity-80">Affects: {check.affectedCapability}</p>
              </div>
              <span
                role={effective === "blocking" ? "alert" : "status"}
                aria-live={effective === "blocking" ? "assertive" : "polite"}
                className="rounded-full border border-current/30 px-2 py-0.5 text-xs font-semibold"
              >
                {copy.label}
              </span>
            </div>

            <p className="mt-2">{copy.description}</p>
            <p className="mt-1 text-xs opacity-80">{check.detail}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
              <span>Check last run: {new Date(check.lastCheckedAt).toLocaleString()}</span>
              {expiryLabel ? <span>{expiryLabel}</span> : null}
            </div>

            {!canProceed ? (
              <p className="mt-2 text-xs font-medium">
                Affected actions are blocked until this check matches or is resolved by an operator.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void handleRefresh(check)}
              disabled={refreshingCategory === check.category}
              className="mt-3 rounded-md border border-current/30 px-3 py-1 text-xs font-medium transition hover:bg-white/10 disabled:opacity-50"
            >
              {refreshingCategory === check.category ? "Refreshing…" : "Refresh check"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Self-loading wrapper for pages that just need the panel without managing
 * status fetch/refresh state themselves (e.g. the status page).
 */
export function ContractDriftStatusPanel({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<DriftStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchMockContractDrift();
        if (!cancelled) {
          setStatus(loaded);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return null;
  }

  return <ContractDriftPanel className={className} status={status} onStatusChange={setStatus} />;
}
