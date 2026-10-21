import { apiClient, bearer, retryRead, retryMutation } from "./client";
import type { ApiKey } from "./generated/v1";

export type CreateApiKeyRequest = {
  name: string;
  scopes: string[];
  expiresInDays?: number;
};

export type CreateApiKeyResponse = {
  apiKey: ApiKey;
  secret: string; // Only returned once on creation
};

export type RotateApiKeyResponse = {
  apiKey: ApiKey;
  secret: string; // Only returned once on rotation
};

export type ApiKeyOverlapStatus = "active" | "ended" | "expired";

export type ApiKeyOverlap = {
  /** The existing key kept alive for migration during the overlap window. */
  oldKeyId: string;
  /** The newly issued key integrations should migrate to. */
  newApiKey: ApiKey;
  /** ISO 8601 deadline after which the old key stops working. */
  overlapDeadline: string;
  status: ApiKeyOverlapStatus;
  /** ISO 8601 timestamp of the old key's most recent successful use, if any. */
  oldKeyLastUsedAt: string | null;
};

export type StartKeyOverlapResponse = {
  overlap: ApiKeyOverlap;
  secret: string; // Only returned once, for the new key
};

export type PaginatedApiKeysResponse = {
  items: ApiKey[];
  nextCursor: string | null;
  previousCursor: string | null;
};

export const AVAILABLE_SCOPES = [
  "verification:read",
  "proofs:create", 
  "proofs:read",
  "webhooks:manage"
] as const;

export type ApiKeyScope = (typeof AVAILABLE_SCOPES)[number];

function isApiKeyScope(scope: string): scope is ApiKeyScope {
  return (AVAILABLE_SCOPES as readonly string[]).includes(scope);
}

export async function getApiKeys(token: string, signal: AbortSignal): Promise<ApiKey[]> {
  return retryRead(async (signal) => {
    return apiClient<ApiKey[]>({
      path: "/api-keys",
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function getApiKeysPaginated(
  token: string,
  pageSize: number = 10,
  nextCursor?: string,
  previousCursor?: string,
  signal?: AbortSignal
): Promise<PaginatedApiKeysResponse> {
  return retryRead(async (signal) => {
    const params = new URLSearchParams();
    params.append("limit", String(pageSize));
    if (nextCursor) params.append("next_cursor", nextCursor);
    if (previousCursor) params.append("previous_cursor", previousCursor);

    return apiClient<PaginatedApiKeysResponse>({
      path: `/api-keys?${params.toString()}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal!);
}

export async function createApiKey(
  token: string,
  request: CreateApiKeyRequest,
  signal: AbortSignal
): Promise<CreateApiKeyResponse> {
  return retryMutation(async (signal) => {
    return apiClient<CreateApiKeyResponse>({
      path: "/api-keys",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

export async function rotateApiKey(
  token: string,
  keyId: string,
  signal: AbortSignal
): Promise<RotateApiKeyResponse> {
  return retryMutation(async (signal) => {
    return apiClient<RotateApiKeyResponse>({
      path: `/api-keys/${keyId}/rotate`,
      method: "POST",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function revokeApiKey(
  token: string,
  keyId: string,
  signal: AbortSignal
): Promise<void> {
  return retryMutation(async (signal) => {
    await apiClient({
      path: `/api-keys/${keyId}`,
      method: "DELETE",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Starts an overlap rotation: issues a new key immediately while keeping
 * the old key valid until `overlapDeadline`, so integrations have a window
 * to migrate instead of the old key becoming invalid the instant rotation
 * happens (see `rotateApiKey`, which is an immediate, non-overlapping swap).
 *
 * `overlapHours` is clamped server-side; the client only needs to request
 * a window, it doesn't decide the final deadline.
 */
export async function startKeyOverlapRotation(
  token: string,
  keyId: string,
  overlapHours: number,
  signal: AbortSignal
): Promise<StartKeyOverlapResponse> {
  return retryMutation(async (signal) => {
    return apiClient<StartKeyOverlapResponse>({
      path: `/api-keys/${keyId}/overlap-rotation`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ overlapHours }),
      signal,
    });
  }, signal);
}

/** Fetches the current overlap state for a key that has an active or past overlap rotation. */
export async function getKeyOverlapStatus(
  token: string,
  keyId: string,
  signal: AbortSignal
): Promise<ApiKeyOverlap | null> {
  return retryRead(async (signal) => {
    return apiClient<ApiKeyOverlap | null>({
      path: `/api-keys/${keyId}/overlap-rotation`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Ends an overlap window early, immediately revoking the old key rather
 * than waiting for `overlapDeadline`. Requires a recently-authenticated
 * session (enforced by the caller via `useRecentAuth`/`RecentAuthGate`,
 * and re-checked server-side).
 *
 * Throws if the overlap has already ended or expired — the server is the
 * source of truth here; the client never extends or re-opens a window.
 */
export async function endKeyOverlapEarly(
  token: string,
  keyId: string,
  signal: AbortSignal
): Promise<ApiKeyOverlap> {
  return retryMutation(async (signal) => {
    return apiClient<ApiKeyOverlap>({
      path: `/api-keys/${keyId}/overlap-rotation/end`,
      method: "POST",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export function formatApiKeyPrefix(prefix: string): string {
  return prefix.length > 8 ? `${prefix.slice(0, 8)}...` : prefix;
}

export function validateApiKeyName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "API key name is required";
  }
  if (trimmed.length < 3) {
    return "API key name must be at least 3 characters";
  }
  if (trimmed.length > 64) {
    return "API key name must be less than 64 characters";
  }
  if (!/^[a-zA-Z0-9\s\-_.]+$/.test(trimmed)) {
    return "API key name can only contain letters, numbers, spaces, hyphens, underscores, and periods";
  }
  return null;
}

export function validateApiKeyScopes(scopes: string[]): string | null {
  if (scopes.length === 0) {
    return "At least one scope is required";
  }
  
  const invalidScopes = scopes.filter((scope) => !isApiKeyScope(scope));
  if (invalidScopes.length > 0) {
    return `Invalid scopes: ${invalidScopes.join(", ")}`;
  }
  
  return null;
}
