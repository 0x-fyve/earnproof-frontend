/**
 * Digest delivery scheduling across time zones and DST (#269).
 * See docs/notification-digest-scheduling.md for the documented rules.
 *
 * Intl is used directly here (not through lib/i18n's formatters) because this
 * computes instants, not display strings; nothing here is user-facing text.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** IANA zone names only (e.g. "Europe/Berlin", "UTC"); raw offsets like "+01:00" are rejected. */
export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z_]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

interface WallFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallFields(instant: number, timeZone: string): WallFields {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetMs(instant: number, timeZone: string): number {
  const fields = wallFields(instant, timeZone);
  const asUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

export type WallTimeResolution =
  | { kind: "exact"; instant: number }
  /** Fall-back: the wall time occurs twice; both instants, earliest first. */
  | { kind: "repeated"; first: number; second: number }
  /** Spring-forward: the wall time does not exist; shifted forward by the gap. */
  | { kind: "skipped"; instant: number };

/** Resolves a local wall-clock time on a local date in `timeZone` to UTC instant(s). */
export function resolveWallTime(
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
  timeZone: string,
): WallTimeResolution {
  const naive = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const offsets = new Set([
    offsetMs(naive - DAY_MS, timeZone),
    offsetMs(naive, timeZone),
    offsetMs(naive + DAY_MS, timeZone),
  ]);
  const matches = [...new Set([...offsets].map((offset) => naive - offset))]
    .filter((instant) => {
      const fields = wallFields(instant, timeZone);
      return (
        fields.year === date.year &&
        fields.month === date.month &&
        fields.day === date.day &&
        fields.hour === time.hour &&
        fields.minute === time.minute
      );
    })
    .sort((a, b) => a - b);

  if (matches.length >= 2) return { kind: "repeated", first: matches[0], second: matches[matches.length - 1] };
  if (matches.length === 1) return { kind: "exact", instant: matches[0] };
  // Use the offset in force before the transition: 02:30 in a 02:00→03:00
  // gap becomes 03:30, the same elapsed time after the gap began.
  return { kind: "skipped", instant: naive - offsetMs(naive - DAY_MS, timeZone) };
}

export interface DigestSchedule {
  frequency: "off" | "daily" | "weekly";
  deliveryTime: string;
  /** ISO weekday 1 = Monday … 7 = Sunday, in the schedule's time zone. */
  dayOfWeek: number | null;
  timeZone: string;
}

export interface NextDelivery {
  instant: number;
  adjustment: "none" | "skipped_hour_shifted" | "repeated_hour_first";
}

/**
 * Next digest delivery at or after `now`.
 *
 * - Inclusive: if `now` is exactly a delivery instant, that instant is next.
 * - Days and weekdays are evaluated in the schedule's time zone, so "Monday
 *   00:00" means local midnight even when it is still Sunday in UTC.
 * - Skipped local time (spring forward): delivered at the shifted time after
 *   the gap (e.g. 02:30 → 03:30). Repeated local time (fall back): delivered
 *   once, at the first occurrence.
 * - Returns null for "off" or an invalid schedule.
 */
export function nextDigestDelivery(schedule: DigestSchedule, now: number): NextDelivery | null {
  if (schedule.frequency === "off") return null;
  if (!isValidIanaTimeZone(schedule.timeZone)) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(schedule.deliveryTime);
  if (!match) return null;
  if (schedule.frequency === "weekly" && (schedule.dayOfWeek === null || schedule.dayOfWeek < 1 || schedule.dayOfWeek > 7)) {
    return null;
  }
  const time = { hour: Number(match[1]), minute: Number(match[2]) };
  const today = wallFields(now, schedule.timeZone);

  for (let offsetDays = 0; offsetDays <= 8; offsetDays += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offsetDays));
    const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (schedule.frequency === "weekly" && isoWeekday !== schedule.dayOfWeek) continue;

    const resolved = resolveWallTime(
      { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
      time,
      schedule.timeZone,
    );
    const candidate =
      resolved.kind === "repeated"
        ? { instant: resolved.first, adjustment: "repeated_hour_first" as const }
        : resolved.kind === "skipped"
          ? { instant: resolved.instant, adjustment: "skipped_hour_shifted" as const }
          : { instant: resolved.instant, adjustment: "none" as const };
    if (candidate.instant >= now) return candidate;
  }
  return null;
}
