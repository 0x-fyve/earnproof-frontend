/**
 * AUTO-GENERATED. Do not edit.
 * Source: lib/api/openapi/earnproof-api.v1.json
 * Spec version: 1.0.0
 * These types must not overwrite hand-authored UI models in
 * lib/api/client-contracts.ts or components/.
 */

export const API_SPEC_SOURCE = "lib/api/openapi/earnproof-api.v1.json" as const;
export const API_SPEC_VERSION = "1.0.0" as const;
export interface HealthResponse {
  status: string;
  service: string;
  database: "ok" | "error";
  timestamp: string;
}

export interface CreateChallengeRequest {
  walletAddress: string;
}

export interface AuthChallengeResponse {
  id: string;
  message: string;
  expiresAt: string;
}

export interface VerifyChallengeRequest {
  challengeId: string;
  walletAddress: string;
  signature: string;
}

export interface AuthUser {
  id: string;
  walletAddress: string;
  walletHash: string;
  role: "WORKER" | "ISSUER" | "ADMIN" | "DEVELOPER" | "worker";
}

export interface AuthSession {
  token: string;
  tokenType: string;
  sessionId?: string;
  expiresAt?: string;
}

export interface AuthVerifyResponse {
  user: AuthUser;
  session: AuthSession;
}

export type PaymentClassification = "INCOME" | "REIMBURSEMENT" | "PERSONAL_TRANSFER" | "UNKNOWN" | "EXCLUDED";

export interface Payment {
  id: string;
  stellarTransactionHash: string;
  operationId?: string;
  sourceAddress: string;
  destinationAddress?: string;
  assetCode: string;
  assetIssuer?: string | null;
  occurredAt: string;
  classification: PaymentClassification;
  isEligible: boolean;
}

export interface PaymentSyncResult {
  created?: number;
  updated?: number;
  skipped?: number;
}

export interface UpdatePaymentClassificationRequest {
  classification: PaymentClassification;
}

export interface CreateMinimumIncomeProofRequest {
  selectedPaymentIds: Array<string>;
  thresholdAmount: string;
  assetCode: string;
  assetIssuer?: string;
  periodStart: string;
  periodEnd: string;
  expiresInDays?: number;
}

export interface SignedCredential {
  id: string;
  type?: string;
  schemaVersion: string;
  issuer?: string;
  subject: {
  walletHash: string;
};
  claim: {
  operator: "gte";
  thresholdAmount: string;
  assetCode: string;
  assetIssuer?: string | null;
  periodStart: string;
  periodEnd: string;
  qualifyingPaymentCount: number;
};
  privacy: {
  exactIncomeHidden: boolean;
  sourceTransactionsHidden: boolean;
};
  issuedAt: string;
  expiresAt: string;
  proof: {
  type: string;
  credentialHash: string;
  signature: string;
};
}

export interface ProofSummary {
  id: string;
  type: string;
  schemaVersion: string;
  network: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface VerificationSource {
  id: string;
  type: "issuer" | "contract" | "stellar_account" | "backend_registry";
  status: "verified" | "unavailable" | "failed";
  name: string;
  description?: string;
}

export interface VerificationObservation {
  checkpointId: string;
  timestamp: string;
  sourceId: string;
  observationType: "signature_check" | "issuer_check" | "expiration_check" | "revocation_check" | "account_check";
  result: boolean;
  details?: string;
}

export interface VerificationCheckpoint {
  id: string;
  name: string;
  order: number;
  description?: string;
}

export interface MissingProvenanceLink {
  sourceId: string;
  reason: "timeout" | "network_error" | "permission_denied" | "not_applicable";
  retryable?: boolean;
}

export interface ProvenianceChain {
  sources: VerificationSource[];
  checkpoints: VerificationCheckpoint[];
  observations: VerificationObservation[];
  verificationPath: string[];
  missingLinks: MissingProvenanceLink[];
}

export interface VerifyProofResponse {
  result: "VALID" | "EXPIRED" | "REVOKED" | "INVALID_SIGNATURE" | "UNKNOWN_PROOF" | "UNVERIFIED_ISSUER";
  status: "valid" | "expired" | "revoked" | "unknown" | "invalid";
  credential?: SignedCredential;
  proof?: ProofSummary;
  provenance?: ProvenianceChain;
}

export interface ProofCreated {
  proofId: string;
  status: string;
  verificationUrl: string;
  credential: SignedCredential;
}

export interface RecurringIncomeProof {
  proofId: string;
  status: string;
  verificationUrl: string;
  credential: SignedCredential;
}

export interface Issuer {
  id: string;
  name: string;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "REVOKED";
  organizationId?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  website?: string | null;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "REVOKED" | "DELETED";
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: Array<string>;
  expiresAt?: string | null;
}

export interface CreateWebhookRequest {
  url: string;
  events: Array<"proof.created" | "proof.verified" | "proof.revoked">;
}

export interface Webhook {
  id: string;
  url: string;
  events: Array<string>;
  status: "ACTIVE" | "DISABLED";
}

export interface ActivityEvent {
  id: string;
  category: "auth" | "key" | "session" | "admin";
  action: string;
  outcome: "success" | "failure" | "pending";
  occurredAt: string;
  ipAddressMasked?: string;
  locationLabel?: string;
  walletAddressMasked?: string;
  apiKeyIdMasked?: string;
  sessionIdMasked?: string;
  targetLabel?: string;
}

export interface ActivityPage {
  events: Array<ActivityEvent>;
  nextCursor: string | null;
}

export interface ApiError {
  statusCode: number;
  code: "VALIDATION_ERROR" | "INVALID_INPUT" | "MISSING_TOKEN" | "INVALID_TOKEN" | "EXPIRED_TOKEN" | "INVALID_CREDENTIALS" | "SESSION_EXPIRED" | "FORBIDDEN" | "NOT_FOUND" | "PAYMENT_NOT_FOUND" | "PAYMENT_NOT_ELIGIBLE" | "PAYMENT_EXCLUDED" | "CONFLICT" | "TOO_MANY_REQUESTS" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR";
  message: string;
  requestId: string;
  violations?: Array<{
  field: string;
  message: string;
}>;
}
