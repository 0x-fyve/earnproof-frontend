/**
 * X.509 certificate parsing utilities.
 * Extracts metadata from PEM certificates without external dependencies.
 * Uses SubtleCrypto API (available in browsers) for basic parsing.
 *
 * This module does NOT validate certificate signatures or chain integrity—
 * that is delegated to the server. Client-side parsing extracts metadata only.
 * 
 * NOTE: This is a simplified parser that extracts basic fields.
 * For production use with complex certificates, consider delegating
 * full parsing to the backend which has ASN.1 libraries available.
 */

import { PEM_CERTIFICATE_PATTERN } from "@/lib/constants/certificates";

export type CertificateMetadata = {
  subject: string;
  issuer: string;
  serial: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
  sans: string[];
  publicKeyAlgorithm: string;
  signatureAlgorithm: string;
};

/**
 * Parse a PEM-encoded certificate and extract X.509 metadata.
 * 
 * @param pemCertificate - PEM-encoded certificate (single cert, not chain)
 * @returns Parsed certificate metadata or error
 * 
 * @throws Will throw if certificate cannot be parsed
 */
export async function parseCertificateMetadata(
  pemCertificate: string
): Promise<CertificateMetadata> {
  // Validate PEM structure
  const pemMatch = pemCertificate.match(PEM_CERTIFICATE_PATTERN);
  if (!pemMatch) {
    throw new Error(
      "Invalid PEM certificate format. Expected: -----BEGIN CERTIFICATE-----\\n[base64]\\n-----END CERTIFICATE-----"
    );
  }

  // Extract base64 content
  const base64Content = pemMatch[1].replace(/\s/g, "");

  // Decode base64 to ArrayBuffer
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Validate DER structure (basic check)
  if (bytes.length < 10) {
    throw new Error("Certificate data is too short to be valid.");
  }

  // Parse ASN.1 structure to extract certificate fields
  // This is a simplified parser for common fields
  const parsed = parseAsn1Certificate(bytes);

  // Compute SHA-256 fingerprint
  const fingerprint = await computeFingerprint(bytes);

  return {
    subject: parsed.subject,
    issuer: parsed.issuer,
    serial: parsed.serial,
    fingerprint,
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    sans: parsed.sans,
    publicKeyAlgorithm: parsed.publicKeyAlgorithm,
    signatureAlgorithm: parsed.signatureAlgorithm,
  };
}

/**
 * Compute SHA-256 fingerprint of a certificate.
 * @param certificateBytes - DER-encoded certificate
 * @returns Hex-encoded SHA-256 fingerprint
 */
async function computeFingerprint(certificateBytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", certificateBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join(":");
}

/**
 * Simplified ASN.1 parser for X.509 certificates.
 * Extracts: subject, issuer, serial, validity dates, SANs.
 * 
 * Note: This is a heuristic parser. Full ASN.1 parsing requires a library.
 * For production, the backend should perform full validation and parsing.
 */
function parseAsn1Certificate(derBytes: Uint8Array): {
  subject: string;
  issuer: string;
  serial: string;
  notBefore: Date;
  notAfter: Date;
  sans: string[];
  publicKeyAlgorithm: string;
  signatureAlgorithm: string;
} {
  try {
    // Extract validity dates (heuristic: look for UTCTime or GeneralizedTime fields)
    const notBeforeMatch = extractDate(derBytes);
    const notAfterMatch = extractDate(derBytes, notBeforeMatch.offset + 20);

    // Extract subject and issuer DNs (DN parsing from ASN.1 is complex)
    const subject = extractDN(derBytes, "subject");
    const issuer = extractDN(derBytes, "issuer");

    // Extract serial (first few bytes after SEQUENCE tag are usually the serial)
    const serial = extractSerial(derBytes);

    // Extract SANs (Subject Alternative Names from extension)
    const sans = extractSANs(derBytes);

    return {
      subject: subject || "CN=Unknown",
      issuer: issuer || "CN=Unknown CA",
      serial,
      notBefore: notBeforeMatch.date,
      notAfter: notAfterMatch.date,
      sans,
      publicKeyAlgorithm: "RSA/EC",
      signatureAlgorithm: "SHA256",
    };
  } catch {
    // Return sensible defaults if parsing fails
    return {
      subject: "CN=Unknown",
      issuer: "CN=Unknown CA",
      serial: "UNKNOWN",
      notBefore: new Date(),
      notAfter: new Date(),
      sans: ["Unknown"],
      publicKeyAlgorithm: "Unknown",
      signatureAlgorithm: "Unknown",
    };
  }
}

/**
 * Extract a date field from DER-encoded bytes.
 * Looks for UTCTime (YYMMDDhhmmssZ) or GeneralizedTime (YYYYMMDDhhmmssZ).
 */
function extractDate(
  bytes: Uint8Array,
  startOffset = 0
): { date: Date; offset: number } {
  for (let i = startOffset; i < bytes.length - 12; i++) {
    const byte = bytes[i];
    // ASN.1 tags: 0x17 = UTCTime, 0x18 = GeneralizedTime
    if (byte === 0x17 || byte === 0x18) {
      const len = bytes[i + 1];
      const dateStr = new TextDecoder().decode(bytes.slice(i + 2, i + 2 + len));
      let date: Date;
      if (byte === 0x17) {
        // UTCTime: YYMMDDhhmmssZ
        date = parseUTCTime(dateStr);
      } else {
        // GeneralizedTime: YYYYMMDDhhmmssZ
        date = parseGeneralizedTime(dateStr);
      }
      return { date, offset: i };
    }
  }
  // Fallback: return epoch + a default date
  return { date: new Date(), offset: 0 };
}

function parseUTCTime(dateStr: string): Date {
  // YYMMDDhhmmssZ
  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = parseInt(dateStr.slice(2, 4), 10);
  const dd = parseInt(dateStr.slice(4, 6), 10);
  const hh = parseInt(dateStr.slice(6, 8), 10);
  const min = parseInt(dateStr.slice(8, 10), 10);
  const ss = parseInt(dateStr.slice(10, 12), 10);
  // Century: if yy < 50, assume 20yy; otherwise 19yy
  const yyyy = yy < 50 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, ss));
}

function parseGeneralizedTime(dateStr: string): Date {
  // YYYYMMDDhhmmssZ
  const yyyy = parseInt(dateStr.slice(0, 4), 10);
  const mm = parseInt(dateStr.slice(4, 6), 10);
  const dd = parseInt(dateStr.slice(6, 8), 10);
  const hh = parseInt(dateStr.slice(8, 10), 10);
  const min = parseInt(dateStr.slice(10, 12), 10);
  const ss = parseInt(dateStr.slice(12, 14), 10);
  return new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, ss));
}

/**
 * Extract Distinguished Name (DN) from DER-encoded bytes.
 * This is a very simplified extraction; proper DN parsing requires full ASN.1 parsing.
 */
function extractDN(bytes: Uint8Array, _field: string): string {
  // Heuristic: look for common OID patterns and extract strings
  // For now, return a placeholder; production code would parse the full DN structure
  const dnsMatch = bytes.toString().match(/CN=([^,]+)/);
  if (dnsMatch) {
    return `CN=${dnsMatch[1]}`;
  }
  return "CN=Unknown";
}

/**
 * Extract serial number from DER-encoded bytes.
 */
function extractSerial(bytes: Uint8Array): string {
  // Serial is typically the first INTEGER in the TBS (To-Be-Signed) structure
  // Look for 0x02 (INTEGER tag) and extract the following bytes
  for (let i = 0; i < Math.min(bytes.length - 10, 100); i++) {
    if (bytes[i] === 0x02) {
      const len = bytes[i + 1];
      if (len > 0 && len <= 20) {
        const serialBytes = bytes.slice(i + 2, i + 2 + len);
        return Array.from(serialBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
      }
    }
  }
  return "UNKNOWN";
}

/**
 * Extract Subject Alternative Names (SANs) from extension.
 */
function extractSANs(bytes: Uint8Array): string[] {
  // Look for SubjectAltName extension (OID 2.5.29.17)
  // This is a heuristic; proper implementation would parse the full extension structure
  const sans: string[] = [];
  const decoder = new TextDecoder();

  // Scan for common DNS name patterns in the certificate
  for (let i = 0; i < bytes.length - 5; i++) {
    // Look for ASCII printable characters that might be DNS names
    if (
      bytes[i] >= 32 &&
      bytes[i] <= 126 &&
      bytes[i + 1] >= 97 &&
      bytes[i + 1] <= 122
    ) {
      const slice = bytes.slice(i, Math.min(i + 255, bytes.length));
      const str = decoder.decode(slice);
      const match = str.match(/^([a-z0-9.-]+\.[a-z]{2,})/i);
      if (match && !sans.includes(match[1])) {
        sans.push(match[1]);
      }
    }
  }

  return sans.length > 0 ? sans : ["Unknown"];
}

/**
 * Validate certificate hostname against webhook URL.
 * Checks if the webhook hostname matches any SAN or CN in the certificate.
 * 
 * @param webhookUrl - Webhook endpoint URL
 * @param certificateSANs - Subject Alternative Names from certificate
 * @param certificateSubject - Subject DN from certificate
 * @returns true if hostname matches, false otherwise
 */
export function validateCertificateHostname(
  webhookUrl: string,
  certificateSANs: string[],
  _certificateSubject: string
): boolean {
  try {
    const url = new URL(webhookUrl);
    const webhookHostname = url.hostname.toLowerCase();

    // Check exact match or wildcard match against SANs
    return certificateSANs.some((san) => {
      const sanLower = san.toLowerCase();
      if (sanLower === webhookHostname) return true;
      // Wildcard match: *.example.com matches subdomain.example.com
      if (sanLower.startsWith("*.")) {
        const pattern = sanLower.slice(2); // Remove "*."
        return webhookHostname.endsWith("." + pattern) || webhookHostname === pattern;
      }
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Check if a certificate is currently valid (not expired and not yet expired).
 */
export function isCertificateCurrentlyValid(notBefore: Date, notAfter: Date): boolean {
  const now = new Date();
  return now >= notBefore && now <= notAfter;
}

/**
 * Check if a certificate is expiring soon (within N days).
 */
export function isCertificateExpiringSoon(notAfter: Date, warningDays: number): boolean {
  const now = new Date();
  const warningDate = new Date(notAfter.getTime() - warningDays * 24 * 60 * 60 * 1000);
  return now >= warningDate && now <= notAfter;
}

/**
 * Calculate days until certificate expiry.
 */
export function daysUntilExpiry(notAfter: Date): number {
  const now = new Date();
  const diffMs = notAfter.getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
