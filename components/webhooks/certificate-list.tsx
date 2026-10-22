"use client";

import { useCallback, useState } from "react";
import type { CertificateMetadata } from "@/lib/validation/webhooks-certificates";
import {
  getCertificateValidityState,
  getCertificateStatusAriaLabel,
  formatCertificateMetadata,
} from "@/lib/validation/webhooks-certificates";
import { daysUntilExpiry } from "@/lib/utils/certificate-parser";
import { CERTIFICATE_EXPIRY_WARNING_DAYS } from "@/lib/constants/certificates";
import { CertificateRevocationModal } from "./certificate-revocation-modal";

export function CertificateList({
  certificates,
  loading,
  token,
  webhookId,
  onCertificateRevoked,
  onError,
}: {
  certificates: CertificateMetadata[];
  loading: boolean;
  token: string;
  webhookId: string;
  onCertificateRevoked: (certificateId: string) => void;
  onError: (error: string) => void;
}) {
  const [revokeConfirmCertId, setRevokeConfirmCertId] = useState<string | null>(null);
  const [revokeActing, setRevokeActing] = useState(false);

  const activeCerts = certificates.filter((c) => c.status === "ACTIVE");
  const retiringCerts = certificates.filter((c) => c.status === "RETIRING");

  const handleRevokeConfirm = useCallback(async (certificateId: string) => {
    setRevokeActing(true);
    try {
      // Call revocation through modal's handler
      // The modal will handle the API call and callback
      onCertificateRevoked(certificateId);
    } finally {
      setRevokeActing(false);
      setRevokeConfirmCertId(null);
    }
  }, [onCertificateRevoked]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-slate-400">Loading certificates...</p>
      </div>
    );
  }

  if (certificates.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-slate-400">
          No certificates uploaded yet. Upload a certificate to enable mTLS for this webhook.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6">
        {/* Active Certificates */}
        {activeCerts.length > 0 && (
          <div className="grid gap-4">
            <h3 className="text-sm font-semibold text-white">Active Certificates</h3>
            {activeCerts.map((cert) => (
              <CertificateCard
                key={cert.id}
                certificate={cert}
                token={token}
                webhookId={webhookId}
                onRevoke={() => setRevokeConfirmCertId(cert.id)}
                onError={onError}
              />
            ))}
          </div>
        )}

        {/* Retiring Certificates (in overlap window) */}
        {retiringCerts.length > 0 && (
          <div className="grid gap-4">
            <h3 className="text-sm font-semibold text-white">Retiring Certificates</h3>
            <p className="text-xs text-slate-400 -mt-2">
              These certificates are in the overlap window and will be automatically revoked on their expiry date.
            </p>
            {retiringCerts.map((cert) => (
              <CertificateCard
                key={cert.id}
                certificate={cert}
                token={token}
                webhookId={webhookId}
                onRevoke={() => setRevokeConfirmCertId(cert.id)}
                onError={onError}
              />
            ))}
          </div>
        )}
      </div>

      {/* Revocation Confirmation Modal */}
      {revokeConfirmCertId && (
        <CertificateRevocationModal
          certificate={certificates.find((c) => c.id === revokeConfirmCertId)!}
          token={token}
          webhookId={webhookId}
          isActing={revokeActing}
          onConfirm={handleRevokeConfirm}
          onCancel={() => setRevokeConfirmCertId(null)}
          onError={onError}
        />
      )}
    </>
  );
}

function CertificateCard({
  certificate,
  token: _token,
  webhookId: _webhookId,
  onRevoke,
  onError: _onError,
}: {
  certificate: CertificateMetadata;
  token: string;
  webhookId: string;
  onRevoke: () => void;
  onError: (error: string) => void;
}) {
  const validityState = getCertificateValidityState(
    certificate.status,
    certificate.notAfter,
    CERTIFICATE_EXPIRY_WARNING_DAYS
  );
  const daysUntil = daysUntilExpiry(certificate.notAfter);
  const ariaLabel = getCertificateStatusAriaLabel(validityState, daysUntil);

  const metadata = formatCertificateMetadata(certificate);

  const statusIcon =
    validityState === "EXPIRED"
      ? "❌"
      : validityState === "EXPIRING_SOON"
        ? "⚠️"
        : "✓";

  const statusColor =
    validityState === "EXPIRED"
      ? "text-rose-400"
      : validityState === "EXPIRING_SOON"
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Status & Fingerprint */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg" aria-label={ariaLabel}>
              {statusIcon}
            </span>
            <span className={`text-xs font-mono ${statusColor}`}>
              {metadata.displayFingerprint}
            </span>
          </div>

          {/* Certificate Details */}
          <div className="grid gap-2 text-xs">
            <div>
              <p className="text-slate-400">Subject</p>
              <p className="text-white break-all">{metadata.displaySubject}</p>
            </div>

            <div>
              <p className="text-slate-400">Issuer</p>
              <p className="text-white break-all">{metadata.displayIssuer}</p>
            </div>

            <div>
              <p className="text-slate-400">Subject Alternative Names</p>
              <p className="text-white break-all">{metadata.displaySans}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-slate-400">Valid From</p>
                <p className="text-white">{certificate.notBefore.toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-slate-400">Expires</p>
                <p className={`${statusColor} font-semibold`}>
                  {certificate.notAfter.toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* Status Badge */}
            <div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  certificate.status === "ACTIVE"
                    ? "bg-emerald-300/20 text-emerald-200"
                    : certificate.status === "RETIRING"
                      ? "bg-amber-300/20 text-amber-200"
                      : "bg-slate-400/20 text-slate-300"
                }`}
              >
                {certificate.status === "ACTIVE"
                  ? "Active"
                  : certificate.status === "RETIRING"
                    ? `Retiring (${daysUntil} days)`
                    : certificate.status}
              </span>
            </div>

            {/* Rotation Info */}
            {certificate.status === "RETIRING" && certificate.rotationExpiresAt && (
              <div className="mt-2 p-2 rounded bg-amber-300/10 border border-amber-300/20">
                <p className="text-amber-200 text-xs">
                  This certificate will be automatically revoked on{" "}
                  <span className="font-mono">
                    {new Date(certificate.rotationExpiresAt).toLocaleDateString()}
                  </span>
                  . You can complete the rotation earlier if needed.
                </p>
              </div>
            )}

            {/* Validation Errors */}
            {certificate.validationResult && !certificate.validationResult.ok && (
              <div className="mt-2 p-2 rounded bg-rose-300/10 border border-rose-300/20">
                <p className="text-rose-200 text-xs font-semibold mb-1">Validation Issues:</p>
                <ul className="text-rose-200 text-xs space-y-1">
                  {certificate.validationResult.errors?.map((err, idx) => (
                    <li key={idx} className="flex gap-1">
                      <span>•</span> <span>{err}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onRevoke}
            className="h-8 rounded-md border border-rose-300/30 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 transition"
            aria-label={`Revoke certificate ${metadata.displayFingerprint}`}
          >
            Revoke
          </button>
          <button
            type="button"
            className="h-8 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
            title="Download certificate (not implemented yet)"
            disabled
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
