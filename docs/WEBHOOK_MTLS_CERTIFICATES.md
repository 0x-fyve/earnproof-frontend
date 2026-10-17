# Webhook mTLS Certificate Management

This document describes the webhook mutual TLS (mTLS) certificate management feature implemented for GitHub issue #282.

## Overview

Webhook owners can now configure client certificate identities and rotate them without exposing private key material. The feature provides:

- **Certificate Upload**: Upload PEM-formatted public certificates with real-time client-side validation
- **Metadata Display**: View certificate details (subject, issuer, fingerprint, SANs, validity window)
- **Overlap Rotation**: Add a new certificate alongside an old one during a configured overlap window
- **Expiry Monitoring**: Clear visual states (valid, expiring soon, expired) with configurable warnings
- **Revocation**: Irreversible revocation with explicit user confirmation
- **Access Control**: Gated by developer role and webhook ownership

## Architecture

### Files & Structure

```
lib/
  api/
    webhooks-certificates.ts         # API client for certificate operations
  validation/
    webhooks-certificates.ts         # Certificate validation schemas & logic
    webhooks-certificates.test.ts    # Validation unit tests
    certificate-fixtures.test.ts     # Synthetic test certificates (public only)
  utils/
    certificate-parser.ts            # X.509 parsing utilities
  constants/
    certificates.ts                  # Named constants & limits

components/
  webhooks/
    certificate-upload-form.tsx      # Upload form with real-time validation
    certificate-list.tsx             # Display active & retiring certificates
    certificate-revocation-modal.tsx # Confirm & revoke
    webhook-certificate-management.tsx # Container orchestrating all

docs/
  WEBHOOK_MTLS_CERTIFICATES.md       # This file
```

### Key Constants

- **MAX_CERTIFICATE_SIZE_BYTES**: 8 KB
- **MAX_ACTIVE_CERTIFICATES_PER_ENDPOINT**: 2 (during rotation)
- **CERTIFICATE_EXPIRY_WARNING_DAYS**: 30
- **MIN_ROTATION_OVERLAP_WINDOW_MS**: 1 hour
- **MAX_ROTATION_OVERLAP_WINDOW_MS**: 90 days

See `lib/constants/certificates.ts` for all constants.

## Data Model

### Certificate Status States

```typescript
type CertificateStatus = "ACTIVE" | "RETIRING" | "EXPIRED" | "REVOKED";

// ACTIVE: Certificate is currently valid and in use
// RETIRING: Certificate is valid but will be revoked when overlap window expires
// EXPIRED: Certificate has reached its notAfter date
// REVOKED: Certificate was explicitly revoked by the user
```

### Certificate Validity States (UI Display)

```typescript
type CertificateValidityState = "VALID" | "EXPIRING_SOON" | "EXPIRED";

// VALID: Certificate is good for > 30 days
// EXPIRING_SOON: Certificate expires within 30 days
// EXPIRED: Certificate is expired or revoked
```

### WebhookCertificate

```typescript
type WebhookCertificate = {
  id: string;
  webhookId: string;
  subject: string;           // X.509 Distinguished Name
  issuer: string;            // CA distinguished name
  serial: string;            // Hex-encoded serial
  fingerprint: string;       // SHA-256 (colon-separated hex)
  sans: string[];            // Subject Alternative Names
  notBefore: Date;           // Validity start
  notAfter: Date;            // Validity end
  status: CertificateStatus;
  rotationStartedAt?: Date;
  rotationExpiresAt?: Date;  // Auto-retire date for RETIRING certs
  validationResult?: {
    ok: boolean;
    errors?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
};
```

## Validation Strategy

### Client-Side (Fail Closed)

1. **Private Key Detection**: Blocks and clears input if private key markers are detected
   - Patterns: `-----BEGIN PRIVATE KEY-----`, `-----BEGIN ENCRYPTED PRIVATE KEY-----`, etc.
   - User is warned and input is cleared

2. **PEM Structure**: Validates strict PEM format
   - Must match: `-----BEGIN CERTIFICATE-----\n[base64]\n-----END CERTIFICATE-----`

3. **Size Limit**: Rejects certificates > 8 KB

4. **X.509 Parsing**: Uses browser SubtleCrypto or heuristic ASN.1 parsing
   - Extracts subject, issuer, serial, fingerprint, SANs, validity dates

5. **Hostname Matching**: Verifies webhook URL hostname matches a SAN
   - Supports wildcard SANs (e.g., `*.example.com`)

6. **Validity Window**: Ensures certificate is not expired or not-yet-valid

7. **Algorithm Strength**: Rejects weak algorithms (MD5, SHA-1)

### Server-Side

- Validates full X.509 chain integrity
- Confirms hostname match against webhook URL
- Validates signature algorithms and key strength
- Returns validation errors for display

## API Contract

### GET /webhooks/{webhookId}/certificates

Fetch all certificates for a webhook.

**Response (200):**
```json
{
  "certificates": [
    {
      "id": "cert_xyz",
      "webhookId": "webhook_abc",
      "subject": "CN=example.com",
      "issuer": "CN=My CA",
      "serial": "01a2b3c4d5e6f7",
      "fingerprint": "aa:bb:cc:...",
      "sans": ["example.com", "*.example.com"],
      "notBefore": "2024-01-01T00:00:00Z",
      "notAfter": "2025-01-01T00:00:00Z",
      "status": "ACTIVE",
      "rotationExpiresAt": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### POST /webhooks/{webhookId}/certificates

Upload a new certificate.

**Request (multipart/form-data):**
- `certificate`: PEM file or text

**Response (201):**
```json
{
  "certificate": { /* as above */ },
  "validationWarnings": []
}
```

**Errors (400):**
```json
{
  "errors": [
    "Private key detected: upload rejected",
    "Certificate expired as of 2024-12-31",
    "Hostname 'example.com' not found in SANs"
  ]
}
```

**Errors (409):**
```json
{
  "error": "Maximum active certificates (2) reached. Retire or revoke an existing certificate first."
}
```

### POST /webhooks/{webhookId}/certificates/{certId}/revoke

Revoke a certificate.

**Request:** `{}`

**Response (200):**
```json
{
  "certificate": {
    "id": "cert_xyz",
    "status": "REVOKED",
    "updatedAt": "2024-01-31T12:00:00Z"
  }
}
```

**Errors (409):**
```json
{
  "error": "Cannot revoke last active certificate. Disable mTLS first."
}
```

### POST /webhooks/{webhookId}/certificates/{certId}/complete-rotation

Complete a rotation by immediately revoking the RETIRING certificate.

**Request:** `{}`

**Response (200):**
```json
{
  "certificate": {
    "id": "cert_xyz",
    "status": "REVOKED",
    "updatedAt": "2024-01-31T12:00:00Z"
  }
}
```

## Usage

### Upload a Certificate

1. Navigate to webhook certificate management page
2. Upload a PEM certificate (file or paste)
3. Client-side validation provides real-time feedback
4. If valid, click "Upload Certificate"
5. Certificate metadata is displayed upon success

### Rotate a Certificate

1. Upload a new certificate (first upload will have ACTIVE status)
2. Old certificate transitions to RETIRING status
3. Both certificates are active during the overlap window
4. Old certificate auto-revokes when overlap window expires
5. Or manually click "Complete Rotation" to revoke earlier

### Revoke a Certificate

1. Click "Revoke" on a certificate
2. Modal shows explicit consequence: "Deliveries using this certificate will fail"
3. Confirmation checkbox must be checked
4. Click "Revoke Certificate" to confirm (irreversible)
5. Certificate status changes to REVOKED

## Private Key Security

**IMPORTANT**: Private keys are NEVER:

- Accepted in the browser (detected, cleared, warned)
- Rendered in the DOM
- Persisted in localStorage, sessionStorage, or IndexedDB
- Transmitted to the server
- Logged in console or telemetry
- Found in fixtures, test data, or repository

The browser accepts **only public certificates** (PEM format). Private keys are managed server-side.

### Detection Patterns

The following patterns are detected and immediately rejected:

```
-----BEGIN PRIVATE KEY-----
-----BEGIN ENCRYPTED PRIVATE KEY-----
-----BEGIN RSA PRIVATE KEY-----
-----BEGIN EC PRIVATE KEY-----
-----BEGIN DSA PRIVATE KEY-----
```

## Test Coverage

### Positive Tests

- ✓ Valid certificate upload with real-time validation feedback
- ✓ Certificate metadata display (subject, issuer, fingerprint, SANs)
- ✓ Expiry status rendering (valid, expiring-soon, expired)
- ✓ Overlap rotation: new cert uploaded, old becomes RETIRING
- ✓ Revocation with explicit modal confirmation
- ✓ Keyboard navigation and accessibility

### Negative Tests

- ✓ Private key detected and rejected (input cleared)
- ✓ Malformed PEM rejected with specific error
- ✓ Hostname mismatch rejected
- ✓ Expired certificate rejected
- ✓ Not-yet-valid certificate rejected
- ✓ Unsupported algorithm (MD5, SHA-1) rejected
- ✓ Oversized input (> 8 KB) rejected
- ✓ Empty input rejected

### Authorization Tests

- ✓ Non-developer users cannot upload/rotate/revoke
- ✓ Insufficient permissions show denied state

### Concurrency & Stale State

- ✓ Certificate list refresh forces re-fetch
- ✓ Certificate state changes between load and action

### Boundary Tests

- ✓ Expiry exactly at notAfter boundary
- ✓ Size limit at 8 KB (accepted) and 8.001 KB (rejected)
- ✓ Warning threshold at exactly 30 days

### Regression Tests

- ✓ No private key in state or storage
- ✓ No private key in network requests
- ✓ Invalid certificates always rejected (fail closed)
- ✓ Hostnames always verified

## Accessibility

- **Labeled Inputs**: All form fields have accessible labels
- **Keyboard Navigation**: Full keyboard support (Tab, Enter, Escape)
- **Focus Management**: Focus moved to errors after validation
- **Screen Readers**: aria-live announcements, aria-labels on icons
- **Color & Icons**: Expiry states use text + icons (not color alone)
- **Modal Focus Trap**: Focus trapped in confirmation modals

## Migration & Compatibility

### New Feature

- mTLS is **opt-in** per webhook endpoint
- Webhooks without mTLS continue working unchanged
- No migration required for existing webhooks

### Upgrade Path

1. Webhook owner enables mTLS
2. Uploads first certificate
3. Deliveries now require client certificate

### Downgrade Path

1. Owner revokes all certificates
2. Disables mTLS on the endpoint
3. Webhook returns to non-mTLS mode

## Troubleshooting

### "Private key detected" Warning

- **Cause**: Pasted or uploaded a private key
- **Solution**: Extract the public certificate instead
  - Option 1: `openssl x509 -in key.pem -pubkey -out cert.pem`
  - Option 2: Use certificate from your certificate provider
- **Prevention**: Only paste public certificates

### "Certificate has expired" Error

- **Cause**: Certificate's `notAfter` date is in the past
- **Solution**: Renew or upload a new certificate with future expiry

### "Hostname mismatch" Error

- **Cause**: Certificate's SANs don't include webhook hostname
- **Solution**: Obtain a certificate with the correct hostname in SANs
  - For `https://example.com/webhook`, certificate SANs must include `example.com`
  - Wildcard certificates (`*.example.com`) are supported

### "Maximum active certificates" Error

- **Cause**: Already 2 certificates (limit during rotation)
- **Solution**: Revoke or complete rotation of an existing certificate first

## Implementation Notes

### X.509 Parsing

Client-side parsing is simplified and focuses on common fields:

- Subject, issuer, serial, fingerprint, SANs, notBefore, notAfter
- Full ASN.1 parsing delegated to server
- Heuristic extraction of DNS names from certificate

**Note**: For complex certificate chains or non-standard extensions, parsing may require backend delegation or a dedicated ASN.1 library in the future.

### Fingerprint Format

SHA-256 fingerprints are displayed in colon-separated hex format:

```
aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99
```

This is the OpenSSL standard format for display.

### No External Dependencies

All certificate management uses:

- Browser SubtleCrypto API for hashing and fingerprinting
- Native ASN.1 heuristic parsing (no external ASN.1 library)
- React Hook Form for form handling
- Zod for validation schemas

This keeps the bundle size minimal and avoids dependency bloat.

## Future Enhancements

Potential improvements outside current scope:

1. **Chain Validation**: Full chain validation and intermediate certificate handling
2. **Certificate Download**: Allow users to download certificates for backup
3. **Auto-Renewal**: Integration with certificate providers for automatic renewal
4. **Audit Logging**: Full audit trail of certificate operations
5. **Batch Upload**: Support uploading certificate chains
6. **Hardware Tokens**: Support for certificates stored on HSMs or hardware tokens

## References

- **RFC 5280**: Internet X.509 PKI Certificate and CRL Profile
- **RFC 6125**: Representation and Verification of Domain-Based Application Service Identity
- **OpenSSL Documentation**: https://www.openssl.org/docs/
- **MDN SubtleCrypto**: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto

## Support

For issues or questions:

1. Check GitHub issue #282 for context
2. Review test cases in `certificate-upload-form.test.tsx`
3. See validation logic in `lib/validation/webhooks-certificates.ts`
4. Check API contract in this document
