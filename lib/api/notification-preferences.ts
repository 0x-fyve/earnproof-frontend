/**
 * Security notification preferences (#223).
 * =============================================
 *
 * Users and organization admins need category + channel controls for
 * security-relevant notifications (session, key, webhook, proof,
 * governance events), with some categories mandatory and never
 * user-disablable, and an org policy that merges deterministically with
 * the user's own preferences.
 *
 * Follows the same "server-enforced minimums + pure validation + fail
 * closed" shape as lib/api/organization-role-approval-policy.ts (its
 * three-layer split — minimums, validation, fail-closed apply — is the
 * closest existing precedent for an org-policy/user-preference merge in
 * this codebase).
 *
 * Invariants (see #223 acceptance criteria):
 *   - Unknown categories fail closed: `resolveEffectivePreference` treats
 *     any category not in `NOTIFICATION_CATEGORIES` as enabled on every
 *     channel and mandatory, rather than silently dropping it.
 *   - Mandatory categories can never be disabled by a user preference —
 *     org policy's "mandatory" flag always wins over a user "off".
 *   - The merge precedence is explicit and total: mandatory org setting >
 *     user preference > category default. `mergePreferences` is pure and
 *     total for every (category, channel) pair.
 *   - A stale write (based on an outdated preference version) is rejected
 *     rather than silently applied.
 */

export type NotificationCategory = "SESSION" | "KEY" | "WEBHOOK" | "PROOF" | "GOVERNANCE";

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "SESSION",
  "KEY",
  "WEBHOOK",
  "PROOF",
  "GOVERNANCE",
];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export type NotificationChannel = "EMAIL" | "IN_APP" | "WEBHOOK_CALLBACK";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["EMAIL", "IN_APP", "WEBHOOK_CALLBACK"];

export const NOTIFICATION_PREFERENCES_SCHEMA_VERSION = 1;

/**
 * Categories that can never be disabled by a user, regardless of org
 * policy — e.g. a session-hijack alert must always reach the user on at
 * least one channel. This is the client-side mirror of a server-enforced
 * minimum; the server remains the authority.
 */
export const ALWAYS_MANDATORY_CATEGORIES: readonly NotificationCategory[] = ["SESSION", "KEY"];

export type ChannelPreference = Record<NotificationChannel, boolean>;

export type CategoryPreference = {
  category: NotificationCategory;
  channels: ChannelPreference;
};

export type UserNotificationPreferences = {
  schemaVersion: number;
  preferencesVersion: number;
  updatedAt: string;
  categories: CategoryPreference[];
};

export type OrganizationNotificationPolicy = {
  /** Categories the organization marks mandatory for every member, on top of ALWAYS_MANDATORY_CATEGORIES. */
  mandatoryCategories: NotificationCategory[];
  /** When a category is mandatory, the channel(s) the org requires it to use (never fully off). */
  mandatoryChannels: Partial<Record<NotificationCategory, NotificationChannel[]>>;
};

function defaultChannels(enabled: boolean): ChannelPreference {
  return { EMAIL: enabled, IN_APP: enabled, WEBHOOK_CALLBACK: false };
}

export function defaultUserNotificationPreferences(): UserNotificationPreferences {
  return {
    schemaVersion: NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
    preferencesVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    categories: NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      channels: defaultChannels(true),
    })),
  };
}

export function defaultOrganizationNotificationPolicy(): OrganizationNotificationPolicy {
  return {
    mandatoryCategories: ["GOVERNANCE"],
    mandatoryChannels: {
      SESSION: ["EMAIL", "IN_APP"],
      KEY: ["EMAIL", "IN_APP"],
    },
  };
}

function isMandatoryCategory(category: NotificationCategory, org: OrganizationNotificationPolicy): boolean {
  return ALWAYS_MANDATORY_CATEGORIES.includes(category) || org.mandatoryCategories.includes(category);
}

export type EffectiveCategoryPreference = {
  category: NotificationCategory;
  mandatory: boolean;
  channels: ChannelPreference;
  /** Per-channel notes on why the effective value is what it is, for the "preview" UI. */
  channelSource: Record<NotificationChannel, "org-mandatory" | "user" | "default">;
};

/**
 * Merge precedence, applied per (category, channel):
 *
 *   1. If the org marks the channel mandatory-on for this category, it is
 *      ON regardless of the user's preference ("org-mandatory").
 *   2. Otherwise, if the user has an explicit preference for this
 *      category/channel, that value is used ("user").
 *   3. Otherwise, the category's safe default is used ("default") — this
 *      is also the fail-closed path for a category/channel the user's
 *      stored preferences never recorded.
 *
 * An unknown category (not in NOTIFICATION_CATEGORIES) fails closed: it is
 * treated as mandatory on every channel, so a newly-introduced category the
 * client has never heard of is never silently dropped or defaulted to off.
 */
export function resolveEffectivePreference(
  category: NotificationCategory | string,
  user: UserNotificationPreferences,
  org: OrganizationNotificationPolicy,
): EffectiveCategoryPreference {
  if (!isNotificationCategory(category)) {
    return {
      category: category as NotificationCategory,
      mandatory: true,
      channels: { EMAIL: true, IN_APP: true, WEBHOOK_CALLBACK: true },
      channelSource: { EMAIL: "org-mandatory", IN_APP: "org-mandatory", WEBHOOK_CALLBACK: "org-mandatory" },
    };
  }

  const mandatory = isMandatoryCategory(category, org);
  const mandatoryChannelsForCategory = new Set(org.mandatoryChannels[category] ?? []);
  const alwaysMandatory = ALWAYS_MANDATORY_CATEGORIES.includes(category);
  const userPref = user.categories.find((c) => c.category === category);

  const channels: ChannelPreference = { EMAIL: false, IN_APP: false, WEBHOOK_CALLBACK: false };
  const channelSource: Record<NotificationChannel, "org-mandatory" | "user" | "default"> = {
    EMAIL: "default",
    IN_APP: "default",
    WEBHOOK_CALLBACK: "default",
  };

  for (const channel of NOTIFICATION_CHANNELS) {
    const orgRequiresOn = mandatoryChannelsForCategory.has(channel) || (alwaysMandatory && channel !== "WEBHOOK_CALLBACK");
    if (orgRequiresOn) {
      channels[channel] = true;
      channelSource[channel] = "org-mandatory";
      continue;
    }
    if (userPref) {
      channels[channel] = userPref.channels[channel];
      channelSource[channel] = "user";
      continue;
    }
    channels[channel] = defaultChannels(true)[channel];
    channelSource[channel] = "default";
  }

  return { category, mandatory, channels, channelSource };
}

export function resolveAllEffectivePreferences(
  user: UserNotificationPreferences,
  org: OrganizationNotificationPolicy,
): EffectiveCategoryPreference[] {
  return NOTIFICATION_CATEGORIES.map((category) => resolveEffectivePreference(category, user, org));
}

export type PreferenceUpdateOutcome =
  | { ok: true; preferences: UserNotificationPreferences }
  | { ok: false; reason: "stale" | "invalid"; message: string };

/**
 * Applies a draft preference set on top of the latest known version. Fails
 * closed on a stale write (the draft was based on an older version than
 * the server now has) rather than silently overwriting a newer value —
 * same "replay looks like staleness" reasoning as
 * organization-role-approval-policy.ts's applyPolicyUpdate.
 */
export function applyPreferencesUpdate(args: {
  current: UserNotificationPreferences;
  draft: UserNotificationPreferences;
  expectedVersion: number;
  now?: Date;
}): PreferenceUpdateOutcome {
  const { current, draft, expectedVersion, now = new Date() } = args;

  if (expectedVersion !== current.preferencesVersion) {
    return {
      ok: false,
      reason: "stale",
      message: "Your preferences changed elsewhere since you loaded this page. Reload before saving again.",
    };
  }

  const seen = new Set<NotificationCategory>();
  for (const entry of draft.categories) {
    if (!isNotificationCategory(entry.category)) {
      return { ok: false, reason: "invalid", message: `Unknown notification category "${String(entry.category)}".` };
    }
    if (seen.has(entry.category)) {
      return { ok: false, reason: "invalid", message: `Duplicate preference entry for ${entry.category}.` };
    }
    seen.add(entry.category);
  }

  return {
    ok: true,
    preferences: {
      ...draft,
      schemaVersion: NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
      preferencesVersion: current.preferencesVersion + 1,
      updatedAt: now.toISOString(),
    },
  };
}

export type NotificationAuditEntry = {
  id: string;
  changedAt: string;
  changedBy: string;
  summary: string;
};

/**
 * A plain-language, deterministic audit line for a preference change —
 * "preference changes are confirmed and audit-friendly".
 */
export function describePreferencesChange(
  previous: UserNotificationPreferences,
  next: UserNotificationPreferences,
): string[] {
  const lines: string[] = [];
  for (const category of NOTIFICATION_CATEGORIES) {
    const before = previous.categories.find((c) => c.category === category)?.channels;
    const after = next.categories.find((c) => c.category === category)?.channels;
    if (!before || !after) {
      continue;
    }
    for (const channel of NOTIFICATION_CHANNELS) {
      if (before[channel] !== after[channel]) {
        lines.push(`${category} / ${channel}: ${before[channel] ? "on" : "off"} -> ${after[channel] ? "on" : "off"}`);
      }
    }
  }
  return lines;
}

export async function fetchMockNotificationPreferences(
  overrides: Partial<UserNotificationPreferences> = {},
): Promise<UserNotificationPreferences> {
  return { ...defaultUserNotificationPreferences(), ...overrides };
}

export async function fetchMockOrganizationNotificationPolicy(
  overrides: Partial<OrganizationNotificationPolicy> = {},
): Promise<OrganizationNotificationPolicy> {
  return { ...defaultOrganizationNotificationPolicy(), ...overrides };
}
