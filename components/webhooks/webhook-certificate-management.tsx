"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listWebhookCertificates, type UploadCertificateResponse } from "@/lib/api/webhooks-certificates";
import type { CertificateMetadata } from "@/lib/validation/webhooks-certificates";
import { CertificateUploadForm } from "./certificate-upload-form";
import { CertificateList } from "./certificate-list";

export function WebhookCertificateManagement({
  token,
  webhookId,
  webhookUrl,
}: {
  token: string;
  webhookId: string;
  webhookUrl: string;
}) {
  const [certificates, setCertificates] = useState<CertificateMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadCertificates = useCallback(async () => {
    if (!token) {
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await listWebhookCertificates(token, webhookId, controller.signal);
      if (!controller.signal.aborted) {
        setCertificates(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const message =
          err instanceof Error ? err.message : "Failed to load certificates. Please try again.";
        setError(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [token, webhookId]);

  // Load certificates on mount
  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        void loadCertificates();
      }
    });

    // Cleanup on unmount
    return () => {
      active = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadCertificates]);

  const handleCertificateUploaded = useCallback((response: UploadCertificateResponse) => {
    setCertificates((prev) => [...prev, response.certificate]);
    if (response.validationWarnings && response.validationWarnings.length > 0) {
      setError(
        `Certificate uploaded with warnings: ${response.validationWarnings.join("; ")}`
      );
    }
  }, []);

  const handleCertificateRevoked = useCallback((certificateId: string) => {
    setCertificates((prev) =>
      prev.map((cert) =>
        cert.id === certificateId ? { ...cert, status: "REVOKED" } : cert
      )
    );
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  return (
    <div className="grid gap-8 sm:gap-10">
      {/* Error Display */}
      {error && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4">
          <p className="text-sm text-rose-200" role="alert">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-xs text-rose-300 hover:text-rose-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Upload Form */}
      <CertificateUploadForm
        token={token}
        webhookId={webhookId}
        webhookUrl={webhookUrl}
        onCertificateUploaded={handleCertificateUploaded}
      />

      {/* Certificate List */}
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Client Certificates</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Manage the mutual TLS certificates used by this webhook endpoint.
            </p>
          </div>
          <button
            className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
            disabled={loading}
            onClick={loadCertificates}
            type="button"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <CertificateList
          certificates={certificates}
          loading={loading}
          token={token}
          webhookId={webhookId}
          onCertificateRevoked={handleCertificateRevoked}
          onError={handleError}
        />
      </section>
    </div>
  );
}
