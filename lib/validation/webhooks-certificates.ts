import { z } from "zod";
import {
  MAX_CERTIFICATE_SIZE_BYTES,
  PRIVATE_KEY_PATTERNS,
  PEM_CERTIFICATE_PATTERN,
  CERTIFICATE_EXPIRY_WARNING_DAYS,
} from "@/lib/constants/certificates";
import {
  parseCertificateMetadata,
  validateCertificateHostname,
  isCertificateCurrentlyValid,
} from "@/lib/utils/certificate-parser";

/**
 * Validate that input does not contain private key blocks.
 * Detects and rejects common private key patterns.
 */
export function detectPrivateKeyBlock(input: string): boolean {
  return PRIVATE_KEY_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Validate PEM certificate structure.
 * Checks: format, size, not a private key.
 * Does NOT validate chain integrity or dates (delegated to server or async parser).
 */
export async function validateCertificatePEM(
  pemText: string,
  webhookUrl?: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors: string[] = [];

  // Trim
  const trimmed = pemText.trim();

  // Empty check
  if (!trimmed) {
    return { ok: false, errors: ["Certificate text is required"] };
  }

  // Private key detection
  if (detectPrivateKeyBlock(trimmed)) {
    return {
      ok: false,
      errors: [
        "Private key detected. Only public certificates are accepted.",
        "To use mTLS, upload the public certificate (PEM format).",
        "Never paste or upload private keys in the browser.",
      ],
    };
  }

  // Size check
  if (new TextEncoder().encode(trimmed).length > MAX_CERTIFICATE_SIZE_BYTES) {
    errors.push(
      `Certificate exceeds size limit of ${MAX_CERTIFICATE_SIZE_BYTES / 1024} KB`
    );
  }

  // PEM structure check
  if (!PEM_CERTIFICATE_PATTERN.test(trimmed)) {
    errors.push(
      "Invalid PEM format. Expected: -----BEGIN CERTIFICATE-----[newline][base64][newline]-----END CERTIFICATE-----"
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Parse and validate metadata
  try {
    const metadata = await parseCertificateMetadata(trimmed);

    // Check validity window
    if (!isCertificateCurrentlyValid(metadata.notBefore, metadata.notAfter)) {
      if (metadata.notBefore > new Date()) {
        errors.push(
          `Certificate is not yet valid. Valid from ${metadata.notBefore.toISOString()}`
        );
      }
      if (metadata.notAfter < new Date()) {
        errors.push(
          `Certificate has expired as of ${metadata.notAfter.toISOString()}. Renew with a valid certificate.`
        );
      }
    }

    // Check hostname if webhook URL provided
    if (webhookUrl) {
      if (!validateCertificateHostname(webhookUrl, metadata.sans, metadata.subject)) {
        errors.push(
          `Webhook hostname does not match certificate Subject Alternative Names (SANs). Certificate SANs: ${metadata.sans.join(", ")}`
        );
      }
    }

    // Check algorithm strength (weak algorithms)
    if (metadata.signatureAlgorithm.toUpperCase().includes("MD5")) {
      errors.push("Certificate uses MD5 signature algorithm. Must use SHA-256 or stronger.");
    }
    if (metadata.signatureAlgorithm.toUpperCase().includes("SHA1")) {
      errors.push("Certificate uses SHA-1 signature algorithm. Must use SHA-256 or stronger.");
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse certificate";
    return {
      ok: false,
      errors: [
        "Could not parse certificate metadata.",
        message,
        "Ensure the certificate is a valid X.509 certificate in PEM format.",
      ],
    };
  }
}

/**
 * Schema for certificate upload form.
 */
export const uploadCertificateSchema = z.object({
  certificate: z
    .string()
    .min(1, "Certificate is required")
    .refine((val) => !detectPrivateKeyBlock(val), {
      message:
        "Private key detected. Only public certificates are accepted. Never paste private keys in the browser.",
    })
    .refine(
      (val) => new TextEncoder().encode(val.trim()).length <= MAX_CERTIFICATE_SIZE_BYTES,
      {
        message: `Certificate exceeds size limit of ${MAX_CERTIFICATE_SIZE_BYTES / 1024} KB`,
      }
    )
    .refine((val) => PEM_CERTIFICATE_PATTERN.test(val.trim()), {
      message:
        "Invalid PEM format. Expected: -----BEGIN CERTIFICATE-----[newline][base64][newline]-----END CERTIFICATE-----",
    }),
});

export type UploadCertificateInput = z.infer<typeof uploadCertificateSchema>;

/**
 * Schema for certificate metadata returned from server or parser.
 */
export const certificateMetadataSchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  subject: z.string().describe("X.509 Distinguished Name"),
  issuer: z.string().describe("Issuer Distinguished Name"),
  serial: z.string().describe("Hex-encoded serial number"),
  fingerprint: z.string().describe("SHA-256 fingerprint (colon-separated hex)"),
  sans: z.array(z.string()).describe("Subject Alternative Names"),
  notBefore: z.coerce.date(),
  notAfter: z.coerce.date(),
  status: z.enum(["ACTIVE", "RETIRING", "EXPIRED", "REVOKED"]),
  rotationStartedAt: z.coerce.date().optional(),
  rotationExpiresAt: z.coerce.date().optional(),
  validationResult: z
    .object({
      ok: z.boolean(),
      errors: z.array(z.string()).optional(),
    })
    .optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CertificateMetadata = z.infer<typeof certificateMetadataSchema>;

/**
 * Schema for webhook with certificates.
 */
export const webhookWithCertificatesSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(z.string()),
  status: z.enum(["ACTIVE", "DISABLED"]),
  mtlsEnabled: z.boolean().optional().default(false),
  requiredClientCertificate: z.boolean().optional().default(false),
  certificates: z.array(certificateMetadataSchema).optional().default([]),
});

export type WebhookWithCertificates = z.infer<typeof webhookWithCertificatesSchema>;

/**
 * Format certificate metadata for display.
 */
export function formatCertificateMetadata(cert: CertificateMetadata): {
  displaySubject: string;
  displayIssuer: string;
  displayFingerprint: string;
  displaySans: string;
  displayValidity: string;
  validityDays: number;
} {
  const now = new Date();
  const expiryMs = cert.notAfter.getTime() - now.getTime();
  const validityDays = Math.ceil(expiryMs / (24 * 60 * 60 * 1000));

  return {
    displaySubject: cert.subject,
    displayIssuer: cert.issuer,
    displayFingerprint: cert.fingerprint,
    displaySans: cert.sans.join(", "),
    displayValidity: `${cert.notBefore.toLocaleDateString()} – ${cert.notAfter.toLocaleDateString()}`,
    validityDays,
  };
}

/**
 * Determine certificate validity state for UI display.
 */
export function getCertificateValidityState(
  status: string,
  notAfter: Date,
  warningDays: number = CERTIFICATE_EXPIRY_WARNING_DAYS
): "VALID" | "EXPIRING_SOON" | "EXPIRED" {
  if (status === "REVOKED" || status === "EXPIRED") {
    return "EXPIRED";
  }

  const now = new Date();
  if (now > notAfter) {
    return "EXPIRED";
  }

  const warningDate = new Date(notAfter.getTime() - warningDays * 24 * 60 * 60 * 1000);
  if (now >= warningDate) {
    return "EXPIRING_SOON";
  }

  return "VALID";
}

/**
 * Get accessibility label for certificate status icon.
 */
export function getCertificateStatusAriaLabel(
  status: "VALID" | "EXPIRING_SOON" | "EXPIRED",
  daysUntil: number
): string {
  switch (status) {
    case "VALID":
      return `Certificate is valid. Expires in ${daysUntil} days.`;
    case "EXPIRING_SOON":
      return `Certificate expiring soon. ${daysUntil} days remaining.`;
    case "EXPIRED":
      return "Certificate has expired or been revoked.";
  }
}
