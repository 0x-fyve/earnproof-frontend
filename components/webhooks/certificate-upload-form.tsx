"use client";

import { useCallback, useState } from "react";
import { uploadWebhookCertificate, type UploadCertificateResponse } from "@/lib/api/webhooks-certificates";
import {
  validateCertificatePEM,
  detectPrivateKeyBlock,
} from "@/lib/validation/webhooks-certificates";
import { MAX_CERTIFICATE_SIZE_BYTES } from "@/lib/constants/certificates";

export function CertificateUploadForm({
  token,
  webhookId,
  webhookUrl,
  onCertificateUploaded,
}: {
  token: string;
  webhookId: string;
  webhookUrl: string;
  onCertificateUploaded: (response: UploadCertificateResponse) => void;
}) {
  const [certificateText, setCertificateText] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Validate certificate on change
  const validateCertificate = useCallback(async (text: string) => {
    setIsValidating(true);
    setValidationErrors([]);

    // Quick private key check
    if (detectPrivateKeyBlock(text)) {
      setValidationErrors([
        "🔒 Private key detected and rejected.",
        "Only public certificates (PEM format) are accepted.",
        "Never paste private keys in the browser.",
      ]);
      setIsValidating(false);
      return;
    }

    if (!text.trim()) {
      setIsValidating(false);
      return;
    }

    // Async validation
    try {
      const result = await validateCertificatePEM(text, webhookUrl);
      if (!result.ok) {
        setValidationErrors(result.errors);
      } else {
        setValidationErrors([]);
      }
    } catch {
      setValidationErrors(["Failed to validate certificate. Check the format and try again."]);
    } finally {
      setIsValidating(false);
    }
  }, [webhookUrl]);

  const handleCertificateChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setCertificateText(text);
      void validateCertificate(text);
    },
    [validateCertificate]
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        setCertificateText(text);
        void validateCertificate(text);
      } catch {
        setValidationErrors(["Failed to read file. Ensure it is a valid text file."]);
      }
    },
    [validateCertificate]
  );

  const handleDrag = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type === "text/plain" || file.name.endsWith(".pem")) {
          void handleFileSelect(file);
        } else {
          setValidationErrors(["File must be a .pem certificate file."]);
        }
      }
    },
    [handleFileSelect]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!certificateText.trim()) {
        setValidationErrors(["Certificate is required"]);
        return;
      }

      if (validationErrors.length > 0) {
        setSubmitError("Please fix validation errors before submitting.");
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const controller = new AbortController();
        const response = await uploadWebhookCertificate(
          token,
          webhookId,
          certificateText,
          controller.signal
        );

        onCertificateUploaded(response);
        setCertificateText("");
        setValidationErrors([]);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to upload certificate. Please try again.";
        setSubmitError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [certificateText, validationErrors, token, webhookId, onCertificateUploaded]
  );

  const isValid = certificateText.trim() && validationErrors.length === 0;

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h3 className="text-lg font-semibold text-white">Upload Client Certificate</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Upload a public certificate (PEM format) to enable mutual TLS for this webhook endpoint.
          The certificate will be verified to match the webhook hostname and have a valid signature.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4">
        <div
          className={`rounded-lg border-2 border-dashed transition ${
            dragActive
              ? "border-cyan-300 bg-cyan-300/10"
              : "border-white/10 bg-slate-900/30 hover:border-white/20"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <label htmlFor="cert-file" className="block p-6 text-center cursor-pointer">
            <div className="text-sm text-slate-300">
              <p className="font-medium">Drag and drop a .pem file here</p>
              <p className="mt-1 text-xs text-slate-400">or click to select a file</p>
              <input
                id="cert-file"
                type="file"
                accept=".pem,.crt,.cer,text/plain"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    void handleFileSelect(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
            </div>
          </label>
        </div>

        <div>
          <label htmlFor="cert-text" className="block text-sm font-medium text-slate-200">
            Or paste certificate text
          </label>
          <textarea
            id="cert-text"
            value={certificateText}
            onChange={handleCertificateChange}
            placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDXTCCAkWgAwIBAgIJAL...&#10;-----END CERTIFICATE-----"
            className={`mt-1 min-h-40 w-full rounded-md border px-4 py-3 font-mono text-sm text-white placeholder:text-slate-500 ${
              validationErrors.length > 0
                ? "border-rose-500 bg-rose-900/20"
                : isValid
                  ? "border-emerald-500/50 bg-emerald-900/10"
                  : "border-white/10 bg-slate-900"
            }`}
            disabled={isSubmitting || isValidating}
          />
          <p className="mt-1 text-xs text-slate-400">
            Maximum size: {MAX_CERTIFICATE_SIZE_BYTES / 1024} KB
          </p>
        </div>

        {validationErrors.length > 0 && (
          <div
            className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3"
            role="alert"
            aria-live="polite"
          >
            <p className="text-xs font-semibold text-rose-200 mb-2">Validation Errors:</p>
            <ul className="text-xs text-rose-200 space-y-1">
              {validationErrors.map((error, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-rose-400">•</span>
                  <span>{error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {submitError && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3" role="alert">
            <p className="text-sm text-rose-200">{submitError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={!isValid || isSubmitting || isValidating}
          className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-cyan-200 transition"
          aria-busy={isSubmitting || isValidating}
        >
          {isValidating ? "Validating..." : isSubmitting ? "Uploading..." : "Upload Certificate"}
        </button>
      </form>
    </section>
  );
}
