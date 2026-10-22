/**
 * Server consistency token parsing and validation for read-after-write
 * propagation tracking (#256).
 *
 * After a mutation succeeds on the primary database or contract indexer, read
 * replicas and projections may briefly lag behind. The server returns a
 * consistency token encoding the tenant (`organizationId`), resource identity
 * (`resourceType`, `resourceId`), target monotonic `expectedVersion`, and a
 * bounded consistency window.
 *
 * Security & correctness invariants:
 * - Cross-tenant tokens (`token.organizationId !== viewerOrganizationId`) are
 *   strictly rejected.
 * - Mismatched-resource tokens (`resourceType` or `resourceId` mismatch) are
 *   strictly rejected.
 * - Consistency windows are bounded to `MAX_CONSISTENCY_WINDOW_MS` so a
 *   malformed or attacker-crafted token cannot pin a pending-propagation
 *   banner indefinitely.
 */

export const DEFAULT_CONSISTENCY_WINDOW_MS = 15_000; // 15 seconds
export const MAX_CONSISTENCY_WINDOW_MS = 60_000; // 60 seconds

const SAFE_CORRELATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{3,64}$/;

export interface ServerConsistencyToken {
  token: string;
  organizationId: string;
  resourceType: string;
  resourceId: string;
  expectedVersion: number;
  issuedAt: string;
  expiresAt: string;
  correlationId?: string | null;
}

export type ConsistencyTokenRejectionReason =
  | "cross-tenant-token"
  | "mismatched-resource"
  | "malformed-token";

export type ConsistencyTokenValidationResult =
  | { ok: true; token: ServerConsistencyToken }
  | {
      ok: false;
      reason: ConsistencyTokenRejectionReason;
      message: string;
    };

export class ConsistencyTokenError extends Error {
  constructor(
    public readonly reason: ConsistencyTokenRejectionReason,
    message: string,
  ) {
    super(message);
    this.name = "ConsistencyTokenError";
  }
}

export function sanitizeCorrelationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_CORRELATION_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Validates a server consistency token against the active tenant and expected
 * resource identity, bounding its expiry window.
 */
export function validateConsistencyToken(
  candidate: unknown,
  context: {
    viewerOrganizationId: string;
    expectedResourceType: string;
    expectedResourceId: string;
    nowMs?: number;
  },
): ConsistencyTokenValidationResult {
  if (!candidate || typeof candidate !== "object") {
    return {
      ok: false,
      reason: "malformed-token",
      message: "Consistency token is missing or not an object.",
    };
  }

  const raw = candidate as Record<string, unknown>;
  const tokenStr = typeof raw.token === "string" ? raw.token.trim() : "";
  const orgId =
    typeof raw.organizationId === "string" ? raw.organizationId.trim() : "";
  const resourceType =
    typeof raw.resourceType === "string" ? raw.resourceType.trim() : "";
  const resourceId =
    typeof raw.resourceId === "string" ? raw.resourceId.trim() : "";
  const expectedVersion = raw.expectedVersion;

  if (
    !tokenStr ||
    !orgId ||
    !resourceType ||
    !resourceId ||
    typeof expectedVersion !== "number" ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return {
      ok: false,
      reason: "malformed-token",
      message:
        "Consistency token is missing required fields or has a non-positive version.",
    };
  }

  if (
    !context.viewerOrganizationId ||
    orgId !== context.viewerOrganizationId.trim()
  ) {
    return {
      ok: false,
      reason: "cross-tenant-token",
      message: `Rejected cross-tenant consistency token for organization "${orgId}".`,
    };
  }

  if (
    resourceType !== context.expectedResourceType.trim() ||
    resourceId !== context.expectedResourceId.trim()
  ) {
    return {
      ok: false,
      reason: "mismatched-resource",
      message: `Rejected consistency token for "${resourceType}:${resourceId}" (expected "${context.expectedResourceType}:${context.expectedResourceId}").`,
    };
  }

  const nowMs = context.nowMs ?? Date.now();
  const issuedAtMs =
    typeof raw.issuedAt === "string" ? new Date(raw.issuedAt).getTime() : nowMs;
  const rawExpiresAtMs =
    typeof raw.expiresAt === "string"
      ? new Date(raw.expiresAt).getTime()
      : issuedAtMs + DEFAULT_CONSISTENCY_WINDOW_MS;

  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(rawExpiresAtMs)) {
    return {
      ok: false,
      reason: "malformed-token",
      message: "Consistency token contains invalid timestamps.",
    };
  }

  if (rawExpiresAtMs <= issuedAtMs) {
    return {
      ok: false,
      reason: "malformed-token",
      message: "Consistency token expiry must be after its issue timestamp.",
    };
  }

  const boundedExpiresAtMs = Math.min(
    rawExpiresAtMs,
    nowMs + MAX_CONSISTENCY_WINDOW_MS,
  );

  return {
    ok: true,
    token: {
      token: tokenStr,
      organizationId: orgId,
      resourceType,
      resourceId,
      expectedVersion,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(boundedExpiresAtMs).toISOString(),
      correlationId: sanitizeCorrelationId(raw.correlationId),
    },
  };
}
