"use client";

import { useId, useState } from "react";
import {
  copyTextToClipboard,
  downloadTextFile,
  type ArtifactExportPlan,
} from "@/lib/credentials/export";
import { verifyDigest, type DigestVerificationResult } from "@/lib/credentials/verify-digest";
import { formatMessage } from "@/lib/i18n";
import { useAnnounce } from "@/lib/a11y/announcer-context";

export function ArtifactExport({
  plan,
  title,
}: {
  plan: ArtifactExportPlan | null;
  title: string;
}) {
  const dialogId = useId();
  const { announce } = useAnnounce();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [digestResult, setDigestResult] = useState<DigestVerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  if (!plan) {
    return null;
  }

  function close() {
    setOpen(false);
    setDigestResult(null);
  }

  async function copy() {
    setError(null);
    try {
      await copyTextToClipboard(plan!.body);
      setStatus("Copied to clipboard.");
      announce("Copied to clipboard.", { source: "export" });
      setOpen(false);
    } catch {
      const message = "Clipboard copy was blocked. You can retry or download the file instead.";
      setError(message);
      announce(message, { politeness: "assertive", source: "export" });
    }
  }

  async function download() {
    setError(null);
    setDownloadFailed(false);
    setDigestResult(null);
    setIsVerifying(true);
    try {
      const bytes = new TextEncoder().encode(plan!.body).buffer;
      const result = await verifyDigest(bytes, {
        algorithm: plan!.digest?.algorithm ?? "SHA-256",
        expectedDigest: plan!.digest?.value,
      });
      setDigestResult(result);

      if (result.status === "mismatch") {
        const message =
          "The exported file's integrity check did not match. Nothing was downloaded — please retry.";
        setError(message);
        announce(message, { politeness: "assertive", source: "export" });
        setDownloadFailed(true);
        return;
      }
      if (result.status === "unsupported-algorithm") {
        const message = formatMessage(
          "Cannot verify this export (unsupported integrity algorithm: {algorithm}). Nothing was downloaded.",
          { algorithm: result.algorithm },
        );
        setError(message);
        announce(message, { politeness: "assertive", source: "export" });
        setDownloadFailed(true);
        return;
      }

      // "verified" (matched, or nothing to compare against) and
      // "unavailable" (no SubtleCrypto in this environment) both proceed —
      // an environment that cannot verify is not the same as a verification
      // failure, and should not block a download entirely.
      downloadTextFile(plan!);
      const successMessage =
        result.status === "verified"
          ? "Download started. Integrity verified."
          : "Download started.";
      setStatus(successMessage);
      announce(successMessage, { source: "export" });
      setOpen(false);
    } catch {
      const message = "Download failed. Check browser permissions and try again.";
      setError(message);
      announce(message, { politeness: "assertive", source: "export" });
      setDownloadFailed(true);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        className="h-10 w-fit rounded-md border border-white/15 px-4 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        type="button"
      >
        {title}
      </button>
      <div aria-live="polite" className="sr-only" role="status">
        {status}
      </div>
      {error ? (
        <p className="text-sm text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
      {status && !open ? <p className="text-sm text-slate-300">{status}</p> : null}

      {open ? (
        <div
          aria-labelledby={dialogId}
          aria-modal="true"
          className="rounded-lg border border-cyan-300/50 bg-slate-950 p-4"
          role="dialog"
        >
          <h3 className="text-sm font-semibold text-white" id={dialogId}>
            Confirm export
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            This file includes only fields returned by the public or owned EarnProof APIs.
            Filename: <span className="text-cyan-200">{plan.filename}</span>
          </p>
          <p className="mt-3 text-xs font-semibold uppercase text-slate-400">Included fields</p>
          <ul className="mt-1 grid gap-1 text-xs text-slate-300">
            {plan.includedFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
          {plan.warnings.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {plan.warnings.map((warning) => (
                <p key={warning.field}>{warning.message}</p>
              ))}
            </div>
          ) : null}
          {digestResult && digestResult.status !== "unavailable" ? (
            <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">
              <p className="font-semibold uppercase text-slate-400">Integrity check</p>
              {digestResult.status === "verified" ? (
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="break-all font-mono text-cyan-200">{digestResult.digest}</code>
                  <button
                    className="text-cyan-300 underline"
                    onClick={() => void navigator.clipboard?.writeText(digestResult.digest)}
                    type="button"
                  >
                    Copy digest
                  </button>
                </p>
              ) : (
                <p className="mt-1 text-rose-200">
                  {digestResult.status === "mismatch"
                    ? "Digest mismatch — download blocked."
                    : formatMessage("Unsupported algorithm: {algorithm}", {
                        algorithm: digestResult.algorithm,
                      })}
                </p>
              )}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950"
              onClick={() => void copy()}
              type="button"
            >
              Copy
            </button>
            <button
              className="h-9 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => void download()}
              disabled={isVerifying}
              type="button"
            >
              {isVerifying ? "Verifying..." : downloadFailed ? "Retry download" : "Download"}
            </button>
            <button
              className="h-9 rounded-md px-4 text-xs font-semibold text-slate-300"
              onClick={close}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
