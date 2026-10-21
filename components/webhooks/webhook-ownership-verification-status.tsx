"use client";

/**
 * Webhook endpoint ownership verification status (#218).
 *
 * Shows the challenge state (unverified/pending/verified/expired/failed)
 * for a webhook endpoint and offers a verify/retry action, kept separate
 * from saving endpoint config changes. Never renders the challenge secret
 * or a raw response body — only the bounded `VerificationDiagnostic`.
 * Production delivery is only shown as active when `isProductionReady()`
 * is true, which only ever checks the server-reported `state === "verified"`.
 */

import { useCallback, useEffect, useState } from "react";
import {
  WebhookVerificationForbiddenError,
  fetchMockWebhookVerification,
  isProductionReady,
  retryMockWebhookVerification,
  startMockWebhookVerification,
  verificationStateLabel,
  type WebhookOwnershipVerification,
} from "@/lib/api/webhook-ownership-verification";

function stateBadgeClass(state: WebhookOwnershipVerification["state"]): string {
  switch (state) {
    case "verified":
      return "border-emerald-300/50 bg-emerald-300/10 text-emerald-200";
    case "pending":
      return "border-cyan-300/50 bg-cyan-300/10 text-cyan-200";
    case "expired":
    case "failed":
      return "border-rose-300/50 bg-rose-300/10 text-rose-200";
    default:
      return "border-white/15 bg-white/5 text-slate-300";
  }
}

export interface WebhookOwnershipVerificationStatusProps {
  webhookId: string;
  url: string;
}

export function WebhookOwnershipVerificationStatus({
  webhookId,
  url,
}: WebhookOwnershipVerificationStatusProps) {
  const [verification, setVerification] = useState<WebhookOwnershipVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setVerification(null);
    setError(null);
    setForbidden(false);
    try {
      const result = await fetchMockWebhookVerification(webhookId, url);
      setVerification(result);
    } catch (err) {
      if (err instanceof WebhookVerificationForbiddenError) {
        setForbidden(true);
      } else {
        setError("Failed to load ownership verification status. Please try again.");
      }
    }
  }, [webhookId, url]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void load();
      }
    });
    return () => {
      active = false;
    };
    // Re-fetch (and the URL-change invalidation itself is modeled server
    // side in the fixtures) whenever the destination URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhookId, url]);

  const handleVerify = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await startMockWebhookVerification(webhookId, url);
      setVerification(result);
    } catch (err) {
      if (err instanceof WebhookVerificationForbiddenError) {
        setForbidden(true);
      } else {
        setError("Failed to start verification. Please try again.");
      }
    } finally {
      setActionLoading(false);
    }
  }, [webhookId, url]);

  const handleRetry = useCallback(async () => {
    if (!verification) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await retryMockWebhookVerification(verification);
      setVerification(result);
    } catch {
      setError("Failed to retry verification. Please try again.");
    } finally {
      setActionLoading(false);
    }
  }, [verification]);

  if (forbidden) {
    return (
      <div
        className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-400"
        data-testid="webhook-verification-forbidden"
        role="status"
      >
        You do not have access to view ownership verification for this endpoint.
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200" role="alert">
        {error}
      </div>
    );
  }

  if (!verification) {
    return (
      <div aria-busy="true" className="rounded-md border border-white/10 bg-slate-900/40 p-3 text-sm text-slate-400">
        Loading ownership verification…
      </div>
    );
  }

  const productionReady = isProductionReady(verification);
  const canRetry = verification.state === "expired" || verification.state === "failed";
  const canStart = verification.state === "unverified";

  return (
    <div
      className="grid gap-3 rounded-md border border-white/10 bg-slate-900/40 p-4 text-sm"
      data-testid="webhook-verification-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex h-6 items-center rounded border px-2 text-xs font-semibold uppercase ${stateBadgeClass(verification.state)}`}
          data-testid="webhook-verification-state"
        >
          {verificationStateLabel(verification.state)}
        </span>
        <span
          className={`inline-flex h-6 items-center rounded border px-2 text-xs font-semibold uppercase ${
            productionReady
              ? "border-emerald-300/50 bg-emerald-300/10 text-emerald-200"
              : "border-white/15 bg-white/5 text-slate-400"
          }`}
          data-testid="webhook-production-delivery"
        >
          Production delivery: {productionReady ? "Active" : "Inactive"}
        </span>
      </div>

      {verification.diagnostic ? (
        <p className="text-xs text-slate-400" data-testid="webhook-verification-diagnostic">
          Last attempt: {verification.diagnostic.statusCode ?? "no response"} ·{" "}
          {verification.diagnostic.category}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canStart ? (
          <button
            className="h-8 rounded border border-cyan-300/30 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-300/10 disabled:opacity-50 transition"
            disabled={actionLoading}
            onClick={() => void handleVerify()}
            type="button"
          >
            {actionLoading ? "Starting…" : "Verify ownership"}
          </button>
        ) : null}
        {canRetry ? (
          <button
            className="h-8 rounded border border-amber-300/30 px-3 text-xs font-medium text-amber-200 hover:bg-amber-300/10 disabled:opacity-50 transition"
            disabled={actionLoading}
            onClick={() => void handleRetry()}
            type="button"
          >
            {actionLoading ? "Retrying…" : "Retry verification"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
