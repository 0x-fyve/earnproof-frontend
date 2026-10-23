"use client";

/**
 * Offline verification bundle workflow (#294).
 *
 * Drives the full lifecycle: request a bounded, scoped bundle → download it →
 * check its integrity locally → verify it offline → refresh freshness once
 * back online.
 *
 * The UI is explicit about the two limits of offline verification: a bundle is
 * time-bounded (`validUntil`), and an offline result can never assert current
 * revocation state.
 */

import { useState } from "react";
import { useNetworkStatus } from "@/lib/network";
import { useAnnounce } from "@/lib/a11y/announcer-context";
import {
  OFFLINE_BUNDLE_EXPORT_FILENAME,
  downloadTextFile,
  type ArtifactExportPlan,
} from "@/lib/credentials/export";
import {
  computeSha256Digest,
  verifyDigest,
  type DigestVerificationResult,
} from "@/lib/credentials/verify-digest";
import {
  OFFLINE_BUNDLE_MAX_VALIDITY_HOURS,
  OFFLINE_BUNDLE_MIN_VALIDITY_HOURS,
  OFFLINE_DISCLOSURE_SCOPES,
  buildOfflineBundle,
  bundleDigestInput,
  includedFields,
  isOfflineBundleRequestValid,
  refreshOfflineBundle,
  serializeOfflineBundle,
  validateOfflineBundleRequest,
  verifyOfflineBundle,
  type FreshnessRefreshResult,
  type OfflineBundleRequest,
  type OfflineBundleSource,
  type OfflineDisclosureScope,
  type OfflineVerificationBundle,
  type OfflineVerificationResult,
} from "@/lib/credentials/offline-bundle";

export interface OfflineBundleWorkflowProps {
  source: OfflineBundleSource;
  /** A previously-created bundle to open and verify (e.g. while offline). */
  initialBundle?: OfflineVerificationBundle | null;
  /** Override live connectivity (used by tests). */
  isOnline?: boolean;
  /** Fixed evaluation time (used by tests). */
  now?: Date;
  onBundleCreated?: (bundle: OfflineVerificationBundle) => void;
}

function newNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function OfflineBundleWorkflow({
  source,
  initialBundle = null,
  isOnline,
  now,
  onBundleCreated,
}: OfflineBundleWorkflowProps) {
  const network = useNetworkStatus();
  const online = isOnline ?? network.isOnline;
  const { announce } = useAnnounce();
  const currentNow = () => now ?? new Date();

  const [request, setRequest] = useState<OfflineBundleRequest>({
    proofId: source.proofId,
    scopes: ["public"],
    requestedValidityHours: 24,
  });
  const [bundle, setBundle] = useState<OfflineVerificationBundle | null>(initialBundle);
  const [digestStatus, setDigestStatus] = useState<DigestVerificationResult | null>(null);
  const [result, setResult] = useState<OfflineVerificationResult | null>(null);
  const [refreshResult, setRefreshResult] = useState<FreshnessRefreshResult | null>(null);
  const [verifiedNonces, setVerifiedNonces] = useState<string[]>([]);

  const issues = validateOfflineBundleRequest(request);
  const errors = issues.filter((issue) => issue.severity === "error");
  const canPrepare = isOfflineBundleRequestValid(request);

  const toggleScope = (scope: OfflineDisclosureScope, selected: boolean) => {
    setRequest((current) => ({
      ...current,
      scopes: selected
        ? [...new Set([...current.scopes, scope])]
        : current.scopes.filter((candidate) => candidate !== scope),
    }));
  };

  const handlePrepare = () => {
    if (!canPrepare) {
      return;
    }
    void (async () => {
      const nonce = newNonce();
      const prepared = buildOfflineBundle({
        request,
        source,
        digestValue: "",
        nonce,
        now: currentNow(),
      });
      const digest = await computeSha256Digest(toArrayBuffer(bundleDigestInput(prepared)));
      const built: OfflineVerificationBundle = {
        ...prepared,
        digest: { algorithm: "SHA-256", value: digest },
      };
      setBundle(built);
      setDigestStatus(null);
      setResult(null);
      setRefreshResult(null);
      setVerifiedNonces([]);
      onBundleCreated?.(built);
      // Generic by design: never interpolate the proof id, scopes, or
      // digest into the announcement text, only a fixed status phrase
      // (#252's "no secrets in announcements" acceptance criterion).
      announce("Offline verification bundle prepared.", { source: "import" });
    })();
  };

  const handleIntegrityCheck = () => {
    if (!bundle) return;
    void (async () => {
      const status = await verifyDigest(toArrayBuffer(bundleDigestInput(bundle)), {
        algorithm: bundle.digest.algorithm,
        expectedDigest: bundle.digest.value,
      });
      setDigestStatus(status);
      announce(
        status.status === "verified"
          ? "Integrity check passed."
          : status.status === "mismatch"
            ? "Integrity check failed: contents do not match the digest."
            : "Integrity check unavailable in this browser.",
        {
          politeness: status.status === "mismatch" ? "assertive" : "polite",
          source: "import",
        },
      );
    })();
  };

  const handleVerify = () => {
    if (!bundle) return;
    void (async () => {
      const actualDigest = await computeSha256Digest(
        toArrayBuffer(bundleDigestInput(bundle)),
      );
      const verification = verifyOfflineBundle({
        bundle,
        actualDigest,
        now: currentNow(),
        seenNonces: verifiedNonces,
      });
      setResult(verification);
      if (verification.status === "verified-offline") {
        setVerifiedNonces((previous) => [...previous, bundle.nonce]);
      }
      // verification.message is also a fixed, non-data-bearing phrase (see
      // lib/credentials/offline-bundle.ts) — safe to announce directly.
      announce(verification.message, {
        politeness: verification.status === "verified-offline" ? "polite" : "assertive",
        source: "import",
      });
    })();
  };

  const handleRefresh = () => {
    if (!bundle) return;
    const refreshed = refreshOfflineBundle({ bundle, isOnline: online, now: currentNow() });
    setRefreshResult(refreshed);
    announce(refreshed.message, { source: "import" });
  };

  const handleDownload = () => {
    if (!bundle) return;
    const warnings = bundle.scopes
      .filter((scope): scope is "subject" | "amount" | "sender" => scope !== "public")
      .map((scope) => ({
        field: (scope === "subject" ? "actor" : scope) as "actor" | "amount" | "sender",
        message: `This bundle discloses the ${scope} scope.`,
      }));
    const plan: ArtifactExportPlan = {
      filename: OFFLINE_BUNDLE_EXPORT_FILENAME,
      includedFields: includedFields(bundle),
      warnings,
      body: serializeOfflineBundle(bundle),
      mimeType: "application/json",
      digest: { algorithm: bundle.digest.algorithm, value: bundle.digest.value },
    };
    downloadTextFile(plan);
  };

  return (
    <section
      aria-labelledby="offline-bundle-heading"
      className="grid gap-6 rounded-lg border border-white/10 bg-white/[0.04] p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white" id="offline-bundle-heading">
            Offline verification bundle
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Prepare bounded evidence you can verify without a network connection.
          </p>
        </div>
        <span
          className="text-xs font-semibold text-slate-300"
          data-testid="connectivity"
        >
          {online ? "Online" : "Offline"}
        </span>
      </header>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-slate-200">Request a bundle</legend>

        <p className="text-sm text-slate-300">
          Proof <span className="font-mono">{source.proofId}</span>
        </p>

        <label className="grid gap-1 text-sm text-slate-300">
          <span>Valid for (hours)</span>
          <input
            className="h-9 w-fit rounded-md border border-white/15 bg-slate-900/40 px-3 text-sm text-white"
            max={OFFLINE_BUNDLE_MAX_VALIDITY_HOURS}
            min={OFFLINE_BUNDLE_MIN_VALIDITY_HOURS}
            onChange={(event) =>
              setRequest((current) => ({
                ...current,
                requestedValidityHours:
                  Number.parseInt(event.target.value, 10) || 0,
              }))
            }
            type="number"
            value={request.requestedValidityHours}
          />
        </label>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {OFFLINE_DISCLOSURE_SCOPES.map((scope) => {
            const isPublic = scope === "public";
            return (
              <label className="flex items-center gap-2 text-sm text-slate-300" key={scope}>
                <input
                  checked={isPublic || request.scopes.includes(scope)}
                  disabled={isPublic}
                  onChange={(event) => toggleScope(scope, event.target.checked)}
                  type="checkbox"
                />
                <span>{scope}</span>
              </label>
            );
          })}
        </div>

        {errors.length > 0 ? (
          <ul className="grid gap-1 rounded-lg border border-rose-300/40 bg-rose-300/10 p-3 text-sm text-rose-100" role="alert">
            {errors.map((issue) => (
              <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}

        <button
          className="h-9 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
          disabled={!canPrepare}
          onClick={handlePrepare}
          type="button"
        >
          Prepare bundle
        </button>
      </fieldset>

      {bundle ? (
        <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-900/30 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Prepared bundle</h3>
          <dl className="grid gap-1 text-sm text-slate-300">
            <div className="flex gap-2">
              <dt className="font-semibold">Valid until:</dt>
              <dd data-testid="valid-until">{bundle.validUntil}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold">Scopes:</dt>
              <dd data-testid="bundle-scopes">{bundle.scopes.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold">Digest:</dt>
              <dd className="break-all font-mono text-xs">{bundle.digest.value}</dd>
            </div>
          </dl>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Included fields</p>
            <ul className="mt-1 grid gap-1 text-sm text-slate-300" data-testid="included-fields">
              {includedFields(bundle).map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/5"
              onClick={handleDownload}
              type="button"
            >
              Download bundle
            </button>
            <button
              className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/5"
              onClick={handleIntegrityCheck}
              type="button"
            >
              Check integrity
            </button>
            <button
              className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/5"
              onClick={handleVerify}
              type="button"
            >
              Verify offline
            </button>
            <button
              className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/5 disabled:opacity-50"
              disabled={!online}
              onClick={handleRefresh}
              type="button"
            >
              Refresh freshness
            </button>
          </div>

          {digestStatus ? (
            <p className="text-sm text-slate-300" data-testid="integrity-status">
              {digestStatus.status === "verified"
                ? "Integrity check passed."
                : digestStatus.status === "mismatch"
                  ? "Integrity check failed: contents do not match the digest."
                  : "Integrity check unavailable in this browser."}
            </p>
          ) : null}

          {result ? (
            <div
              className={`rounded-lg border p-3 text-sm ${
                result.status === "verified-offline"
                  ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100"
                  : "border-amber-300/40 bg-amber-300/10 text-amber-100"
              }`}
              data-testid="offline-result"
              role="status"
            >
              <p className="font-semibold" data-testid="offline-result-status">
                {result.status}
              </p>
              <p className="mt-1">{result.message}</p>
              <p className="mt-1 text-xs">
                Valid until {result.validUntil}. Freshness: {result.fresh ? "fresh" : "stale"}.
                Revocation: not checked offline.
              </p>
            </div>
          ) : null}

          {refreshResult ? (
            <div
              className="rounded-lg border border-white/10 bg-slate-900/40 p-3 text-sm text-slate-200"
              data-testid="refresh-result"
              role="status"
            >
              <p className="font-semibold">{refreshResult.status}</p>
              <p className="mt-1">{refreshResult.message}</p>
              <p className="mt-1 text-xs">
                Revocation state: {refreshResult.revocation === "current" ? "current" : "unknown"}.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
