"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/errors";
import {
  LiveRefreshHttpError,
  parseLiveVerificationRefresh,
  type LiveVerificationRefreshLoader,
  type VerificationEvidence,
  type VerificationEvidenceSource,
} from "@/lib/api/live-verification-refresh";
import {
  LIVE_REFRESH_COOLDOWN_MS,
  LIVE_REFRESH_TIMEOUT_MS,
  cooldownRemainingMs,
  parseRetryAfter,
} from "./live-refresh";

export type RefreshPhase = "idle" | "requesting" | "fetching" | "validating" | "done" | "failed";

export type RefreshFailure =
  | "timeout"
  | "source_error"
  | "unauthenticated"
  | "forbidden"
  | "rate_limited"
  | "unsupported_version"
  | "invalid_response"
  | "mismatch";

export type TriggerResult = "started" | "not_allowed" | "blocked" | "in_flight" | "cooling_down" | "no_source";

interface RefreshState {
  key: string;
  phase: RefreshPhase;
  failure: RefreshFailure | null;
  evidence: VerificationEvidence | null;
}

export interface UseLiveVerificationRefreshOptions {
  proofId: string;
  organizationId: string | null;
  source: VerificationEvidenceSource | null;
  allowed: boolean;
  loader: LiveVerificationRefreshLoader;
  now?: () => number;
  timeoutMs?: number;
  cooldownMs?: number;
}

/**
 * Bounded live refresh (#268):
 * - one request in flight at a time (guarded synchronously, so a
 *   double-click in the same tick cannot start two);
 * - a cooldown that starts when a request is SENT (so switching source
 *   cannot be used to bypass it), extended by a 429's Retry-After;
 * - an AbortController timeout after which the request is reported as timed
 *   out and any late response is ignored;
 * - results are applied only to the proof + tenant + source they were
 *   requested for: a change of any of them aborts the request and discards
 *   its outcome.
 */
export function useLiveVerificationRefresh({
  proofId,
  organizationId,
  source,
  allowed,
  loader,
  now = Date.now,
  timeoutMs = LIVE_REFRESH_TIMEOUT_MS,
  cooldownMs = LIVE_REFRESH_COOLDOWN_MS,
}: UseLiveVerificationRefreshOptions) {
  const scope = proofId + "|" + (organizationId ?? "");
  const key = scope + "|" + (source ?? "");
  const [state, setState] = useState<RefreshState | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [authBlock, setAuthBlock] = useState<{ scope: string; failure: "unauthenticated" | "forbidden" } | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  // A change of proof, tenant or source supersedes whatever is in flight.
  useEffect(
    () => () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [key],
  );

  const blocked = authBlock !== null && authBlock.scope === scope ? authBlock.failure : null;

  const trigger = useCallback((): TriggerResult => {
    if (!allowed) return "not_allowed";
    if (blocked) return "blocked";
    if (!source) return "no_source";
    if (controllerRef.current) return "in_flight";
    if (cooldownRemainingMs(cooldownUntil, now()) > 0) return "cooling_down";

    requestRef.current += 1;
    const requestId = requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const requested = { proofId, source, organizationId };
    const requestKey = key;
    const isCurrent = () => requestRef.current === requestId && !controller.signal.aborted;
    const update = (phase: RefreshPhase, extra: Partial<RefreshState> = {}) =>
      setState({ key: requestKey, phase, failure: null, evidence: null, ...extra });
    const release = () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };

    setCooldownUntil(now() + cooldownMs);
    update("requesting");

    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      update("failed", { failure: "timeout" });
      controller.abort();
      release();
    }, timeoutMs);

    void Promise.resolve()
      .then(() => {
        if (!isCurrent()) return undefined;
        update("fetching");
        return loader(requested, controller.signal).then((raw) => {
          if (!isCurrent()) return;
          update("validating");
          const parsed = parseLiveVerificationRefresh(raw, requested);
          if (parsed.ok) {
            update("done", { evidence: parsed.evidence });
          } else {
            const failure: RefreshFailure =
              parsed.reason === "unsupported_version" || parsed.reason === "invalid_response" ? parsed.reason : "mismatch";
            update("failed", { failure });
          }
        });
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          const failure = error.status === 401 ? "unauthenticated" : "forbidden";
          setAuthBlock({ scope, failure });
          update("failed", { failure });
          return;
        }
        if (error instanceof ApiError && error.status === 429) {
          const retryAfter = error instanceof LiveRefreshHttpError ? error.retryAfter : null;
          const delay = parseRetryAfter(retryAfter, now()) ?? cooldownMs;
          setCooldownUntil((current) => Math.max(current ?? 0, now() + delay));
          update("failed", { failure: "rate_limited" });
          return;
        }
        update("failed", { failure: "source_error" });
      })
      .finally(() => {
        clearTimeout(timer);
        release();
      });

    return "started";
  }, [allowed, blocked, cooldownMs, cooldownUntil, key, loader, now, organizationId, proofId, scope, source, timeoutMs]);

  const current = state && state.key === key ? state : null;
  return {
    phase: current?.phase ?? "idle",
    failure: current?.failure ?? null,
    liveEvidence: current?.phase === "done" ? current.evidence : null,
    cooldownUntil,
    blocked,
    trigger,
  };
}
