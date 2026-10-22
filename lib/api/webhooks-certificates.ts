import { apiClient, bearer, retryRead, retryMutation } from "./client";
import type { CertificateMetadata } from "@/lib/validation/webhooks-certificates";

/**
 * Response from GET /webhooks/{webhookId}/certificates
 */
export type ListCertificatesResponse = {
  certificates: CertificateMetadata[];
};

/**
 * Response from POST /webhooks/{webhookId}/certificates
 */
export type UploadCertificateResponse = {
  certificate: CertificateMetadata;
  validationWarnings?: string[];
};

/**
 * Response from POST /webhooks/{webhookId}/certificates/{certId}/revoke
 */
export type RevokeCertificateResponse = {
  certificate: CertificateMetadata;
};

/**
 * Response from POST /webhooks/{webhookId}/certificates/{certId}/complete-rotation
 */
export type CompleteRotationResponse = {
  certificate: CertificateMetadata;
};

/**
 * Fetch all certificates for a webhook endpoint.
 */
export async function listWebhookCertificates(
  token: string,
  webhookId: string,
  signal: AbortSignal
): Promise<CertificateMetadata[]> {
  return retryRead(async (signal) => {
    const response = await apiClient<ListCertificatesResponse>({
      path: `/webhooks/${webhookId}/certificates`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
    return response.certificates;
  }, signal);
}

/**
 * Upload a certificate for a webhook endpoint.
 * The certificate must be a valid PEM public certificate.
 * Private keys are rejected by the server.
 *
 * @param token - Session token
 * @param webhookId - Webhook endpoint ID
 * @param certificatePEM - PEM-encoded certificate
 * @param signal - Abort signal
 * @returns Certificate metadata and any validation warnings
 */
export async function uploadWebhookCertificate(
  token: string,
  webhookId: string,
  certificatePEM: string,
  signal: AbortSignal
): Promise<UploadCertificateResponse> {
  return retryMutation(async (signal) => {
    // Create form data with certificate
    const formData = new FormData();
    formData.append("certificate", certificatePEM);

    return apiClient<UploadCertificateResponse>({
      path: `/webhooks/${webhookId}/certificates`,
      method: "POST",
      headers: bearer(token),
      body: formData,
      signal,
    });
  }, signal);
}

/**
 * Revoke a certificate on a webhook endpoint.
 * Revocation is irreversible. Deliveries using this certificate will fail after revocation.
 * 
 * Cannot revoke the last active certificate unless mTLS is disabled.
 *
 * @param token - Session token
 * @param webhookId - Webhook endpoint ID
 * @param certificateId - Certificate ID to revoke
 * @param signal - Abort signal
 * @returns Updated certificate metadata
 */
export async function revokeWebhookCertificate(
  token: string,
  webhookId: string,
  certificateId: string,
  signal: AbortSignal
): Promise<RevokeCertificateResponse> {
  return retryMutation(async (signal) => {
    return apiClient<RevokeCertificateResponse>({
      path: `/webhooks/${webhookId}/certificates/${certificateId}/revoke`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({}),
      signal,
    });
  }, signal);
}

/**
 * Complete a certificate rotation.
 * If a certificate is in RETIRING status, this action immediately revokes it.
 * Use this to manually end the overlap window before the automatic expiry.
 *
 * @param token - Session token
 * @param webhookId - Webhook endpoint ID
 * @param certificateId - Certificate ID in RETIRING status
 * @param signal - Abort signal
 * @returns Updated certificate metadata (now REVOKED)
 */
export async function completeWebhookCertificateRotation(
  token: string,
  webhookId: string,
  certificateId: string,
  signal: AbortSignal
): Promise<CompleteRotationResponse> {
  return retryMutation(async (signal) => {
    return apiClient<CompleteRotationResponse>({
      path: `/webhooks/${webhookId}/certificates/${certificateId}/complete-rotation`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({}),
      signal,
    });
  }, signal);
}

/**
 * Fetch a single certificate by ID.
 */
export async function getWebhookCertificate(
  token: string,
  webhookId: string,
  certificateId: string,
  signal: AbortSignal
): Promise<CertificateMetadata> {
  return retryRead(async (signal) => {
    return apiClient<CertificateMetadata>({
      path: `/webhooks/${webhookId}/certificates/${certificateId}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}
