import { z } from "zod";
import { isValidIanaTimeZone } from "@/lib/notifications/digest-schedule";

/**
 * Security notification digest settings - PROPOSED contract (#269).
 *
 * BACKEND GAP: the API has no notification-preferences endpoint at all (see
 * lib/proofs/expiration-reminders.ts), no channel list, no list of critical
 * security event types and no version/ETag on any settings resource.
 * Following the repository precedent for unspecced features (#242, #245),
 * this module defines and validates the shapes the UI needs, exports NO
 * fetcher and is NOT registered in client-contracts.json; the form receives
 * its loader and saver as props. Assumed routes, to be confirmed:
 *   GET /users/me/notification-digest-settings
 *   PUT /users/me/notification-digest-settings   (409 + current settings on a stale `version`)
 *
 * CRITICAL NOTICES ARE NEVER DIGESTED. The client only offers known
 * digestible types, treats every unknown or server-declared critical type as
 * critical, and validateDigestSettingsUpdate() refuses to produce a payload
 * that would put any of them in a digest. THE SERVER MUST ENFORCE THE SAME
 * RULE INDEPENDENTLY; this client check is defence in depth, not the control.
 */

export const NOTIFICATION_DIGEST_SCHEMA_VERSION = 1;

/** Low-urgency security events this client allows to be grouped (activity-log action names). */
export const DIGESTIBLE_SECURITY_EVENT_TYPES = [
  "api-key-created",
  "session-refreshed",
  "session-expired",
  "issuer-approved",
] as const;

/**
 * Always delivered immediately, regardless of any setting. The server's own
 * `criticalEventTypes` list is merged in; it can only ever add to this set.
 */
export const CRITICAL_SECURITY_EVENT_TYPES = [
  "api-key-revoked",
  "api-key-rotated",
  "session-started",
  "issuer-suspended",
  "organization-status-changed",
] as const;

export const SECURITY_EVENT_TYPE_LABELS: Record<string, string> = {
  "api-key-created": "API key created",
  "session-refreshed": "Session refreshed",
  "session-expired": "Session expired",
  "issuer-approved": "Issuer approved",
  "api-key-revoked": "API key revoked",
  "api-key-rotated": "API key rotated",
  "session-started": "New sign-in session",
  "issuer-suspended": "Issuer suspended",
  "organization-status-changed": "Organization status changed",
};

/** Channels this client can label (mirrors REMINDER_CHANNELS: email delivery does not exist in the API). */
export const KNOWN_DIGEST_CHANNELS = ["in-app", "webhook"] as const;
export const DIGEST_CHANNEL_LABELS: Record<(typeof KNOWN_DIGEST_CHANNELS)[number], string> = {
  "in-app": "In-app inbox",
  webhook: "Webhook",
};

export const DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

const eventType = z.string().regex(/^[a-z0-9-]{1,64}$/);
const deliveryTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const notificationDigestSettingsSchema = z
  .object({
    schemaVersion: z.literal(NOTIFICATION_DIGEST_SCHEMA_VERSION),
    userId: z.string().min(1).max(128),
    /** Optimistic-concurrency version; must be echoed back on update. */
    version: z.number().int().nonnegative(),
    frequency: z.enum(DIGEST_FREQUENCIES),
    /** Local wall-clock time in `timeZone`, 24h "HH:MM". */
    deliveryTime,
    /** ISO weekday, 1 = Monday … 7 = Sunday; set only for weekly digests. */
    dayOfWeek: z.number().int().min(1).max(7).nullable(),
    timeZone: z.string().refine(isValidIanaTimeZone, "Unknown IANA time zone"),
    channel: z.string().min(1).max(32),
    supportedChannels: z.array(z.string().min(1).max(32)).max(16),
    digestEventTypes: z.array(eventType).max(64),
    criticalEventTypes: z.array(eventType).max(64),
  })
  .strict();

export type NotificationDigestSettings = z.infer<typeof notificationDigestSettingsSchema>;

export interface NotificationDigestSettingsUpdate {
  schemaVersion: typeof NOTIFICATION_DIGEST_SCHEMA_VERSION;
  /** The version the edit was based on; a mismatch must yield 409. */
  version: number;
  frequency: DigestFrequency;
  deliveryTime: string;
  dayOfWeek: number | null;
  timeZone: string;
  channel: string;
  digestEventTypes: string[];
}

export type ParseDigestSettingsResult =
  | { ok: true; settings: NotificationDigestSettings }
  | { ok: false; reason: "unsupported_version" | "invalid_response" | "other_user" };

/** Validates a server response; settings for any user other than the viewer are rejected. */
export function parseNotificationDigestSettings(raw: unknown, viewerUserId: string): ParseDigestSettingsResult {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    (raw as { schemaVersion: unknown }).schemaVersion !== NOTIFICATION_DIGEST_SCHEMA_VERSION
  ) {
    return { ok: false, reason: "unsupported_version" };
  }
  const parsed = notificationDigestSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid_response" };
  if (parsed.data.userId !== viewerUserId) return { ok: false, reason: "other_user" };
  return { ok: true, settings: parsed.data };
}

/** Every type that must be delivered immediately: client list ∪ server list. */
export function criticalEventTypesFor(settings: Pick<NotificationDigestSettings, "criticalEventTypes">): string[] {
  return [...new Set<string>([...CRITICAL_SECURITY_EVENT_TYPES, ...settings.criticalEventTypes])];
}

/** A type may be digested only if this client knows it as digestible AND nobody declares it critical. */
export function isDigestibleEventType(type: string, critical: readonly string[]): boolean {
  return (DIGESTIBLE_SECURITY_EVENT_TYPES as readonly string[]).includes(type) && !critical.includes(type);
}

export type DigestValidationError =
  | "unsupported_frequency"
  | "invalid_delivery_time"
  | "day_of_week_required"
  | "day_of_week_not_allowed"
  | "invalid_time_zone"
  | "unsupported_channel"
  | "critical_event_in_digest"
  | "unknown_event_in_digest"
  | "invalid_version";

/**
 * Client-side gate before any save: returns every problem found. A payload
 * with any error is never sent. The critical-event rule here does not
 * replace server enforcement.
 */
export function validateDigestSettingsUpdate(
  update: NotificationDigestSettingsUpdate,
  context: { supportedChannels: readonly string[]; criticalEventTypes: readonly string[] },
): DigestValidationError[] {
  const errors: DigestValidationError[] = [];
  if (!(DIGEST_FREQUENCIES as readonly string[]).includes(update.frequency)) errors.push("unsupported_frequency");
  if (!deliveryTime.safeParse(update.deliveryTime).success) errors.push("invalid_delivery_time");
  if (update.frequency === "weekly") {
    if (update.dayOfWeek === null || !Number.isInteger(update.dayOfWeek) || update.dayOfWeek < 1 || update.dayOfWeek > 7) {
      errors.push("day_of_week_required");
    }
  } else if (update.dayOfWeek !== null) {
    errors.push("day_of_week_not_allowed");
  }
  if (!isValidIanaTimeZone(update.timeZone)) errors.push("invalid_time_zone");
  if (
    !context.supportedChannels.includes(update.channel) ||
    !(KNOWN_DIGEST_CHANNELS as readonly string[]).includes(update.channel)
  ) {
    errors.push("unsupported_channel");
  }
  const critical = new Set<string>([...CRITICAL_SECURITY_EVENT_TYPES, ...context.criticalEventTypes]);
  if (update.digestEventTypes.some((type) => critical.has(type))) errors.push("critical_event_in_digest");
  if (
    update.digestEventTypes.some(
      (type) => !critical.has(type) && !(DIGESTIBLE_SECURITY_EVENT_TYPES as readonly string[]).includes(type),
    )
  ) {
    errors.push("unknown_event_in_digest");
  }
  if (!Number.isInteger(update.version) || update.version < 0) errors.push("invalid_version");
  return errors;
}

export type NotificationDigestSettingsLoader = (signal: AbortSignal) => Promise<unknown>;
/** Must reject with ApiConflictError (or ApiError 409) when `version` is stale. */
export type NotificationDigestSettingsSaver = (
  update: NotificationDigestSettingsUpdate,
  signal: AbortSignal,
) => Promise<unknown>;
