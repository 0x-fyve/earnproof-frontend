"use client";

import { useCallback, useState } from "react";
import { revokeWebhookCertificate } from "@/lib/api/webhooks-certificates";
import type { CertificateMetadata } from "@/lib/validation/webhooks-certificates";

export function CertificateRevocationModal({
  certificate,
  token,
  webhookId,
  isActing,
  onConfirm,
  onCancel,
  onError,
}: {
  certificate: CertificateMetadata;
  token: string;
  webhookId: string;
  isActing: boolean;
  onConfirm: (certificateId: string) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const handleRevoke = useCallback(async () => {
    setError(null);
    setIsRevoking(true);

    try {
      const controller = new AbortController();
      await revokeWebhookCertificate(token, webhookId, certificate.id, controller.signal);
      onConfirm(certificate.id);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to revoke certificate. Please try again.";
      setError(message);
      onError(message);
    } finally {
      setIsRevoking(false);
    }
  }, [token, webhookId, certificate.id, onConfirm, onError]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revocation-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="rounded-lg border border-rose-300/30 bg-slate-950 p-6 max-w-md shadow-lg">
        <h2 id="revocation-modal-title" className="text-lg font-semibold text-white mb-2">
          Revoke Certificate
        </h2>

        <p className="text-sm text-slate-300 mb-4">
          You are about to revoke this certificate:
        </p>

        {/* Certificate Details */}
        <div className="rounded bg-white/5 p-3 mb-4 text-xs font-mono text-slate-300 break-all">
          {certificate.fingerprint}
        </div>

        {/* Consequences */}
        <div className="rounded bg-rose-300/10 border border-rose-300/20 p-3 mb-4">
          <p className="text-sm font-semibold text-rose-200 mb-2">This action will:</p>
          <ul className="text-xs text-rose-200 space-y-1">
            <li className="flex gap-2">
              <span>•</span>
              <span>Immediately invalidate this certificate</span>
            </li>
            <li className="flex gap-2">
              <span>•</span>
              <span>Fail all webhook deliveries that use this certificate</span>
            </li>
            <li className="flex gap-2">
              <span>•</span>
              <span>Cannot be undone</span>
            </li>
          </ul>
        </div>

        {/* Error Display */}
        {error && (
          <div className="rounded bg-rose-300/10 border border-rose-300/20 p-3 mb-4">
            <p className="text-xs text-rose-200">{error}</p>
          </div>
        )}

        {/* Confirmation Checkbox */}
        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            id="revoke-confirm"
            disabled={isRevoking}
            className="mt-1 h-4 w-4"
          />
          <span className="text-xs text-slate-300">
            I understand that revoking this certificate will fail all webhook deliveries using it,
            and this action cannot be undone.
          </span>
        </label>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isRevoking}
            className="px-3 py-2 rounded-md border border-white/15 text-xs font-semibold text-white hover:bg-white/5 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={
              isRevoking ||
              !((document.getElementById("revoke-confirm") as HTMLInputElement)?.checked ?? false)
            }
            className="px-3 py-2 rounded-md bg-rose-300 text-xs font-semibold text-slate-950 hover:bg-rose-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRevoking ? "Revoking..." : "Revoke Certificate"}
          </button>
        </div>
      </div>
    </div>
  );
}
