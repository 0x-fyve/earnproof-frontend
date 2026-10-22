/**
 * Named constants for webhook mTLS certificate management.
 * These define boundaries, limits, and thresholds to be enforced
 * across validation, UI, and state management.
 */

/**
 * Maximum size of a PEM certificate file (bytes).
 * Typical single certificate: 1–2 KB
 * Chain with intermediate + root: 2–4 KB
 * 8 KB provides safe headroom for future key sizes.
 */
export const MAX_CERTIFICATE_SIZE_BYTES = 8 * 1024; // 8 KB

/**
 * Maximum number of certificates that can be active concurrently on one webhook endpoint.
 * Typically 1, but during rotation 2 are allowed (current + new, until overlap window closes).
 * After overlap window expires, old certificate must be retired.
 */
export const MAX_ACTIVE_CERTIFICATES_PER_ENDPOINT = 2;

/**
 * Number of days before certificate expiry to trigger warning state.
 * Used to calculate EXPIRING_SOON status and warn users to renew.
 */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

/**
 * Minimum overlap window for certificate rotation (milliseconds).
 * Must allow downstream systems time to rotate and update without gaps.
 */
export const MIN_ROTATION_OVERLAP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Maximum overlap window for certificate rotation (milliseconds).
 * Prevents indefinite co-existence of old and new certificates.
 * After this window, the old certificate must be auto-revoked or manually confirmed.
 */
export const MAX_ROTATION_OVERLAP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Cache TTL for stale-state detection (milliseconds).
 * If the certificate state on the server changes within this window,
 * a refresh is forced before allowing new actions (upload, rotate, revoke).
 */
export const STALE_STATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Regex pattern for validating PEM certificate structure.
 * Matches: -----BEGIN CERTIFICATE-----\n[base64]\n-----END CERTIFICATE-----
 * Does NOT parse or validate the contents; use X.509 parser for that.
 */
export const PEM_CERTIFICATE_PATTERN =
  /^-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)\s+-----END CERTIFICATE-----$/;

/**
 * Regex patterns for detecting private key blocks in pasted content.
 * Used to reject private keys immediately and warn the user.
 */
export const PRIVATE_KEY_PATTERNS = [
  /-----BEGIN PRIVATE KEY-----/i,
  /-----BEGIN ENCRYPTED PRIVATE KEY-----/i,
  /-----BEGIN RSA PRIVATE KEY-----/i,
  /-----BEGIN EC PRIVATE KEY-----/i,
  /-----BEGIN DSA PRIVATE KEY-----/i,
];

/**
 * Certificate status enum values for state machine.
 */
export const CERTIFICATE_STATUSES = {
  ACTIVE: "ACTIVE",
  RETIRING: "RETIRING",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
} as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[keyof typeof CERTIFICATE_STATUSES];

/**
 * Certificate validity states for UI display.
 */
export const CERTIFICATE_VALIDITY_STATES = {
  VALID: "VALID",
  EXPIRING_SOON: "EXPIRING_SOON",
  EXPIRED: "EXPIRED",
} as const;

export type CertificateValidityState = (typeof CERTIFICATE_VALIDITY_STATES)[keyof typeof CERTIFICATE_VALIDITY_STATES];
