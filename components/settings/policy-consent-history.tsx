"use client";

/**
 * Privacy policy and terms consent history (#222).
 *
 * Shows current and previously-accepted policy versions with timestamps,
 * and presents a focused consent flow when a required version changes.
 * Consent is only ever recorded from the explicit "Accept" button click
 * below — there is no auto-accept path (see lib/api/policy-consent.ts).
 */

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/i18n";
import {
  fetchMockPolicyConsentState,
  hasAcceptedCurrentVersion,
  pendingRequiredConsents,
  submitConsentMock,
  withdrawConsent,
  type PolicyConsentState,
  type PolicyVersion,
} from "@/lib/api/policy-consent";

function kindLabel(kind: PolicyVersion["kind"]): string {
  return kind === "PRIVACY_POLICY" ? "Privacy Policy" : "Terms of Service";
}

export interface PolicyConsentHistoryProps {
  state: PolicyConsentState;
  onStateChange: (next: PolicyConsentState) => void;
}

export function PolicyConsentHistory({ state, onStateChange }: PolicyConsentHistoryProps) {
  const [acceptingVersion, setAcceptingVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = pendingRequiredConsents(state);

  const handleAccept = useCallback(
    async (version: PolicyVersion) => {
      setError(null);
      setAcceptingVersion(version.version);
      try {
        const next = await submitConsentMock(state, {
          kind: version.kind,
          version: version.version,
          action: "accept",
        });
        onStateChange(next);
      } catch {
        setError("Could not record your consent. Please try again.");
      } finally {
        setAcceptingVersion(null);
      }
    },
    [state, onStateChange],
  );

  const handleWithdraw = useCallback(
    (kind: PolicyVersion["kind"]) => {
      onStateChange(withdrawConsent(state, kind));
    },
    [state, onStateChange],
  );

  return (
    <div className="grid gap-6">
      {pending.length > 0 ? (
        <section
          role="region"
          aria-label="Required policy updates"
          className="grid gap-3 rounded-lg border border-amber-300/40 bg-amber-300/10 p-5"
        >
          <h2 className="text-lg font-semibold text-amber-100">Action required</h2>
          {pending.map((version) => (
            <div key={`${version.kind}-${version.version}`} className="grid gap-2 text-sm text-amber-100">
              <p>
                The {kindLabel(version.kind)} has a new required version ({version.version}, published{" "}
                {formatDate(new Date(version.publishedAt))}).
              </p>
              {version.protectedActions.length > 0 ? (
                <p className="text-xs opacity-90">
                  Until accepted, the following actions are blocked: {version.protectedActions.join(", ")}.
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                <a
                  href={version.contentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium underline underline-offset-2"
                >
                  Review full policy text
                </a>
                <button
                  type="button"
                  onClick={() => void handleAccept(version)}
                  disabled={acceptingVersion === version.version}
                  className="rounded-md border border-amber-300/50 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:opacity-50"
                >
                  {acceptingVersion === version.version ? "Recording…" : `Accept version ${version.version}`}
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Current policies</h2>
        <ul aria-label="Current policy versions" className="grid gap-2 text-sm">
          {state.currentVersions.map((version) => {
            const accepted = hasAcceptedCurrentVersion(state, version.kind);
            return (
              <li
                key={`${version.kind}-current`}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-3"
              >
                <div>
                  <p className="font-medium text-white">{kindLabel(version.kind)}</p>
                  <p className="text-xs text-slate-400">
                    Version {version.version} · published {formatDate(new Date(version.publishedAt))}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    accepted ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"
                  }`}
                >
                  {accepted ? "Accepted" : "Not accepted"}
                </span>
                {accepted ? (
                  <button
                    type="button"
                    onClick={() => handleWithdraw(version.kind)}
                    className="h-7 rounded-md border border-white/20 px-2 text-xs text-white"
                  >
                    Withdraw
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Acceptance history</h2>
        {state.acceptanceHistory.length === 0 ? (
          <p className="text-sm text-slate-400">No acceptance records yet.</p>
        ) : (
          <ul aria-label="Acceptance history" className="grid gap-2 text-sm">
            {[...state.acceptanceHistory].reverse().map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 text-slate-300">
                <span>
                  {kindLabel(record.kind)} —{" "}
                  {record.version === "__WITHDRAWN__" ? "consent withdrawn" : `version ${record.version}`}
                </span>
                <span className="text-xs text-slate-500">{formatDate(new Date(record.acceptedAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Self-loading wrapper for the settings page: fetches the consent state
 * once on mount and owns the update state going forward.
 */
export function PolicyConsentHistoryPanel() {
  const [state, setState] = useState<PolicyConsentState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchMockPolicyConsentState();
      if (!cancelled) {
        setState(loaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    return (
      <div className="h-24 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" aria-hidden="true" />
    );
  }

  return <PolicyConsentHistory state={state} onStateChange={setState} />;
}
