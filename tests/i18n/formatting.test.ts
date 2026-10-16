/**
 * Locale-aware formatting helpers.
 *
 * Every assertion pins an explicit locale, so these tests are independent of
 * the runtime's ambient locale — which is the same property the helpers give
 * the app.
 */

import {
  DEFAULT_LOCALE,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDateTimeWithZone,
  formatList,
  formatNumber,
  formatPlural,
  formatRelativeTime,
  formatTime,
  resolveLocale,
  selectPlural,
} from "@/lib/i18n";

const MOMENT = new Date("2026-08-28T14:37:52.000Z");

describe("dates and times", () => {
  it("formats for an explicit locale rather than the runtime default", () => {
    expect(formatDate(MOMENT, "en-US")).not.toBe(formatDate(MOMENT, "de-DE"));
    expect(formatDate("2026-08-28T00:00:00.000Z", "en-US")).toContain("2026");
  });

  it("accepts a Date, an ISO string or an epoch number interchangeably", () => {
    expect(formatDate(MOMENT, "en-US")).toBe(formatDate(MOMENT.toISOString(), "en-US"));
    expect(formatDate(MOMENT, "en-US")).toBe(formatDate(MOMENT.getTime(), "en-US"));
  });

  it("formats a date range as one locale phrase, not two dates joined by 'to'", () => {
    const range = formatDateRange(
      "2026-01-03T00:00:00.000Z",
      "2026-01-09T00:00:00.000Z",
      "en-US",
    );
    expect(range).not.toContain(" to ");
    // An en dash is the locale's own range connector; the app never supplies one.
    expect(range).toMatch(/[–-]/);
    expect(formatDateRange("2026-01-03T00:00:00.000Z", "2026-01-09T00:00:00.000Z", "de-DE")).not.toBe(
      range,
    );
  });

  it("renders an unparseable value as-is instead of throwing", () => {
    // These formatters take API data. A formatter that throws takes the
    // whole render down with it.
    expect(() => formatDate("not-a-date", "en-US")).not.toThrow();
    expect(formatDate("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatDateTime("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatTime("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatRelativeTime("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatDateRange("not-a-date", "also-not", "en-US")).toBe("not-a-date also-not");
  });

  it("formats a time without a date component", () => {
    expect(formatTime(MOMENT, "en-US")).not.toContain("2026");
    expect(formatDateTime(MOMENT, "en-US")).toContain("2026");
  });
});

describe("timezone-disclosing date/time (#151)", () => {
  it("appends the timezone abbreviation to the exact value", () => {
    const withZone = formatDateTimeWithZone(MOMENT, "en-US", "America/Los_Angeles");
    // PDT in August (DST) — the exact abbreviation is locale/ICU-version
    // dependent, but *some* non-date, non-time trailing token must appear.
    expect(withZone).toMatch(/[A-Z]{2,5}$/);
    expect(withZone).toContain("2026");
  });

  it("resolves the same instant to different wall-clock times in different zones, each with its own zone label", () => {
    const losAngeles = formatDateTimeWithZone(MOMENT, "en-US", "America/Los_Angeles");
    const tokyo = formatDateTimeWithZone(MOMENT, "en-US", "Asia/Tokyo");
    expect(losAngeles).not.toBe(tokyo);
  });

  it("disambiguates a DST fall-back hour that formatDateTime alone cannot", () => {
    // 2026-11-01 01:30 America/Los_Angeles is ambiguous — it occurs twice,
    // once in PDT and once in PST, an hour apart. The UTC instant is
    // unambiguous; the timezone-qualified label is what tells a reader
    // which of the two 1:30 AMs this is.
    const beforeFallBack = new Date("2026-11-01T08:30:00.000Z"); // 01:30 PDT
    const afterFallBack = new Date("2026-11-01T09:30:00.000Z"); // 01:30 PST
    const before = formatDateTimeWithZone(beforeFallBack, "en-US", "America/Los_Angeles");
    const after = formatDateTimeWithZone(afterFallBack, "en-US", "America/Los_Angeles");
    expect(before).not.toBe(after);
    expect(before).toContain("1:30");
    expect(after).toContain("1:30");
  });

  it("crosses a day boundary correctly across timezones (UTC midnight is not local midnight)", () => {
    const utcMidnight = new Date("2026-03-15T00:00:00.000Z");
    const tokyo = formatDateTimeWithZone(utcMidnight, "en-US", "Asia/Tokyo");
    const losAngeles = formatDateTimeWithZone(utcMidnight, "en-US", "America/Los_Angeles");
    // Tokyo (UTC+9) has already crossed into the 15th; Los Angeles (UTC-7/8)
    // has not yet reached it — the same instant, two different calendar days.
    expect(tokyo).toContain("15");
    expect(losAngeles).toContain("14");
  });

  it("falls back to the runtime timezone when none is given, without throwing", () => {
    expect(() => formatDateTimeWithZone(MOMENT, "en-US")).not.toThrow();
    expect(formatDateTimeWithZone(MOMENT, "en-US")).toContain("2026");
  });

  it("renders an unparseable value as-is instead of throwing", () => {
    expect(() => formatDateTimeWithZone("not-a-date", "en-US")).not.toThrow();
    expect(formatDateTimeWithZone("not-a-date", "en-US")).toBe("not-a-date");
  });
});

describe("explicit time zone", () => {
  it("renders a different wall-clock time for a different zone, same instant", () => {
    const tokyo = formatTime(MOMENT, "en-US", { timeZone: "Asia/Tokyo" });
    const losAngeles = formatTime(MOMENT, "en-US", { timeZone: "America/Los_Angeles" });
    expect(tokyo).not.toBe(losAngeles);
  });

  it("is a no-op omitted or passed an empty options object (backward compatible with two-argument callers)", () => {
    expect(formatDate(MOMENT, "en-US", {})).toBe(formatDate(MOMENT, "en-US"));
    expect(formatDateTime(MOMENT, "en-US", {})).toBe(formatDateTime(MOMENT, "en-US"));
    expect(formatTime(MOMENT, "en-US", {})).toBe(formatTime(MOMENT, "en-US"));
  });

  it("applies to formatDate and formatDateTime as well as formatTime", () => {
    // A moment just after midnight UTC: still the 28th in UTC but the 27th
    // several hours west, so the *date* itself differs by zone, not only
    // the time-of-day component.
    const nearMidnightUtc = new Date("2026-08-28T02:00:00.000Z");
    expect(formatDate(nearMidnightUtc, "en-US", { timeZone: "UTC" })).not.toBe(
      formatDate(nearMidnightUtc, "en-US", { timeZone: "Pacific/Honolulu" }),
    );
    expect(formatDateTime(MOMENT, "en-US", { timeZone: "UTC" })).not.toBe(
      formatDateTime(MOMENT, "en-US", { timeZone: "Pacific/Honolulu" }),
    );
  });

  it("still renders an unparseable value as-is with a time zone option present", () => {
    expect(formatDateTime("not-a-date", "en-US", { timeZone: "UTC" })).toBe("not-a-date");
  });
});

describe("relative time", () => {
  const now = new Date("2026-08-28T14:40:00.000Z");

  it("produces a whole phrase, with the unit chosen from the magnitude", () => {
    expect(formatRelativeTime(new Date("2026-08-28T14:38:00.000Z"), "en-US", now)).toBe(
      "2 minutes ago",
    );
    expect(formatRelativeTime(new Date("2026-08-28T12:40:00.000Z"), "en-US", now)).toBe(
      "2 hours ago",
    );
    expect(formatRelativeTime(new Date("2026-08-26T14:40:00.000Z"), "en-US", now)).toBe(
      "2 days ago",
    );
  });

  it("handles the singular form without the caller testing count === 1", () => {
    expect(formatRelativeTime(new Date("2026-08-28T14:39:00.000Z"), "en-US", now)).toBe(
      "1 minute ago",
    );
  });

  it("handles future times and 'now'", () => {
    expect(formatRelativeTime(new Date("2026-08-28T14:45:00.000Z"), "en-US", now)).toBe(
      "in 5 minutes",
    );
    expect(formatRelativeTime(now, "en-US", now)).toBe("now");
  });

  it("is locale-aware", () => {
    expect(formatRelativeTime(new Date("2026-08-28T14:38:00.000Z"), "de-DE", now)).not.toBe(
      formatRelativeTime(new Date("2026-08-28T14:38:00.000Z"), "en-US", now),
    );
  });
});

describe("numbers and lists", () => {
  it("groups numbers for the locale", () => {
    expect(formatNumber(1234567.5, "en-US")).toBe("1,234,567.5");
    expect(formatNumber(1234567.5, "de-DE")).toBe("1.234.567,5");
  });

  it("formats a list with the locale's own separator and conjunction", () => {
    expect(formatList(["API", "database", "indexer"], "en-US")).toBe(
      "API, database, and indexer",
    );
    expect(formatList(["API", "database"], "en-US", "disjunction")).toBe("API or database");
  });
});

describe("plural-sensitive text", () => {
  const forms = { one: "{count} payment", other: "{count} payments" };

  it("selects by CLDR plural category, not by count === 1", () => {
    expect(selectPlural(1, forms, "en-US")).toBe("{count} payment");
    expect(selectPlural(0, forms, "en-US")).toBe("{count} payments");
    expect(selectPlural(2, forms, "en-US")).toBe("{count} payments");
  });

  it("uses a language's extra categories when the catalog provides them", () => {
    const polish = { one: "jeden", few: "kilka", many: "wiele", other: "inne" };
    expect(selectPlural(1, polish, "pl-PL")).toBe("jeden");
    expect(selectPlural(3, polish, "pl-PL")).toBe("kilka");
    expect(selectPlural(25, polish, "pl-PL")).toBe("wiele");
  });

  it("falls back to `other` for a category the catalog omits", () => {
    expect(selectPlural(3, { other: "inne" }, "pl-PL")).toBe("inne");
  });

  it("interpolates and formats the count, so the caller never concatenates", () => {
    expect(formatPlural(1, forms, "en-US")).toBe("1 payment");
    expect(formatPlural(1234, forms, "en-US")).toBe("1,234 payments");
    expect(formatPlural(1234, forms, "de-DE")).toBe("1.234 payments");
  });
});

describe("locale resolution", () => {
  it("falls back to the default rather than passing an unknown tag to Intl", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("xx-YY")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(DEFAULT_LOCALE)).toBe(DEFAULT_LOCALE);
  });

  it("never resolves to the pseudo-locale, which is a test locale only", () => {
    expect(resolveLocale("en-XA")).toBe(DEFAULT_LOCALE);
  });
});
