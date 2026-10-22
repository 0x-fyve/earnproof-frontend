"use client";

import { StatusBadge } from "@/components/common/production-ui";
import { formatDateTime } from "@/lib/i18n";
import {
  computeRecentAuthExpiryStatus,
  SENSITIVE_ACTION_SIGNATURE_POLICIES,
  type SensitiveActionPolicyItem,
} from "@/lib/sessions/risk-history";

export interface RecentAuthExplainerProps {
  /** Timestamp (ms) of the last completed wallet signature verification, or null if none in this window. */
  lastVerifiedAtMs: number | null;
  /** Optional reference clock for deterministic rendering in tests. */
  nowMs?: number;
  /** Optional custom freshness window in milliseconds. */
  windowMs?: number;
  /** Optional callback to proactively verify a fresh wallet signature. */
  onVerifyFreshSignature?: () => void;
  /** Optional override for policies list. */
  policies?: ReadonlyArray<SensitiveActionPolicyItem>;
}

/**
 * Explains when a sensitive action requires a fresh wallet signature and
 * displays the current recent-authentication expiry window (#244).
 */
export function RecentAuthExplainer({
  lastVerifiedAtMs,
  nowMs,
  windowMs,
  onVerifyFreshSignature,
  policies = SENSITIVE_ACTION_SIGNATURE_POLICIES,
}: RecentAuthExplainerProps) {
  const expiryState = computeRecentAuthExpiryStatus({
    lastVerifiedAtMs,
    nowMs,
    windowMs,
  });

  const badgeTone =
    expiryState.status === "fresh"
      ? "success"
      : expiryState.status === "expiring-soon"
        ? "warning"
        : "accent";

  const statusLabel =
    expiryState.status === "fresh"
      ? "Fresh signature active"
      : expiryState.status === "expiring-soon"
        ? "Expiring soon"
        : expiryState.status === "expired"
          ? "Window expired"
          : "Signature required on demand";

  const remainingMinutes = Math.ceil(expiryState.remainingMs / 60_000);

  return (
    <section
      aria-labelledby="recent-auth-explainer-heading"
      className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
    >
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="recent-auth-explainer-heading"
              className="text-lg font-semibold text-white"
            >
              Recent-Authentication &amp; Step-Up Signature Policy
            </h2>
            <StatusBadge tone={badgeTone}>{statusLabel}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-slate-300">{expiryState.headline}</p>
        </div>

        {onVerifyFreshSignature && !expiryState.isFresh && (
          <button
            type="button"
            onClick={onVerifyFreshSignature}
            className="h-9 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Verify fresh wallet signature
          </button>
        )}
      </div>

      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-white/10 bg-slate-950 p-4 text-sm text-slate-300"
      >
        <p>{expiryState.explanation}</p>
        <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
          <div>
            <dt className="font-semibold uppercase text-slate-400">Freshness window</dt>
            <dd className="mt-0.5 text-slate-200">
              {Math.round(expiryState.windowMs / 60_000)} minutes after signature
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase text-slate-400">Last verified</dt>
            <dd className="mt-0.5 text-slate-200">
              {expiryState.lastVerifiedAt
                ? formatDateTime(expiryState.lastVerifiedAt)
                : "No recent verification in this tab"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase text-slate-400">Window expiry</dt>
            <dd className="mt-0.5 text-slate-200">
              {expiryState.expiresAt
                ? expiryState.isFresh
                  ? `Expires at ${formatDateTime(expiryState.expiresAt)} (${remainingMinutes} min left)`
                  : `Expired at ${formatDateTime(expiryState.expiresAt)}`
                : "Prompted when a sensitive action is started"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          When a fresh wallet signature is required
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          {policies.map((policy) => (
            <article
              key={policy.id}
              className="rounded-md border border-white/10 bg-slate-950 p-3.5 text-sm"
            >
              <h4 className="font-medium text-white">{policy.actionName}</h4>
              <p className="mt-1.5 text-xs leading-5 text-slate-300">
                {policy.whySignatureRequired}
              </p>
              <p className="mt-2 text-xs font-medium text-cyan-200">
                {policy.freshnessRequirement}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
