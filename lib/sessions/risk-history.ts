/**
 * Session risk signals and reauthentication history (#244).
 *
 * Provides transparent security context for recent-auth prompts and active
 * sessions without exposing raw device fingerprints, precise locations, IP
 * addresses, or session tokens.
 *
 * Key guarantees:
 * - Risk labels use descriptive, evidence-bounded language ("observed",
 *   "reported by server") and never imply certainty beyond server evidence.
 * - Strict tenant (`organizationId`) and user (`userId`) isolation: one
 *   organization or user can never read or mutate another tenant's session
 *   risk or authentication history.
 * - Sensitive values (raw User-Agent strings, canvas/fingerprint hashes,
 *   IPv4/IPv6 addresses, GPS coordinates, street-level locations, tokens,
 *   signatures) are redacted before storage or display.
 */

import { RECENT_AUTH_WINDOW_MS } from "@/lib/auth/recent-auth";
import { redactMessage } from "@/lib/telemetry/redact";
import { labelDevice } from "./device-label";
import {
  listActiveSessions,
  listRecentlyRevokedSessions,
  revokeSession,
  type SessionRecord,
} from "./store";

const RISK_STORAGE_KEY_PREFIX = "earnproof.session-risk-history.";

export type KnownSessionRiskReasonCode =
  | "unknown-device"
  | "replay-alert"
  | "coarse-region-shift"
  | "recent-auth-expired"
  | "sensitive-action-step-up";

export type SessionRiskReasonCode = KnownSessionRiskReasonCode | "unclassified-signal";

export type SessionRiskSeverity = "info" | "review" | "elevated";

export interface SessionRiskDescriptor {
  code: SessionRiskReasonCode;
  /** Descriptive label that never implies certainty beyond server evidence. */
  label: string;
  /** Plain-language explanation of what server evidence was observed. */
  evidenceSummary: string;
  /** Guidance on what action the user can take. */
  recommendedAction: string;
  severity: SessionRiskSeverity;
}

const RISK_DESCRIPTORS: Record<SessionRiskReasonCode, SessionRiskDescriptor> = {
  "unknown-device": {
    code: "unknown-device",
    label: "Unrecognized browser or OS family observed",
    evidenceSummary:
      "Server telemetry recorded a session from a coarse device family not previously seen on this account. Shared or updated browsers can also produce this signal.",
    recommendedAction:
      "Confirm whether you signed in from this device family. If you do not recognize the activity, sign out the affected session remotely.",
    severity: "review",
  },
  "replay-alert": {
    code: "replay-alert",
    label: "Repeated challenge verification attempt observed",
    evidenceSummary:
      "The server rejected a previously consumed authentication challenge nonce. This can occur after a duplicate network retry or an attempted signature replay.",
    recommendedAction:
      "Verify whether the linked session is still expected. Sign out the affected session if the activity was not initiated by you.",
    severity: "elevated",
  },
  "coarse-region-shift": {
    code: "coarse-region-shift",
    label: "Coarse network region change observed",
    evidenceSummary:
      "Server routing metadata indicated a change in coarse geographic region between consecutive requests. VPNs, mobile carriers, and proxies frequently cause region changes.",
    recommendedAction:
      "No action is required if you use a VPN or traveled recently. Otherwise, sign out the affected session.",
    severity: "review",
  },
  "recent-auth-expired": {
    code: "recent-auth-expired",
    label: "Recent authentication freshness window elapsed",
    evidenceSummary:
      "A sensitive operation was requested after the bounded recent-authentication window expired, prompting a fresh wallet signature check.",
    recommendedAction:
      "Complete a fresh wallet signature assertion when prompted to proceed with the sensitive action.",
    severity: "info",
  },
  "sensitive-action-step-up": {
    code: "sensitive-action-step-up",
    label: "Step-up wallet verification requested for sensitive action",
    evidenceSummary:
      "The requested operation modifies security-critical settings and requires proof of active wallet possession beyond the bearer session.",
    recommendedAction:
      "Review the action details and sign the single-use challenge with your connected Stellar wallet.",
    severity: "info",
  },
  "unclassified-signal": {
    code: "unclassified-signal",
    label: "Unclassified server security signal observed",
    evidenceSummary:
      "The server recorded an authentication or session signal that does not match a known client category. This signal alone does not confirm unauthorized access.",
    recommendedAction:
      "Review the linked session status and sign out any device you do not recognize.",
    severity: "review",
  },
};

export type AuthHistoryEventType =
  | "wallet-sign-in"
  | "reauth-verified"
  | "reauth-expired"
  | "replay-blocked"
  | "session-revoked"
  | "risk-signal-observed";

export interface SessionSecurityEventInput {
  id: string;
  userId: string;
  organizationId: string;
  sessionId: string;
  eventType: AuthHistoryEventType | string;
  riskReasonCode?: string | null;
  occurredAt: string;
  /** Coarse device label or raw user-agent (which will be reduced to coarse OS/browser). */
  deviceContext?: string;
  /** Coarse region (precise coordinates, street addresses, and IPs are redacted). */
  locationContext?: string;
  /** Optional description of the sensitive action or server note (redacted before display). */
  detail?: string;
  /** Raw fingerprint or IP fields that might arrive in untrusted payloads — always stripped. */
  rawFingerprint?: unknown;
  ipAddress?: unknown;
  coordinates?: unknown;
  rawToken?: unknown;
}

export interface SessionSecurityEvent {
  id: string;
  userId: string;
  organizationId: string;
  sessionId: string;
  eventType: AuthHistoryEventType;
  riskReasonCode: SessionRiskReasonCode | null;
  riskDescriptor: SessionRiskDescriptor | null;
  occurredAt: string;
  /** Privacy-safe coarse device label (never a raw User-Agent or fingerprint hash). */
  deviceLabel: string;
  /** Privacy-safe coarse region label (never an IP address or GPS coordinate). */
  coarseRegion: string;
  /** Redacted, evidence-bounded detail string. */
  detail: string;
  /** Whether raw sensitive telemetry fields were stripped during normalization. */
  redactedFieldsCount: number;
}

export type LinkedSessionState =
  | "active-current"
  | "active-remote"
  | "revoked"
  | "unknown-session";

export interface LinkedSessionResolution {
  sessionId: string;
  state: LinkedSessionState;
  deviceLabel: string;
  revokedAt: string | null;
  /** True only when the session is currently active and is NOT the current browser tab's session. */
  canRemoteSignOut: boolean;
}

export interface RecentAuthExpiryStatus {
  status: "fresh" | "expiring-soon" | "expired" | "unverified";
  isFresh: boolean;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  remainingMs: number;
  windowMs: number;
  headline: string;
  explanation: string;
}

export interface SensitiveActionPolicyItem {
  id: string;
  actionName: string;
  whySignatureRequired: string;
  freshnessRequirement: string;
}

export class TenantSessionAccessError extends Error {
  constructor(message = "Cross-tenant or cross-user session history access is denied.") {
    super(message);
    this.name = "TenantSessionAccessError";
  }
}

const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const IPV6_PATTERN = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;
const GPS_COORDINATE_PATTERN =
  /[-+]?\d{1,2}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/g;
const FINGERPRINT_HASH_PATTERN =
  /\b(?:fp|fp_id|canvas|webgl|device_hash|device_id|hw_id|fingerprint)[_:=-\s]*[a-zA-Z0-9_-]{4,}|\b[a-zA-Z0-9_-]*fingerprint[a-zA-Z0-9_-]*\b/gi;
const STREET_ADDRESS_PATTERN =
  /\b\d+\s+[A-Za-z0-9.\s]{2,30}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/gi;
const POSTAL_CODE_PATTERN = /\b\d{5}(?:-\d{4})?\b/g;

const SAFE_COARSE_REGIONS: ReadonlySet<string> = new Set([
  "North America",
  "Europe",
  "Asia Pacific",
  "Latin America",
  "Middle East & Africa",
  "Global / Unspecified region",
]);

/**
 * Redacts raw IPs, GPS coordinates, street addresses, fingerprint hashes,
 * and telemetry secrets from any text shown in session risk history.
 */
export function redactSessionSecurityText(input: unknown): {
  text: string;
  redacted: boolean;
} {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { text: "", redacted: false };
  }

  let working = input;
  let redacted = false;

  const patterns: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
    { regex: IPV4_PATTERN, replacement: "<redacted-ip>" },
    { regex: IPV6_PATTERN, replacement: "<redacted-ip>" },
    { regex: GPS_COORDINATE_PATTERN, replacement: "<redacted-location>" },
    { regex: FINGERPRINT_HASH_PATTERN, replacement: "<redacted-fingerprint>" },
    { regex: STREET_ADDRESS_PATTERN, replacement: "<redacted-address>" },
    { regex: POSTAL_CODE_PATTERN, replacement: "<redacted-postal>" },
  ];

  for (const { regex, replacement } of patterns) {
    const next = working.replace(regex, replacement);
    if (next !== working) {
      redacted = true;
      working = next;
    }
  }

  const telemetryRedacted = redactMessage(working);
  if (telemetryRedacted !== working.replace(/\s+/g, " ").trim()) {
    redacted = true;
  }

  return { text: telemetryRedacted, redacted };
}

/**
 * Normalizes a device context into a coarse OS + browser label, stripping
 * raw User-Agent strings, build numbers, or fingerprint identifiers.
 */
export function sanitizeDeviceContext(deviceContext: unknown): {
  label: string;
  wasRedacted: boolean;
} {
  if (typeof deviceContext !== "string" || deviceContext.trim().length === 0) {
    return { label: "Unknown device - Unknown browser", wasRedacted: false };
  }

  const trimmed = deviceContext.trim();
  const alreadyCoarse =
    /^(iOS|Android|macOS|Windows|Linux|Unknown device) - (Edge|Opera|Firefox|Chrome|Safari|Unknown browser)$/.test(
      trimmed,
    );
  if (alreadyCoarse) {
    return { label: trimmed, wasRedacted: false };
  }

  // Raw user agent or fingerprint string -> convert to coarse label
  const coarse = labelDevice(trimmed);
  return { label: coarse, wasRedacted: true };
}

/**
 * Normalizes location context to a privacy-safe coarse region.
 * Any precise coordinates, IP addresses, or city/street details are stripped.
 */
export function sanitizeLocationContext(locationContext: unknown): {
  coarseRegion: string;
  wasRedacted: boolean;
} {
  if (typeof locationContext !== "string" || locationContext.trim().length === 0) {
    return { coarseRegion: "Global / Unspecified region", wasRedacted: false };
  }

  const trimmed = locationContext.trim();
  if (SAFE_COARSE_REGIONS.has(trimmed)) {
    return { coarseRegion: trimmed, wasRedacted: false };
  }

  const lower = trimmed.toLowerCase();
  if (
    IPV4_PATTERN.test(trimmed) ||
    IPV6_PATTERN.test(trimmed) ||
    GPS_COORDINATE_PATTERN.test(trimmed) ||
    STREET_ADDRESS_PATTERN.test(trimmed)
  ) {
    IPV4_PATTERN.lastIndex = 0;
    IPV6_PATTERN.lastIndex = 0;
    GPS_COORDINATE_PATTERN.lastIndex = 0;
    STREET_ADDRESS_PATTERN.lastIndex = 0;
    return { coarseRegion: "Coarse region (precise location redacted)", wasRedacted: true };
  }

  if (lower.includes("us-") || lower.includes("america") || lower.includes("canada")) {
    return { coarseRegion: "North America", wasRedacted: trimmed !== "North America" };
  }
  if (lower.includes("eu-") || lower.includes("europe") || lower.includes("uk")) {
    return { coarseRegion: "Europe", wasRedacted: trimmed !== "Europe" };
  }
  if (lower.includes("ap-") || lower.includes("asia") || lower.includes("pacific")) {
    return { coarseRegion: "Asia Pacific", wasRedacted: trimmed !== "Asia Pacific" };
  }

  return { coarseRegion: "Coarse region (precise location redacted)", wasRedacted: true };
}

/**
 * Resolves a risk reason code into a descriptive, evidence-bounded descriptor.
 */
export function getSessionRiskDescriptor(
  reasonCode: string | null | undefined,
): SessionRiskDescriptor | null {
  if (!reasonCode) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(RISK_DESCRIPTORS, reasonCode)) {
    return RISK_DESCRIPTORS[reasonCode as SessionRiskReasonCode];
  }
  return RISK_DESCRIPTORS["unclassified-signal"];
}

function normalizeEventType(eventType: string): AuthHistoryEventType {
  const valid: ReadonlyArray<AuthHistoryEventType> = [
    "wallet-sign-in",
    "reauth-verified",
    "reauth-expired",
    "replay-blocked",
    "session-revoked",
    "risk-signal-observed",
  ];
  if ((valid as readonly string[]).includes(eventType)) {
    return eventType as AuthHistoryEventType;
  }
  return "risk-signal-observed";
}

/**
 * Sanitizes a raw session security event, stripping raw fingerprints, IPs,
 * coordinates, and tokens before it is stored or rendered.
 */
export function sanitizeSessionSecurityEvent(
  input: SessionSecurityEventInput,
): SessionSecurityEvent {
  let redactedFieldsCount = 0;

  if (input.rawFingerprint !== undefined) redactedFieldsCount += 1;
  if (input.ipAddress !== undefined) redactedFieldsCount += 1;
  if (input.coordinates !== undefined) redactedFieldsCount += 1;
  if (input.rawToken !== undefined) redactedFieldsCount += 1;

  const device = sanitizeDeviceContext(input.deviceContext);
  if (device.wasRedacted) redactedFieldsCount += 1;

  const location = sanitizeLocationContext(input.locationContext);
  if (location.wasRedacted) redactedFieldsCount += 1;

  const detailResult = redactSessionSecurityText(input.detail ?? "");
  if (detailResult.redacted) redactedFieldsCount += 1;

  const descriptor = getSessionRiskDescriptor(input.riskReasonCode);

  return {
    id: input.id,
    userId: input.userId,
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    eventType: normalizeEventType(input.eventType),
    riskReasonCode: descriptor ? descriptor.code : null,
    riskDescriptor: descriptor,
    occurredAt: input.occurredAt,
    deviceLabel: device.label,
    coarseRegion: location.coarseRegion,
    detail:
      detailResult.text ||
      descriptor?.evidenceSummary ||
      "Authentication event recorded by server.",
    redactedFieldsCount,
  };
}

function riskStorageKey(organizationId: string, userId: string): string {
  return `${RISK_STORAGE_KEY_PREFIX}${organizationId}::${userId}`;
}

function seedSecurityEvents(
  userId: string,
  organizationId: string,
  now: number,
): SessionSecurityEvent[] {
  const rawSeeds: SessionSecurityEventInput[] = [
    {
      id: `evt-unknown-device-${organizationId}`,
      userId,
      organizationId,
      sessionId: "seed-1",
      eventType: "risk-signal-observed",
      riskReasonCode: "unknown-device",
      occurredAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      deviceContext: "iOS - Safari",
      locationContext: "Europe",
      detail:
        "Sign-in observed from a mobile browser family not previously linked to this workspace.",
    },
    {
      id: `evt-replay-alert-${organizationId}`,
      userId,
      organizationId,
      sessionId: "seed-2",
      eventType: "replay-blocked",
      riskReasonCode: "replay-alert",
      occurredAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
      deviceContext: "Windows - Edge",
      locationContext: "North America",
      detail:
        "Server rejected a duplicate verification request for an already-consumed challenge nonce.",
    },
    {
      id: `evt-reauth-expired-${organizationId}`,
      userId,
      organizationId,
      sessionId: `current-${userId}`,
      eventType: "reauth-expired",
      riskReasonCode: "recent-auth-expired",
      occurredAt: new Date(now - 15 * 60 * 1000).toISOString(),
      deviceContext:
        typeof navigator !== "undefined" ? navigator.userAgent : "macOS - Chrome",
      locationContext: "North America",
      detail:
        "Recent authentication window expired before sensitive API key or session mutation.",
    },
    {
      id: `evt-reauth-verified-${organizationId}`,
      userId,
      organizationId,
      sessionId: `current-${userId}`,
      eventType: "reauth-verified",
      riskReasonCode: null,
      occurredAt: new Date(now - 45 * 60 * 1000).toISOString(),
      deviceContext:
        typeof navigator !== "undefined" ? navigator.userAgent : "macOS - Chrome",
      locationContext: "North America",
      detail: "Fresh wallet signature verified for sensitive account settings.",
    },
  ];

  return rawSeeds.map(sanitizeSessionSecurityEvent);
}

function readStoredEvents(
  organizationId: string,
  userId: string,
): SessionSecurityEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(riskStorageKey(organizationId, userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SessionSecurityEventInput =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).userId === "string" &&
          typeof (item as Record<string, unknown>).organizationId === "string" &&
          typeof (item as Record<string, unknown>).sessionId === "string" &&
          typeof (item as Record<string, unknown>).occurredAt === "string",
      )
      .map(sanitizeSessionSecurityEvent);
  } catch {
    return [];
  }
}

function writeStoredEvents(
  organizationId: string,
  userId: string,
  events: SessionSecurityEvent[],
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    riskStorageKey(organizationId, userId),
    JSON.stringify(events),
  );
}

function assertTenantAndUserScope(params: {
  targetOrganizationId: string;
  targetUserId: string;
  viewerOrganizationId: string;
  viewerUserId: string;
}): void {
  const {
    targetOrganizationId,
    targetUserId,
    viewerOrganizationId,
    viewerUserId,
  } = params;
  if (
    !targetOrganizationId ||
    !viewerOrganizationId ||
    targetOrganizationId !== viewerOrganizationId
  ) {
    throw new TenantSessionAccessError(
      "Cannot observe session history belonging to another organization.",
    );
  }
  if (!targetUserId || !viewerUserId || targetUserId !== viewerUserId) {
    throw new TenantSessionAccessError(
      "Cannot observe session history belonging to another user.",
    );
  }
}

/**
 * Lists tenant-scoped, privacy-safe session security and reauthentication events.
 * Enforces strict tenant and user isolation.
 */
export function listSessionSecurityEvents(params: {
  userId: string;
  organizationId: string;
  viewerUserId?: string;
  viewerOrganizationId?: string;
  now?: number;
}): SessionSecurityEvent[] {
  const viewerUserId = params.viewerUserId ?? params.userId;
  const viewerOrganizationId = params.viewerOrganizationId ?? params.organizationId;

  assertTenantAndUserScope({
    targetOrganizationId: params.organizationId,
    targetUserId: params.userId,
    viewerOrganizationId,
    viewerUserId,
  });

  let events = readStoredEvents(params.organizationId, params.userId);
  if (events.length === 0) {
    events = seedSecurityEvents(
      params.userId,
      params.organizationId,
      params.now ?? Date.now(),
    );
    writeStoredEvents(params.organizationId, params.userId, events);
  }

  // Defense-in-depth filter so cross-tenant records injected into storage are never returned
  return events.filter(
    (e) =>
      e.organizationId === viewerOrganizationId && e.userId === viewerUserId,
  );
}

/**
 * Appends a new sanitized session security or reauthentication event for the
 * authenticated user and organization.
 */
export function recordSessionSecurityEvent(
  input: SessionSecurityEventInput,
  viewerContext?: { viewerUserId: string; viewerOrganizationId: string },
): SessionSecurityEvent {
  if (viewerContext) {
    assertTenantAndUserScope({
      targetOrganizationId: input.organizationId,
      targetUserId: input.userId,
      viewerOrganizationId: viewerContext.viewerOrganizationId,
      viewerUserId: viewerContext.viewerUserId,
    });
  }

  const existing = listSessionSecurityEvents({
    userId: input.userId,
    organizationId: input.organizationId,
  });
  const sanitized = sanitizeSessionSecurityEvent(input);
  const updated = [sanitized, ...existing.filter((e) => e.id !== sanitized.id)];
  writeStoredEvents(input.organizationId, input.userId, updated);
  return sanitized;
}

/**
 * Links a security/risk event to its affected session across active and
 * recently revoked session inventories.
 */
export function resolveLinkedSession(
  event: Pick<SessionSecurityEvent, "sessionId" | "deviceLabel">,
  activeSessions: SessionRecord[],
  revokedSessions: SessionRecord[],
): LinkedSessionResolution {
  const activeMatch = activeSessions.find((s) => s.id === event.sessionId);
  if (activeMatch) {
    return {
      sessionId: activeMatch.id,
      state: activeMatch.isCurrent ? "active-current" : "active-remote",
      deviceLabel: activeMatch.deviceLabel,
      revokedAt: null,
      canRemoteSignOut: !activeMatch.isCurrent,
    };
  }

  const revokedMatch = revokedSessions.find((s) => s.id === event.sessionId);
  if (revokedMatch) {
    return {
      sessionId: revokedMatch.id,
      state: "revoked",
      deviceLabel: revokedMatch.deviceLabel,
      revokedAt: revokedMatch.revokedAt,
      canRemoteSignOut: false,
    };
  }

  return {
    sessionId: event.sessionId,
    state: "unknown-session",
    deviceLabel: event.deviceLabel,
    revokedAt: null,
    canRemoteSignOut: false,
  };
}

/**
 * Remotely signs out the session linked to a risk event and records a
 * corresponding `session-revoked` event in the tenant-scoped history.
 */
export function signOutSessionFromRiskEvent(params: {
  userId: string;
  organizationId: string;
  sessionId: string;
  riskEventId: string;
  viewerUserId?: string;
  viewerOrganizationId?: string;
  now?: number;
}): {
  activeSessions: SessionRecord[];
  revokedSessions: SessionRecord[];
  events: SessionSecurityEvent[];
} {
  const viewerUserId = params.viewerUserId ?? params.userId;
  const viewerOrganizationId = params.viewerOrganizationId ?? params.organizationId;

  assertTenantAndUserScope({
    targetOrganizationId: params.organizationId,
    targetUserId: params.userId,
    viewerOrganizationId,
    viewerUserId,
  });

  // Ensure active sessions are initialized for the user before revoking
  const activeBefore = listActiveSessions(params.userId);
  const target = activeBefore.find((s) => s.id === params.sessionId);

  revokeSession(params.userId, params.sessionId);

  const nowIso = new Date(params.now ?? Date.now()).toISOString();
  recordSessionSecurityEvent(
    {
      id: `evt-revoke-${params.sessionId}-${params.riskEventId}`,
      userId: params.userId,
      organizationId: params.organizationId,
      sessionId: params.sessionId,
      eventType: "session-revoked",
      riskReasonCode: null,
      occurredAt: nowIso,
      deviceContext: target?.deviceLabel ?? "Unknown device - Unknown browser",
      locationContext: "Global / Unspecified region",
      detail: `Remote sign-out completed for session following security review (${params.riskEventId}).`,
    },
    { viewerUserId, viewerOrganizationId },
  );

  return {
    activeSessions: listActiveSessions(params.userId),
    revokedSessions: listRecentlyRevokedSessions(params.userId),
    events: listSessionSecurityEvents({
      userId: params.userId,
      organizationId: params.organizationId,
      viewerUserId,
      viewerOrganizationId,
    }),
  };
}

/**
 * Computes the current recent-authentication freshness state and explains
 * when sensitive actions require a fresh wallet signature.
 */
export function computeRecentAuthExpiryStatus(params: {
  lastVerifiedAtMs: number | null;
  nowMs?: number;
  windowMs?: number;
}): RecentAuthExpiryStatus {
  const nowMs = params.nowMs ?? Date.now();
  const windowMs = params.windowMs ?? RECENT_AUTH_WINDOW_MS;

  if (params.lastVerifiedAtMs === null || !Number.isFinite(params.lastVerifiedAtMs)) {
    return {
      status: "unverified",
      isFresh: false,
      lastVerifiedAt: null,
      expiresAt: null,
      remainingMs: 0,
      windowMs,
      headline: "Fresh wallet signature required for sensitive actions",
      explanation:
        "Your session is signed in, but no recent wallet signature assertion is active. Sensitive operations will prompt your Stellar wallet to sign a single-use challenge.",
    };
  }

  const expiresAtMs = params.lastVerifiedAtMs + windowMs;
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const lastVerifiedAt = new Date(params.lastVerifiedAtMs).toISOString();
  const expiresAt = new Date(expiresAtMs).toISOString();

  if (remainingMs === 0) {
    return {
      status: "expired",
      isFresh: false,
      lastVerifiedAt,
      expiresAt,
      remainingMs: 0,
      windowMs,
      headline: "Recent authentication window expired",
      explanation:
        "The 5-minute recent-authentication window has elapsed. The next sensitive action will require a fresh wallet signature to confirm active key possession.",
    };
  }

  const expiringSoonThresholdMs = Math.min(60_000, Math.floor(windowMs / 4));
  if (remainingMs <= expiringSoonThresholdMs) {
    return {
      status: "expiring-soon",
      isFresh: true,
      lastVerifiedAt,
      expiresAt,
      remainingMs,
      windowMs,
      headline: "Recent authentication expiring soon",
      explanation:
        "Your recent wallet verification is still valid briefly, after which sensitive actions will prompt for a new wallet signature.",
    };
  }

  return {
    status: "fresh",
    isFresh: true,
    lastVerifiedAt,
    expiresAt,
    remainingMs,
    windowMs,
    headline: "Recent wallet verification active",
    explanation:
      "Sensitive actions can proceed within the current freshness window without an additional wallet signature prompt.",
  };
}

/**
 * Policy catalog explaining which sensitive actions require a fresh wallet
 * signature and why.
 */
export const SENSITIVE_ACTION_SIGNATURE_POLICIES: ReadonlyArray<SensitiveActionPolicyItem> =
  [
    {
      id: "api-key-lifecycle",
      actionName: "Creating or revoking API keys",
      whySignatureRequired:
        "Prevents an unattended browser tab or stolen bearer token from issuing or revoking programmatic credentials without active wallet custody.",
      freshnessRequirement: "Requires a wallet signature verified within the last 5 minutes.",
    },
    {
      id: "organization-governance",
      actionName: "Role changes, archival, and policy modifications",
      whySignatureRequired:
        "Protects tenant-wide administrative privileges and approval thresholds by requiring cryptographic confirmation from the connected Stellar account.",
      freshnessRequirement: "Requires a wallet signature verified within the last 5 minutes.",
    },
    {
      id: "wallet-and-key-rotation",
      actionName: "Wallet rotation and issuer key updates",
      whySignatureRequired:
        "Confirms possession of the active signing key before rotating account bindings or attestation keys.",
      freshnessRequirement: "Always requires a fresh single-use challenge signature.",
    },
  ];
