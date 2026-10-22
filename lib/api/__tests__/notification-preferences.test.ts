import {
  resolveEffectivePreference,
  resolveAllEffectivePreferences,
  applyPreferencesUpdate,
  describePreferencesChange,
  defaultUserNotificationPreferences,
  defaultOrganizationNotificationPolicy,
  NOTIFICATION_CATEGORIES,
  type UserNotificationPreferences,
  type OrganizationNotificationPolicy,
} from "../notification-preferences";

describe("notification preferences: defaults", () => {
  it("every category defaults to EMAIL+IN_APP on, WEBHOOK_CALLBACK off", () => {
    const user = defaultUserNotificationPreferences();
    for (const category of user.categories) {
      expect(category.channels.EMAIL).toBe(true);
      expect(category.channels.IN_APP).toBe(true);
      expect(category.channels.WEBHOOK_CALLBACK).toBe(false);
    }
  });

  it("resolves all five categories with no org overrides beyond the baked-in mandatory ones", () => {
    const user = defaultUserNotificationPreferences();
    const org: OrganizationNotificationPolicy = { mandatoryCategories: [], mandatoryChannels: {} };
    const effective = resolveAllEffectivePreferences(user, org);
    expect(effective.map((e) => e.category)).toEqual(NOTIFICATION_CATEGORIES);
  });
});

describe("notification preferences: mandatory categories", () => {
  it("SESSION and KEY are mandatory even with an empty org policy", () => {
    const user = defaultUserNotificationPreferences();
    const org: OrganizationNotificationPolicy = { mandatoryCategories: [], mandatoryChannels: {} };

    const session = resolveEffectivePreference("SESSION", user, org);
    const key = resolveEffectivePreference("KEY", user, org);
    expect(session.mandatory).toBe(true);
    expect(key.mandatory).toBe(true);
  });

  it("a mandatory category's required channel stays on even if the user turned it off", () => {
    const user: UserNotificationPreferences = {
      ...defaultUserNotificationPreferences(),
      categories: defaultUserNotificationPreferences().categories.map((c) =>
        c.category === "SESSION" ? { ...c, channels: { EMAIL: false, IN_APP: false, WEBHOOK_CALLBACK: false } } : c,
      ),
    };
    const org = defaultOrganizationNotificationPolicy();

    const effective = resolveEffectivePreference("SESSION", user, org);
    expect(effective.mandatory).toBe(true);
    expect(effective.channels.EMAIL).toBe(true);
    expect(effective.channels.IN_APP).toBe(true);
    expect(effective.channelSource.EMAIL).toBe("org-mandatory");
  });

  it("org-added mandatory categories (e.g. GOVERNANCE) also cannot be disabled", () => {
    const user: UserNotificationPreferences = {
      ...defaultUserNotificationPreferences(),
      categories: defaultUserNotificationPreferences().categories.map((c) =>
        c.category === "GOVERNANCE" ? { ...c, channels: { EMAIL: false, IN_APP: false, WEBHOOK_CALLBACK: false } } : c,
      ),
    };
    const org = defaultOrganizationNotificationPolicy();
    const effective = resolveEffectivePreference("GOVERNANCE", user, org);
    expect(effective.mandatory).toBe(true);
  });

  it("a non-mandatory category (PROOF, WEBHOOK) honors the user's off preference", () => {
    const user: UserNotificationPreferences = {
      ...defaultUserNotificationPreferences(),
      categories: defaultUserNotificationPreferences().categories.map((c) =>
        c.category === "PROOF" ? { ...c, channels: { EMAIL: false, IN_APP: false, WEBHOOK_CALLBACK: false } } : c,
      ),
    };
    const org: OrganizationNotificationPolicy = { mandatoryCategories: [], mandatoryChannels: {} };
    const effective = resolveEffectivePreference("PROOF", user, org);
    expect(effective.mandatory).toBe(false);
    expect(effective.channels.EMAIL).toBe(false);
    expect(effective.channelSource.EMAIL).toBe("user");
  });
});

describe("notification preferences: unknown categories fail closed", () => {
  it("treats an unrecognized category as mandatory and fully enabled, not dropped", () => {
    const user = defaultUserNotificationPreferences();
    const org = defaultOrganizationNotificationPolicy();
    const effective = resolveEffectivePreference("SOME_FUTURE_CATEGORY", user, org);

    expect(effective.mandatory).toBe(true);
    expect(effective.channels.EMAIL).toBe(true);
    expect(effective.channels.IN_APP).toBe(true);
    expect(effective.channels.WEBHOOK_CALLBACK).toBe(true);
  });
});

describe("notification preferences: deterministic merge precedence", () => {
  it("org-mandatory beats user preference, which beats default, for every channel", () => {
    const user: UserNotificationPreferences = {
      ...defaultUserNotificationPreferences(),
      categories: [
        { category: "WEBHOOK", channels: { EMAIL: false, IN_APP: true, WEBHOOK_CALLBACK: true } },
      ],
    };
    const org: OrganizationNotificationPolicy = {
      mandatoryCategories: ["WEBHOOK"],
      mandatoryChannels: { WEBHOOK: ["EMAIL"] },
    };

    const effective = resolveEffectivePreference("WEBHOOK", user, org);
    // EMAIL forced on by org despite user "false".
    expect(effective.channels.EMAIL).toBe(true);
    expect(effective.channelSource.EMAIL).toBe("org-mandatory");
    // IN_APP/WEBHOOK_CALLBACK follow the user's explicit preference.
    expect(effective.channels.IN_APP).toBe(true);
    expect(effective.channelSource.IN_APP).toBe("user");
    expect(effective.channels.WEBHOOK_CALLBACK).toBe(true);
    expect(effective.channelSource.WEBHOOK_CALLBACK).toBe("user");
  });

  it("is a pure function: the same inputs always produce the same effective preference", () => {
    const user = defaultUserNotificationPreferences();
    const org = defaultOrganizationNotificationPolicy();
    const first = resolveEffectivePreference("PROOF", user, org);
    const second = resolveEffectivePreference("PROOF", user, org);
    expect(first).toEqual(second);
  });
});

describe("notification preferences: conflicts", () => {
  it("rejects a draft with a duplicate category entry", () => {
    const current = defaultUserNotificationPreferences();
    const draft: UserNotificationPreferences = {
      ...current,
      categories: [...current.categories, current.categories[0]],
    };
    const outcome = applyPreferencesUpdate({ current, draft, expectedVersion: current.preferencesVersion });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("invalid");
    }
  });

  it("rejects a draft referencing an unknown category", () => {
    const current = defaultUserNotificationPreferences();
    const draft: UserNotificationPreferences = {
      ...current,
      categories: [
        ...current.categories,
        { category: "NOT_REAL" as never, channels: { EMAIL: true, IN_APP: true, WEBHOOK_CALLBACK: false } },
      ],
    };
    const outcome = applyPreferencesUpdate({ current, draft, expectedVersion: current.preferencesVersion });
    expect(outcome.ok).toBe(false);
  });
});

describe("notification preferences: stale writes", () => {
  it("rejects an update based on an outdated version", () => {
    const current = { ...defaultUserNotificationPreferences(), preferencesVersion: 3 };
    const draft = defaultUserNotificationPreferences();
    const outcome = applyPreferencesUpdate({ current, draft, expectedVersion: 2 });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("stale");
    }
  });

  it("accepts an update that matches the current version and bumps it", () => {
    const current = defaultUserNotificationPreferences();
    const draft = defaultUserNotificationPreferences();
    const outcome = applyPreferencesUpdate({ current, draft, expectedVersion: current.preferencesVersion });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.preferences.preferencesVersion).toBe(current.preferencesVersion + 1);
    }
  });
});

describe("notification preferences: audit trail", () => {
  it("describes exactly the channels that changed", () => {
    const previous = defaultUserNotificationPreferences();
    const next: UserNotificationPreferences = {
      ...previous,
      categories: previous.categories.map((c) =>
        c.category === "PROOF" ? { ...c, channels: { ...c.channels, EMAIL: false } } : c,
      ),
    };

    const lines = describePreferencesChange(previous, next);
    expect(lines).toEqual(["PROOF / EMAIL: on -> off"]);
  });

  it("describes no changes as an empty list", () => {
    const current = defaultUserNotificationPreferences();
    expect(describePreferencesChange(current, current)).toEqual([]);
  });
});
