/**
 * Synthetic notification digest settings fixtures (#269). User ids are fake;
 * no email address, token, wallet or claim value appears anywhere.
 */

import type { NotificationDigestSettings } from "@/lib/api/notification-digest-settings";

export const SYNTHETIC_USER_ID = "user-synthetic-0001";
export const OTHER_SYNTHETIC_USER_ID = "user-synthetic-0002";

export function makeDigestSettings(overrides: Partial<NotificationDigestSettings> = {}): NotificationDigestSettings {
  return {
    schemaVersion: 1,
    userId: SYNTHETIC_USER_ID,
    version: 3,
    frequency: "daily",
    deliveryTime: "09:00",
    dayOfWeek: null,
    timeZone: "UTC",
    channel: "in-app",
    supportedChannels: ["in-app"],
    digestEventTypes: ["api-key-created", "session-refreshed"],
    criticalEventTypes: [],
    ...overrides,
  };
}
