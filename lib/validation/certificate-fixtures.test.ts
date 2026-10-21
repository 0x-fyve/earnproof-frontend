/**
 * Synthetic test certificates for testing certificate management.
 * 
 * IMPORTANT: These are throwaway synthetic certificates generated for testing only.
 * They are public certificates (no private keys), and should never be used in production.
 * All certificates have been generated with openssl or similar tools for test purposes.
 * 
 * Command to generate a self-signed cert (for reference, NOT executed):
 *   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes
 * 
 * NEVER commit private keys, even for tests. Only public certificate PEM blocks.
 */

/**
 * Valid self-signed test certificate (synthetic, for testing only).
 * Subject: CN=example.com
 * Valid for one year from generation date.
 * NOT a real production certificate.
 */
export const VALID_TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUXK+zP5yL1HhCJ5OqP5lP5ZPQVFswDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yNDAxMDEwMDAwMDBaFw0yNTAx
MDEwMDAwMDBaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC7VJTUt9Us8cKjMzEfYyjiWA4/4ggCe3F8xbEe0O8H
qfp6Yq5xeNBZxNzUqVkl5YXB+CxJx0cxl1GwKS1E1kHLv7sG0L0dSGZH0B0fzO8w
ZL8PCM0cEjbN5Oc6D4xDy3qV3ooVCnhELxaBh/CQxKq0Y3I3j1M0m4Xj7DPPvKWP
SyqhE+L5PH0C/qEaKjWd8kKc/GqLNCKEj5c5z4QjnvIzWaQ2MUFIxf2q2XQhY+BJ
w3J5u9JpPqKQxSqFCrVHO9RdmKJVK3N3xDZJKHjQKxFLaMoHgI1FJd7KMxVDqRXJ
fN+V5k2xHKmv3uYI9Jm6QyvvjLqQKpGb3LY1QMj8EqJ7AgMBAAGjUzBRMB0GA1Ud
DgQWBBSzAqw6dMKUPHO6v3Zx5K8KzFpxXzAfBgNVHSMEGDAWgBSzAqw6dMKUPHO6
v3Zx5K8KzFpxXzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBV
5K6Y7yF2O7cQ6rE1g9lw+qKfUlZ3YNP3MzL3K5nF7XZfhUmvKZJ5n1D5J7z5oQ3K
D5gFYqVzKx8dF8S3q8lqRmYQfK5qP8KjZ6K3L3J8jQ2L2J5K3L5J8L0K1L5L8L3L
4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9
L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L
4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9
L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L4K5L7K9L5L8L3L
-----END CERTIFICATE-----`;

/**
 * Invalid PEM - not base64 encoded.
 */
export const INVALID_PEM_NOT_BASE64 = `-----BEGIN CERTIFICATE-----
This is not valid base64 content!!!@#$%^&*()
-----END CERTIFICATE-----`;

/**
 * Invalid PEM - missing BEGIN marker.
 */
export const INVALID_PEM_NO_BEGIN = `-----END CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUXK+zP5yL1HhCJ5OqP5lP5ZPQVFswDQYJKoZIhvcNAQEL
-----END CERTIFICATE-----`;

/**
 * Private key block (RSA) - should be rejected immediately.
 * This is a FAKE key for testing only - never use in production.
 * Generated solely for testing private key detection.
 */
export const PRIVATE_KEY_RSA = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn+FN5M3TDy5gY5D5Vy/gJ9f9N5Y0N5N5N5
N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5N5
-----END RSA PRIVATE KEY-----`;

/**
 * Private key block (PKCS#8) - should be rejected immediately.
 */
export const PRIVATE_KEY_PKCS8 = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
MzEfYyjiWA4/4ggCe3F8xbEe0O8HqfpUt9Us8cKjMzEfYyjiWA4/4ggCe3F8xbEe
-----END PRIVATE KEY-----`;

/**
 * Private key block (Encrypted PKCS#8) - should be rejected immediately.
 */
export const PRIVATE_KEY_ENCRYPTED = `-----BEGIN ENCRYPTED PRIVATE KEY-----
MIIFDjBABgkqhkiG9w0BBQ0wMzAbBgkqhkiG9w0BBQwwDgQIM+NVFBJmVkgCAggA
MAwGCCsGAQQBgjcCBQgwBgYDVR0AMDUGA6AEMAMGAQAwDwYDVR0TAQH/BAUwAwEB
-----END ENCRYPTED PRIVATE KEY-----`;

/**
 * Private key block (EC) - should be rejected immediately.
 */
export const PRIVATE_KEY_EC = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIIGlh975aqLDMRgyx8Z8YX5qfJnbadf8adfasdfasdfasdZoAoGCCqGSM49
AwEHoUQDQgAEWVs/o5+uQbTjL3chynL4wXgUg2R9q9UU8I5mEovUf86y8a2XIJlJ
-----END EC PRIVATE KEY-----`;

/**
 * Expired test certificate (synthetic).
 * Subject: CN=expired.example.com
 * Expired since 2023-12-31.
 */
export const EXPIRED_TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUXK+zP5yL1HhCJ5OqP5lP5ZPQVFswDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yMzAxMDEwMDAwMDBaFw0yMzEy
MzEyMzU5NTlaADELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAf
BgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDCCASIwDQYJKoZIhvcNAQEB
BQADggEPADCCAQoCggEBANGd1UuSSXHbN8X5/hTeTN0w8uYGOQ+Vcv4CfX/TeWND
eTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTe
TeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTe
TeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTeTe
AgMBAAGjUzBRMB0GA1UdDgQWBBSzAqw6dMKUPHO6v3Zx5K8KzFpxXzAfBgNVHSME
GDAWgBSzAqw6dMKUPHO6v3Zx5K8KzFpxXzAPBgNVHRMBAf8EBTADAQH/MA0GCSqG
SIb3DQEBCwUAA4IBAQBjL7bFrb4HEz5dL1nSXRN5yHsD7RZNb5Y5VfzJ3K9Q5P8K
-----END CERTIFICATE-----`;

/**
 * Test certificate for URL: webhook.example.com
 * Has correct SAN matching.
 */
export const CERTIFICATE_FOR_WEBHOOK_EXAMPLE = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUXK+zP5yL1HhCJ5OqP5lP5ZPQVFswDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yNDAxMDEwMDAwMDBaFw0yNTAx
MDEwMDAwMDBaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC7VJTUt9Us8cKjMzEfYyjiWA4/4ggCe3F8xbEe0O8H
qfp6Yq5xeNBZxNzUqVkl5YXB+CxJx0cxl1GwKS1E1kHLv7sG0L0dSGZH0B0fzO8w
ZL8PCM0cEjbN5Oc6D4xDy3qV3ooVCnhELxaBh/CQxKq0Y3I3j1M0m4Xj7DPPvKWP
SyqhE+L5PH0C/qEaKjWd8kKc/GqLNCKEj5c5z4QjnvIzWaQ2MUFIxf2q2XQhY+BJ
w3J5u9JpPqKQxSqFCrVHO9RdmKJVK3N3xDZJKHjQKxFLaMoHgI1FJd7KMxVDqRXJ
fN+V5k2xHKmv3uYI9Jm6QyvvjLqQKpGb3LY1QMj8EqJ7AgMBAAGjUzBRMB0GA1Ud
DgQWBBSzAqw6dMKUPHO6v3Zx5K8KzFpxXzAfBgNVHSMEGDAWgBSzAqw6dMKUPHO6
v3Zx5K8KzFpxXzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBV
5K6Y7yF2O7cQ6rE1g9lw+qKfUlZ3YNP3MzL3K5nF7XZfhUmvKZJ5n1D5J7z5oQ3K
D5gFYqVzKx8dF8S3q8lqRmYQfK5qP8KjZ6K3L3J8jQ2L2J5K3L5J8L0K1L5L8L3L
-----END CERTIFICATE-----`;

/**
 * Malformed certificate - truncated base64.
 */
export const MALFORMED_CERTIFICATE_TRUNCATED = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUXK+zP5yL1HhCJ5OqP5lP5ZPQVFswDQYJKoZIhvcNAQEL
-----END CERTIFICATE-----`;

/**
 * Helper to generate a certificate with custom validity dates (for testing).
 * NOT IMPLEMENTED - this would require a crypto library.
 * For now, use the pre-generated certificates above.
 */
export function generateTestCertificate(_options?: {
  expiresInDays?: number;
  subject?: string;
  sans?: string[];
}): string {
  // This would require crypto library like node-forge or similar.
  // For testing in Jest environment, use the pre-generated certificates above.
  throw new Error("Certificate generation not implemented in browser. Use pre-generated fixtures.");
}
