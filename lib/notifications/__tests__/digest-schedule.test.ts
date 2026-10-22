import { isValidIanaTimeZone, nextDigestDelivery, resolveWallTime } from "../digest-schedule";
import { buildDigestPreview } from "../digest-preview";
import { DIGESTIBLE_SECURITY_EVENT_TYPES } from "@/lib/api/notification-digest-settings";

const iso = (instant: number | undefined) => (instant === undefined ? undefined : new Date(instant).toISOString());

describe("isValidIanaTimeZone", () => {
  it.each(["UTC", "Europe/Berlin", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "Asia/Kolkata"])("accepts %s", (zone) => {
    expect(isValidIanaTimeZone(zone)).toBe(true);
  });

  it.each(["", "+01:00", "GMT+1", "Mars/Olympus_Mons", "Europe/", "../etc/passwd", "x".repeat(65), 5])("rejects %p", (zone) => {
    expect(isValidIanaTimeZone(zone)).toBe(false);
  });
});

describe("DST boundaries (America/New_York)", () => {
  it("skipped hour: 02:30 on spring-forward day does not exist and is shifted to 03:30 EDT", () => {
    expect(resolveWallTime({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 }, "America/New_York")).toEqual({
      kind: "skipped",
      instant: Date.UTC(2026, 2, 8, 7, 30),
    });
    const next = nextDigestDelivery(
      { frequency: "daily", deliveryTime: "02:30", dayOfWeek: null, timeZone: "America/New_York" },
      Date.UTC(2026, 2, 8, 5, 0),
    );
    expect(next).toEqual({ instant: Date.UTC(2026, 2, 8, 7, 30), adjustment: "skipped_hour_shifted" });
  });

  it("repeated hour: 01:30 on fall-back day occurs twice and is delivered once, at the first occurrence (EDT)", () => {
    expect(resolveWallTime({ year: 2026, month: 11, day: 1 }, { hour: 1, minute: 30 }, "America/New_York")).toEqual({
      kind: "repeated",
      first: Date.UTC(2026, 10, 1, 5, 30),
      second: Date.UTC(2026, 10, 1, 6, 30),
    });
    const schedule = { frequency: "daily" as const, deliveryTime: "01:30", dayOfWeek: null, timeZone: "America/New_York" };
    expect(nextDigestDelivery(schedule, Date.UTC(2026, 10, 1, 4, 0))).toEqual({
      instant: Date.UTC(2026, 10, 1, 5, 30),
      adjustment: "repeated_hour_first",
    });
    // Between the two occurrences: today's single delivery already happened, so tomorrow's is next.
    expect(iso(nextDigestDelivery(schedule, Date.UTC(2026, 10, 1, 6, 0))?.instant)).toBe("2026-11-02T06:30:00.000Z");
  });

  it("an ordinary time on a DST day is exact", () => {
    expect(
      nextDigestDelivery(
        { frequency: "daily", deliveryTime: "09:00", dayOfWeek: null, timeZone: "America/New_York" },
        Date.UTC(2026, 2, 8, 5, 0),
      ),
    ).toEqual({ instant: Date.UTC(2026, 2, 8, 13, 0), adjustment: "none" });
  });

  it("Europe/London skipped hour at 01:30 on the last Sunday of March", () => {
    expect(resolveWallTime({ year: 2026, month: 3, day: 29 }, { hour: 1, minute: 30 }, "Europe/London").kind).toBe("skipped");
  });
});

describe("midnight and day-of-week boundaries", () => {
  const daily = { frequency: "daily" as const, deliveryTime: "00:00", dayOfWeek: null, timeZone: "UTC" };

  it("boundary: at exactly the delivery instant, that instant is next (inclusive); 1 ms later it is the following day", () => {
    const midnight = Date.UTC(2026, 0, 2);
    expect(nextDigestDelivery(daily, midnight)?.instant).toBe(midnight);
    expect(nextDigestDelivery(daily, midnight + 1)?.instant).toBe(Date.UTC(2026, 0, 3));
    expect(nextDigestDelivery(daily, midnight - 1)?.instant).toBe(midnight);
  });

  it("23:59 rolls to the next day once passed", () => {
    const schedule = { ...daily, deliveryTime: "23:59" };
    expect(iso(nextDigestDelivery(schedule, Date.UTC(2026, 0, 1, 23, 59, 0, 1))?.instant)).toBe("2026-01-02T23:59:00.000Z");
  });

  it("weekly Monday 00:00 in Asia/Tokyo is Sunday 15:00 UTC (local day, not UTC day)", () => {
    const schedule = { frequency: "weekly" as const, deliveryTime: "00:00", dayOfWeek: 1, timeZone: "Asia/Tokyo" };
    // Sunday 2026-01-04 14:59 UTC = Sunday 23:59 in Tokyo.
    expect(iso(nextDigestDelivery(schedule, Date.UTC(2026, 0, 4, 14, 59))?.instant)).toBe("2026-01-04T15:00:00.000Z");
    // Exactly at Monday 00:00 Tokyo.
    expect(iso(nextDigestDelivery(schedule, Date.UTC(2026, 0, 4, 15, 0))?.instant)).toBe("2026-01-04T15:00:00.000Z");
    // One minute later the next is a week away.
    expect(iso(nextDigestDelivery(schedule, Date.UTC(2026, 0, 4, 15, 1))?.instant)).toBe("2026-01-11T15:00:00.000Z");
  });

  it("weekly Sunday is ISO day 7", () => {
    const schedule = { frequency: "weekly" as const, deliveryTime: "12:00", dayOfWeek: 7, timeZone: "UTC" };
    expect(iso(nextDigestDelivery(schedule, Date.UTC(2026, 0, 5))?.instant)).toBe("2026-01-11T12:00:00.000Z");
  });

  it("a time zone change moves the next delivery to that zone's wall clock", () => {
    const now = Date.UTC(2026, 5, 1, 0, 0);
    const berlin = nextDigestDelivery({ ...daily, deliveryTime: "09:00", timeZone: "Europe/Berlin" }, now);
    const tokyo = nextDigestDelivery({ ...daily, deliveryTime: "09:00", timeZone: "Asia/Tokyo" }, now);
    expect(iso(berlin?.instant)).toBe("2026-06-01T07:00:00.000Z");
    expect(iso(tokyo?.instant)).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns null when off or invalid", () => {
    expect(nextDigestDelivery({ ...daily, frequency: "off" }, 0)).toBeNull();
    expect(nextDigestDelivery({ ...daily, timeZone: "Nope/Zone" }, 0)).toBeNull();
    expect(nextDigestDelivery({ ...daily, deliveryTime: "24:00" }, 0)).toBeNull();
    expect(nextDigestDelivery({ frequency: "weekly", deliveryTime: "09:00", dayOfWeek: null, timeZone: "UTC" }, 0)).toBeNull();
  });
});

describe("digest preview redaction", () => {
  const sensitive = [
    /eyJ[A-Za-z0-9_-]+\./, // JWT
    /\b[0-9a-f]{16,}\b/i, // long hex (keys, hashes)
    /\bG[A-Z2-7]{55}\b/, // Stellar public key
    /\bS[A-Z2-7]{55}\b/, // Stellar secret seed
    /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
    /\b\d{5,}\b/, // long numbers (amounts, ids)
    /(sk|pk)_(live|test)_/i, // API key prefixes
  ];

  it("contains only synthetic, redacted sample text for every digestible type and unknown types", () => {
    const items = buildDigestPreview([...DIGESTIBLE_SECURITY_EVENT_TYPES, "brand-new-event"]);
    expect(items).toHaveLength(DIGESTIBLE_SECURITY_EVENT_TYPES.length + 1);
    for (const item of items) {
      for (const pattern of sensitive) {
        expect(item.sample).not.toMatch(pattern);
      }
    }
    expect(items[items.length - 1].sample).toMatch(/details hidden in preview/);
  });
});
