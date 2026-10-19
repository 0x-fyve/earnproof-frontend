"use client";

import { useMemo } from "react";
import {
  canDownloadBundle,
  formatEvidenceState,
  isBlockingEvidenceState,
  type BundleInspectionResult,
  type EvidenceState,
} from "@/lib/credentials/bundle-inspector";
import { formatDateTimeWithZone, getTimeZonePreference } from "@/lib/i18n";

const STATE_STYLES: Record<EvidenceState, string> = {
  verified: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  unavailable: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  stale: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  "mismatched-network": "border-rose-300/30 bg-rose-300/10 text-rose-100",
  "partially-verified": "border-amber-300/30 bg-amber-300/10 text-amber-100",
  tampered: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  expired: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  "unsupported-version": "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

/**
 * Renders a verification evidence bundle's manifest and gates its download
 * button on the already-computed inspection result (#242). This component
 * never recomputes or overrides the integrity decision: `canDownloadBundle`
 * from `lib/credentials/bundle-inspector.ts` is the only thing that decides
 * whether the download button is enabled, and there is no prop that lets a
 * caller force it enabled when the state is blocking.
 */
export function BundleInspectorPanel({
  result,
  onDownload,
  timeZone,
}: {
  result: BundleInspectionResult | { state: "unavailable"; message: string };
  onDownload?: () => void;
  timeZone?: string;
}) {
  const resolvedTimeZone = timeZone ?? getTimeZonePreference();
  const downloadAllowed = useMemo(() => canDownloadBundle(result.state), [result.state]);
  const blocking = isBlockingEvidenceState(result.state);

  if (result.state === "unavailable" || !("manifest" in result)) {
    return (
      <section className={`grid gap-3 rounded-lg border p-4 ${STATE_STYLES.unavailable}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Evidence bundle</h3>
          <span className="text-xs font-semibold uppercase">{formatEvidenceState("unavailable")}</span>
        </div>
        <p className="text-xs text-slate-300" role="status">
          {result.message}
        </p>
      </section>
    );
  }

  const { manifest } = result;

  return (
    <section className={`grid gap-3 rounded-lg border p-4 ${STATE_STYLES[result.state]}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Evidence bundle</h3>
        <span className="text-xs font-semibold uppercase">{formatEvidenceState(result.state)}</span>
      </div>

      <p className="text-xs" role={blocking ? "alert" : "status"}>
        {result.message}
      </p>

      <dl className="grid gap-2 text-xs text-slate-300">
        <div className="flex justify-between gap-2">
          <dt>Bundle ID</dt>
          <dd className="truncate font-mono">{manifest.bundleId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Schema version</dt>
          <dd>{manifest.schemaVersion}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Network</dt>
          <dd>{manifest.network}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Contract</dt>
          <dd className="truncate font-mono">{manifest.contractId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Created</dt>
          <dd>{formatDateTimeWithZone(manifest.createdAt, undefined, resolvedTimeZone)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Valid until</dt>
          <dd>{formatDateTimeWithZone(manifest.validUntil, undefined, resolvedTimeZone)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Digest ({manifest.digestAlgorithm})</dt>
          <dd className="truncate font-mono">{manifest.digestValue}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Disclosure scopes</dt>
          <dd>{manifest.scopes.join(", ") || "public"}</dd>
        </div>
      </dl>

      <button
        aria-disabled={!downloadAllowed}
        className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-400 disabled:hover:bg-slate-600"
        disabled={!downloadAllowed}
        onClick={downloadAllowed ? onDownload : undefined}
        type="button"
      >
        {downloadAllowed ? "Download bundle" : "Download blocked"}
      </button>

      {blocking && (
        <p className="text-xs text-rose-200" role="alert">
          This bundle failed its integrity check and cannot be downloaded as trusted evidence.
        </p>
      )}
    </section>
  );
}
