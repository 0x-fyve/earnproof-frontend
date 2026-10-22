import {
  CRITICAL_SECURITY_EVENT_TYPES,
  DIGESTIBLE_SECURITY_EVENT_TYPES,
  criticalEventTypesFor,
  isDigestibleEventType,
  parseNotificationDigestSettings,
  validateDigestSettingsUpdate,
  type NotificationDigestSettingsUpdate,
} from "../notification-digest-settings";
import {
  OTHER_SYNTHETIC_USER_ID,
  SYNTHETIC_USER_ID,
  makeDigestSettings,
} from "@/tests/fixtures/notification-digest-fixtures";

const reason = (raw: unknown) => {
  const result = parseNotificationDigestSettings(raw, SYNTHETIC_USER_ID);
  return result.ok ? "ok" : result.reason;
};

function makeUpdate(overrides: Partial<NotificationDigestSettingsUpdate> = {}): NotificationDigestSettingsUpdate {
  return {
    schemaVersion: 1,
    version: 3,
    frequency: "daily",
    deliveryTime: "09:00",
    dayOfWeek: null,
    timeZone: "Europe/Berlin",
    channel: "in-app",
    digestEventTypes: ["api-key-created"],
    ...overrides,
  };
}

const context = { supportedChannels: ["in-app"], criticalEventTypes: [] as string[] };

describe("parseNotificationDigestSettings (#269 proposed contract v1)", () => {
  it("positive: accepts valid settings for the viewer", () => {
    expect(reason(makeDigestSettings())).toBe("ok");
    expect(reason(makeDigestSettings({ frequency: "weekly", dayOfWeek: 7, timeZone: "Asia/Tokyo" }))).toBe("ok");
  });

  it.each([2, "1", null])("negative: schemaVersion %p is unsupported", (schemaVersion) => {
    expect(reason({ ...makeDigestSettings(), schemaVersion })).toBe("unsupported_version");
  });

  it.each([
    ["an invalid time zone", { timeZone: "Mars/Olympus_Mons" }],
    ["a raw offset instead of an IANA zone", { timeZone: "+02:00" }],
    ["24:00", { deliveryTime: "24:00" }],
    ["an unpadded time", { deliveryTime: "9:00" }],
    ["day 0", { dayOfWeek: 0 }],
    ["day 8", { dayOfWeek: 8 }],
    ["an unknown frequency", { frequency: "hourly" }],
    ["a negative version", { version: -1 }],
  ])("negative: rejects %s", (_label, overrides) => {
    expect(reason({ ...makeDigestSettings(), ...overrides })).toBe("invalid_response");
  });

  it("negative: rejects unexpected fields (e.g. a contact address)", () => {
    expect(reason({ ...makeDigestSettings(), email: "someone@example.invalid" })).toBe("invalid_response");
  });

  it("authorization: settings for another user are rejected", () => {
    expect(reason(makeDigestSettings({ userId: OTHER_SYNTHETIC_USER_ID }))).toBe("other_user");
  });
});

describe("critical events are never digestible", () => {
  it("the client critical and digestible lists do not overlap", () => {
    for (const type of CRITICAL_SECURITY_EVENT_TYPES) {
      expect(DIGESTIBLE_SECURITY_EVENT_TYPES as readonly string[]).not.toContain(type);
    }
  });

  it("the server critical list can only add to the client list", () => {
    const merged = criticalEventTypesFor({ criticalEventTypes: ["session-refreshed"] });
    expect(merged).toEqual(expect.arrayContaining([...CRITICAL_SECURITY_EVENT_TYPES, "session-refreshed"]));
    expect(isDigestibleEventType("session-refreshed", merged)).toBe(false);
  });

  it("unknown event types are never digestible", () => {
    expect(isDigestibleEventType("brand-new-event", [])).toBe(false);
  });
});

describe("validateDigestSettingsUpdate (client gate before any save)", () => {
  it("positive: a valid payload has no errors", () => {
    expect(validateDigestSettingsUpdate(makeUpdate(), context)).toEqual([]);
    expect(validateDigestSettingsUpdate(makeUpdate({ frequency: "weekly", dayOfWeek: 1 }), context)).toEqual([]);
    expect(validateDigestSettingsUpdate(makeUpdate({ frequency: "off", digestEventTypes: [] }), context)).toEqual([]);
  });

  it.each(CRITICAL_SECURITY_EVENT_TYPES)("regression: refuses any payload that digests critical type %s", (type) => {
    expect(validateDigestSettingsUpdate(makeUpdate({ digestEventTypes: ["api-key-created", type] }), context)).toContain(
      "critical_event_in_digest",
    );
  });

  it("refuses to digest a type the server declared critical", () => {
    expect(
      validateDigestSettingsUpdate(makeUpdate({ digestEventTypes: ["session-refreshed"] }), {
        ...context,
        criticalEventTypes: ["session-refreshed"],
      }),
    ).toContain("critical_event_in_digest");
  });

  it("refuses unknown event types in the digest", () => {
    expect(validateDigestSettingsUpdate(makeUpdate({ digestEventTypes: ["brand-new-event"] }), context)).toEqual([
      "unknown_event_in_digest",
    ]);
  });

  it("negative: invalid time zone", () => {
    expect(validateDigestSettingsUpdate(makeUpdate({ timeZone: "Not/AZone" }), context)).toEqual(["invalid_time_zone"]);
  });

  it("negative: a channel the server does not support, or one the client does not know", () => {
    expect(validateDigestSettingsUpdate(makeUpdate({ channel: "webhook" }), context)).toEqual(["unsupported_channel"]);
    expect(
      validateDigestSettingsUpdate(makeUpdate({ channel: "carrier-pigeon" }), { ...context, supportedChannels: ["carrier-pigeon"] }),
    ).toEqual(["unsupported_channel"]);
  });

  it("boundary: 00:00 and 23:59 are valid, 24:00 is not", () => {
    expect(validateDigestSettingsUpdate(makeUpdate({ deliveryTime: "00:00" }), context)).toEqual([]);
    expect(validateDigestSettingsUpdate(makeUpdate({ deliveryTime: "23:59" }), context)).toEqual([]);
    expect(validateDigestSettingsUpdate(makeUpdate({ deliveryTime: "24:00" }), context)).toEqual(["invalid_delivery_time"]);
  });

  it("weekly requires a day; other frequencies forbid one", () => {
    expect(validateDigestSettingsUpdate(makeUpdate({ frequency: "weekly", dayOfWeek: null }), context)).toEqual([
      "day_of_week_required",
    ]);
    expect(validateDigestSettingsUpdate(makeUpdate({ frequency: "daily", dayOfWeek: 3 }), context)).toEqual([
      "day_of_week_not_allowed",
    ]);
  });
});
