"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import {
  buildSupportBundle,
  OPTIONAL_SUPPORT_BUNDLE_FIELDS,
  type SupportBundle,
  type SupportBundleFieldKey,
} from "@/lib/diagnostics/supportBundle";
import { copyTextToClipboard } from "@/lib/credentials/export";
import { buildSupportReference } from "@/lib/api/supportReference";

function downloadJson(bundle: SupportBundle): void {
  const body = JSON.stringify(bundle, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "earnproof-support-diagnostics.json";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

/**
 * Generates a local, redacted diagnostics bundle for support requests and
 * lets the user preview every field before copying/downloading it. Styled
 * after components/proofs/artifact-export.tsx's confirm-before-export
 * pattern.
 */
export function SupportDiagnosticsExport() {
  const dialogId = useId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<SupportBundle | null>(null);
  const [excludedFields, setExcludedFields] = useState<Set<SupportBundleFieldKey>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [supportReference, setSupportReference] = useState<string | null>(null);

  async function generate() {
    setError(null);
    setIsGenerating(true);
    try {
      const includeFields = OPTIONAL_SUPPORT_BUNDLE_FIELDS.filter(
        (field) => !excludedFields.has(field),
      );
      const next = await buildSupportBundle({ pathname: pathname ?? "/", includeFields });
      setBundle(next);
      setSupportReference(buildSupportReference(next.correlationId));
      setOpen(true);
    } catch {
      // buildSupportBundle is designed to never throw (health lookups are
      // best-effort), but guard anyway so a UI bug can't block the whole
      // support flow.
      setError("Could not generate diagnostics. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function toggleField(field: SupportBundleFieldKey) {
    const next = new Set(excludedFields);
    if (next.has(field)) {
      next.delete(field);
    } else {
      next.add(field);
    }
    setExcludedFields(next);

    // Re-generate immediately so the preview never shows a field the user
    // just excluded (or vice versa) — the JSON preview and the checkboxes
    // must never disagree about what will actually be exported.
    const includeFields = OPTIONAL_SUPPORT_BUNDLE_FIELDS.filter((f) => !next.has(f));
    const refreshed = await buildSupportBundle({ pathname: pathname ?? "/", includeFields });
    setBundle(refreshed);
  }

  function cancel() {
    setOpen(false);
    setBundle(null);
    setSupportReference(null);
  }

  async function copy() {
    if (!bundle) return;
    setError(null);
    try {
      await copyTextToClipboard(JSON.stringify(bundle, null, 2));
      setStatus("Copied to clipboard.");
      setOpen(false);
    } catch {
      setError("Clipboard copy was blocked. You can retry or download the file instead.");
    }
  }

  function download() {
    if (!bundle) return;
    setError(null);
    try {
      downloadJson(bundle);
      setStatus("Download started.");
      setOpen(false);
    } catch {
      setError("Download failed. Check browser permissions and try again.");
    }
  }

  return (
    <div className="grid gap-2">
      <button
        className="h-10 w-fit rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
        onClick={() => void generate()}
        disabled={isGenerating}
        type="button"
      >
        {isGenerating ? "Generating..." : "Export support diagnostics"}
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

      {open && bundle ? (
        <div
          aria-labelledby={dialogId}
          aria-modal="true"
          className="rounded-lg border border-cyan-300/50 bg-slate-950 p-4"
          role="dialog"
        >
          <h3 className="text-sm font-semibold text-white" id={dialogId}>
            Review diagnostics before sharing
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            This bundle contains no credentials, tokens, wallet addresses, or proof IDs.
          </p>

          <dl className="mt-3 grid gap-2 text-xs text-slate-300">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">App version</dt>
              <dd className="font-mono text-white">{bundle.appVersion}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Route</dt>
              <dd className="font-mono text-white">{bundle.route}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Request ID</dt>
              <dd className="font-mono text-white">{bundle.correlationId}</dd>
            </div>
            {supportReference ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Support reference</dt>
                <dd className="font-mono text-white">{supportReference}</dd>
              </div>
            ) : null}
          </dl>

          <fieldset className="mt-3 grid gap-2 rounded-md border border-white/10 p-3">
            <legend className="px-1 text-xs font-semibold uppercase text-slate-400">
              Optional fields
            </legend>
            {OPTIONAL_SUPPORT_BUNDLE_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={!excludedFields.has(field)}
                  onChange={() => void toggleField(field)}
                  className="h-4 w-4 border-white/20 text-cyan-300"
                />
                {field === "features" ? "Browser feature support" : "Service health status"}
              </label>
            ))}
          </fieldset>

          <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs text-slate-300">
            {JSON.stringify(bundle, null, 2)}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950"
              onClick={() => void copy()}
              type="button"
            >
              Copy
            </button>
            <button
              className="h-9 rounded-md border border-white/15 px-4 text-xs font-semibold text-white"
              onClick={download}
              type="button"
            >
              Download
            </button>
            <button
              className="h-9 rounded-md px-4 text-xs font-semibold text-slate-300"
              onClick={cancel}
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
