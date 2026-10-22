"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Timestamp } from "@/components/common/timestamp";
import { formatNumber } from "@/lib/i18n";
import {
  VERIFICATION_EVIDENCE_SOURCE_LABELS,
  isVerificationEvidenceSource,
  type LiveVerificationRefreshLoader,
  type VerificationEvidence,
  type VerificationEvidenceSource,
  type VerifierFreshnessPolicy,
} from "@/lib/api/live-verification-refresh";
import {
  assessFreshness,
  buildSourceOptions,
  canRequestLiveRefresh,
  cooldownRemainingMs,
  firstSelectableSource,
  type FreshnessAssessment,
} from "@/lib/verification/live-refresh";
import {
  useLiveVerificationRefresh,
  type RefreshFailure,
  type RefreshPhase,
} from "@/lib/verification/use-live-verification-refresh";

export interface LiveVerificationRefreshProps {
  proofId: string;
  organizationId: string | null;
  /** Viewer's session role; null = not signed in. */
  viewerRole: string | null;
  /** Evidence already shown by the cached verification path, if any. */
  cachedEvidence: VerificationEvidence | null;
  /** Verifier freshness policy; null = unknown, so freshness cannot be confirmed. */
  policy: VerifierFreshnessPolicy | null;
  /** Sources the backend advertises for this deployment (see lib/api/live-verification-refresh.ts). */
  supportedSources: readonly string[];
  refresh: LiveVerificationRefreshLoader;
  /** Injected for tests. */
  now?: () => number;
  timeoutMs?: number;
  cooldownMs?: number;
}

const PHASE_COPY: Record<Exclude<RefreshPhase, "idle" | "failed">, string> = {
  requesting: "Requesting refresh…",
  fetching: "Fetching evidence from the selected source…",
  validating: "Validating evidence…",
  done: "Refresh complete.",
};

const FAILURE_COPY: Record<RefreshFailure, string> = {
  timeout: "The live refresh timed out.",
  source_error: "The selected source could not provide evidence.",
  unauthenticated: "Your session has expired. Sign in again to request a refresh.",
  forbidden: "Your account is not allowed to request a live refresh.",
  rate_limited: "Too many refresh requests. Wait for the cooldown to end.",
  unsupported_version: "The server returned evidence in a format this app does not support.",
  invalid_response: "The server returned malformed evidence.",
  mismatch: "The server returned evidence for a different proof or source, so it was discarded.",
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(formatNumber(hours) + " h");
  if (minutes > 0) parts.push(formatNumber(minutes) + " min");
  if (seconds > 0 || parts.length === 0) parts.push(formatNumber(seconds) + " s");
  return parts.join(" ");
}

function FreshnessBadge({ assessment }: { assessment: FreshnessAssessment }) {
  switch (assessment.status) {
    case "fresh":
      return (
        <p className="text-sm font-semibold text-emerald-200" data-freshness="fresh">
          <span aria-hidden="true">✓ </span>
          {"Fresh: " + formatDuration(assessment.ageMs) + " old, policy allows under " + formatDuration(assessment.maxAgeMs) + "."}
        </p>
      );
    case "stale":
      return (
        <p className="text-sm font-semibold text-amber-200" data-freshness="stale">
          <span aria-hidden="true">⚠ </span>
          {"STALE: " + formatDuration(assessment.ageMs) + " old. Does not meet policy freshness (must be under " + formatDuration(assessment.maxAgeMs) + ")."}
        </p>
      );
    case "no_policy":
      return (
        <p className="text-sm font-semibold text-amber-200" data-freshness="no_policy">
          <span aria-hidden="true">? </span>
          {"Freshness not confirmed: " + formatDuration(assessment.ageMs) + " old, and no verifier freshness policy is available."}
        </p>
      );
    case "invalid_timestamp":
      return (
        <p className="text-sm font-semibold text-rose-200" data-freshness="invalid_timestamp">
          <span aria-hidden="true">! </span>
          Freshness unknown: the evidence timestamp is invalid.
        </p>
      );
  }
}

function sourceLabel(source: VerificationEvidenceSource) {
  return VERIFICATION_EVIDENCE_SOURCE_LABELS[source].label;
}

/**
 * Evidence freshness against the verifier's policy, with an explicit,
 * bounded live refresh from a backend-supported source (#268). Cached
 * evidence is never presented as live or fresh when it is not: after a
 * failed refresh it is shown under an explicit "live refresh failed" label
 * with its own freshness assessment.
 */
export function LiveVerificationRefresh({
  proofId,
  organizationId,
  viewerRole,
  cachedEvidence,
  policy,
  supportedSources,
  refresh,
  now = Date.now,
  timeoutMs,
  cooldownMs,
}: LiveVerificationRefreshProps) {
  const allowed = canRequestLiveRefresh(viewerRole);
  const options = useMemo(() => buildSourceOptions(supportedSources), [supportedSources]);
  const [chosenSource, setChosenSource] = useState<string | null>(null);
  const source: VerificationEvidenceSource | null =
    chosenSource && isVerificationEvidenceSource(chosenSource) && supportedSources.includes(chosenSource)
      ? chosenSource
      : firstSelectableSource(supportedSources);

  const { phase, failure, liveEvidence, cooldownUntil, blocked, trigger } = useLiveVerificationRefresh({
    proofId,
    organizationId,
    source,
    allowed,
    loader: refresh,
    now,
    timeoutMs,
    cooldownMs,
  });

  const [nowMs, setNowMs] = useState(() => now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(now()), 1000);
    return () => clearInterval(interval);
  }, [now]);

  const legendId = useId();
  const reasonId = useId();
  const cooldownMsLeft = cooldownRemainingMs(cooldownUntil, nowMs);
  const inFlight = phase === "requesting" || phase === "fetching" || phase === "validating";
  // A cached-evidence object for a different proof is never shown for this one.
  const cached = cachedEvidence && cachedEvidence.proofId === proofId ? cachedEvidence : null;
  const shown = liveEvidence ?? cached;
  const assessment = shown ? assessFreshness(shown.observedAt, policy, nowMs) : null;

  let disabledReason: string | null = null;
  if (!viewerRole) disabledReason = "Sign in to request a refresh.";
  else if (!allowed) disabledReason = "Your account cannot request a refresh.";
  else if (blocked) disabledReason = FAILURE_COPY[blocked];
  else if (!source) disabledReason = "No refresh source is available from this server.";
  else if (inFlight) disabledReason = "A refresh is already in progress.";
  else if (cooldownMsLeft > 0) disabledReason = "Next refresh available in " + formatDuration(cooldownMsLeft) + ".";

  let evidenceTitle = "No evidence yet";
  if (liveEvidence) evidenceTitle = "Refreshed evidence from " + sourceLabel(liveEvidence.source);
  else if (cached && phase === "failed") evidenceTitle = "Cached evidence (live refresh failed)";
  else if (cached) evidenceTitle = "Cached evidence";

  return (
    <section aria-labelledby={legendId + "-title"} className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <h3 id={legendId + "-title"} className="text-base font-semibold text-white">
        Evidence freshness
      </h3>
      <p className="text-sm text-slate-300">
        {policy && policy.maxEvidenceAgeMs > 0
          ? "Verifier policy: evidence must be under " + formatDuration(policy.maxEvidenceAgeMs) + " old."
          : "No verifier freshness policy is available, so freshness cannot be confirmed."}
      </p>

      <div className="grid gap-1 rounded-lg border border-white/10 p-3" data-testid="evidence-panel">
        <h4 className="text-sm font-semibold text-white">{evidenceTitle}</h4>
        {shown && assessment ? (
          <>
            <p className="text-sm text-slate-300">
              Observed <Timestamp value={shown.observedAt} />. Result: {shown.result}
            </p>
            <FreshnessBadge assessment={assessment} />
          </>
        ) : (
          <p className="text-sm text-slate-300">Request a refresh to fetch evidence for this proof.</p>
        )}
      </div>

      <fieldset className="grid gap-2" aria-describedby={reasonId}>
        <legend id={legendId} className="text-sm font-semibold text-white">
          Evidence source
        </legend>
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm text-slate-200">
            <input
              type="radio"
              name={legendId + "-source"}
              value={option.value}
              checked={option.selectable && source === option.value}
              disabled={!option.selectable}
              onChange={() => setChosenSource(option.value)}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">{option.label}</span>
              {!option.known
                ? " (unknown source, not selectable)"
                : !option.selectable
                  ? " (not supported by this server)"
                  : null}
              <span className="block text-xs text-slate-400">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-2">
        <div>
          <button
            type="button"
            onClick={() => trigger()}
            disabled={disabledReason !== null}
            aria-describedby={reasonId}
            className="h-10 rounded-md border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh evidence
          </button>
        </div>
        <p id={reasonId} className="text-xs text-slate-400">
          {disabledReason ?? (source ? "Refreshes from " + sourceLabel(source) + "." : "")}
        </p>
      </div>

      <div role="status" aria-live="polite" className="grid gap-1" data-testid="refresh-progress">
        {phase === "failed" && failure ? (
          <p className="text-sm text-rose-100">
            <span aria-hidden="true">✕ </span>
            {FAILURE_COPY[failure]}
            {cached ? " Showing cached evidence, which is not live." : " No cached evidence is available."}
          </p>
        ) : phase !== "idle" && phase !== "failed" ? (
          <p className="text-sm text-slate-200">{PHASE_COPY[phase]}</p>
        ) : null}
      </div>
    </section>
  );
}
