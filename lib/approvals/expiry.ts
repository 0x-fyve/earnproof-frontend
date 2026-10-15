/**
 * Utility functions for operation age and expiry indicators.
 * 
 * Provides deterministic, client-side calculations for:
 * - Expiry status (expired, expiring-soon, valid)
 * - Time remaining (human-readable format)
 * - Age in hours/days
 * - Expiry warnings
 * 
 * All calculations are deterministic and do not depend on Date.now(),
 * allowing for testing with fixed timestamps.
 */

/**
 * Expiry status classification.
 */
export type ExpiryStatus = "expired" | "expiring-soon" | "valid";

/**
 * Time unit for age calculations.
 */
export type TimeUnit = "minutes" | "hours" | "days";

/**
 * Determine expiry status of an operation.
 * 
 * @param expiresAt - ISO datetime string when operation expires
 * @param now - Current time (defaults to Date.now() for determinism in tests)
 * @returns "expired" if past expiry, "expiring-soon" if < 24h away, "valid" otherwise
 */
export function getExpiryStatus(expiresAt: string, now = Date.now()): ExpiryStatus {
  const expiryTime = new Date(expiresAt).getTime();
  const timeUntilExpiry = expiryTime - now;

  if (timeUntilExpiry < 0) {
    return "expired";
  }

  // Expiring soon: less than 24 hours remaining
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  if (timeUntilExpiry < TWENTY_FOUR_HOURS_MS) {
    return "expiring-soon";
  }

  return "valid";
}

/**
 * Format time remaining until expiry in human-readable format.
 * 
 * Examples: "2d remaining", "5h remaining", "30m remaining", "Expired"
 * 
 * @param expiresAt - ISO datetime string when operation expires
 * @param now - Current time (defaults to Date.now())
 * @returns Human-readable string describing time until expiry
 */
export function formatTimeRemaining(expiresAt: string, now = Date.now()): string {
  const expiryTime = new Date(expiresAt).getTime();
  const diff = expiryTime - now;

  if (diff < 0) {
    return "Expired";
  }

  const MS_PER_MINUTE = 60 * 1000;
  const MS_PER_HOUR = 60 * 60 * 1000;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Days
  const days = Math.floor(diff / MS_PER_DAY);
  if (days > 0) {
    return `${days}d remaining`;
  }

  // Hours
  const hours = Math.floor(diff / MS_PER_HOUR);
  if (hours > 0) {
    return `${hours}h remaining`;
  }

  // Minutes
  const minutes = Math.floor(diff / MS_PER_MINUTE);
  return `${Math.max(0, minutes)}m remaining`;
}

/**
 * Get age of an operation in hours since creation.
 * 
 * @param createdAt - ISO datetime string when operation was created
 * @param now - Current time (defaults to Date.now())
 * @returns Number of hours since creation
 */
export function getAgeInHours(createdAt: string, now = Date.now()): number {
  const creationTime = new Date(createdAt).getTime();
  const ageMs = now - creationTime;
  const MS_PER_HOUR = 60 * 60 * 1000;
  return Math.max(0, ageMs / MS_PER_HOUR);
}

/**
 * Get age of an operation in days since creation.
 * 
 * @param createdAt - ISO datetime string when operation was created
 * @param now - Current time (defaults to Date.now())
 * @returns Number of days since creation
 */
export function getAgeInDays(createdAt: string, now = Date.now()): number {
  return getAgeInHours(createdAt, now) / 24;
}

/**
 * Format age in appropriate time unit (minutes, hours, days).
 * 
 * Examples: "5 minutes old", "2 hours old", "3 days old"
 * 
 * @param createdAt - ISO datetime string when operation was created
 * @param now - Current time (defaults to Date.now())
 * @returns Human-readable string describing operation age
 */
export function formatAge(createdAt: string, now = Date.now()): string {
  const creationTime = new Date(createdAt).getTime();
  const ageMs = now - creationTime;

  const MS_PER_MINUTE = 60 * 1000;
  const MS_PER_HOUR = 60 * 60 * 1000;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  if (ageMs < MS_PER_MINUTE) {
    return "just now";
  }

  const minutes = Math.floor(ageMs / MS_PER_MINUTE);
  if (minutes < 60) {
    return `${minutes}m old`;
  }

  const hours = Math.floor(ageMs / MS_PER_HOUR);
  if (hours < 24) {
    return `${hours}h old`;
  }

  const days = Math.floor(ageMs / MS_PER_DAY);
  return `${days}d old`;
}

/**
 * Get warning severity based on expiry status.
 * Useful for styling or prioritizing operations in UI.
 * 
 * @param expiresAt - ISO datetime string when operation expires
 * @param now - Current time (defaults to Date.now())
 * @returns "critical" for expired, "warning" for expiring-soon, "none" otherwise
 */
export function getExpiryWarningLevel(
  expiresAt: string,
  now = Date.now()
): "critical" | "warning" | "none" {
  const status = getExpiryStatus(expiresAt, now);

  switch (status) {
    case "expired":
      return "critical";
    case "expiring-soon":
      return "warning";
    case "valid":
      return "none";
  }
}

/**
 * Check if an operation should be highlighted due to proximity to expiry.
 * 
 * @param expiresAt - ISO datetime string when operation expires
 * @param now - Current time (defaults to Date.now())
 * @returns true if operation is expiring soon or already expired
 */
export function shouldHighlightForExpiry(expiresAt: string, now = Date.now()): boolean {
  const status = getExpiryStatus(expiresAt, now);
  return status === "expired" || status === "expiring-soon";
}

/**
 * Get remaining seconds until expiry.
 * Useful for countdown timers or programmatic decision making.
 * 
 * @param expiresAt - ISO datetime string when operation expires
 * @param now - Current time (defaults to Date.now())
 * @returns Seconds until expiry, or negative if already expired
 */
export function getSecondsUntilExpiry(expiresAt: string, now = Date.now()): number {
  const expiryTime = new Date(expiresAt).getTime();
  const diff = expiryTime - now;
  return Math.floor(diff / 1000);
}

/**
 * Format a relative time between two timestamps (e.g., "2 hours ago").
 * Used for formatting approval/rejection times.
 * 
 * @param timestamp - ISO datetime string of the event
 * @param now - Current time (defaults to Date.now())
 * @returns Human-readable relative time
 */
export function formatRelativeTime(timestamp: string, now = Date.now()): string {
  const eventTime = new Date(timestamp).getTime();
  const diff = now - eventTime;

  const MS_PER_MINUTE = 60 * 1000;
  const MS_PER_HOUR = 60 * 60 * 1000;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

  if (diff < MS_PER_MINUTE) {
    return "just now";
  }

  if (diff < MS_PER_HOUR) {
    const minutes = Math.floor(diff / MS_PER_MINUTE);
    return `${minutes}m ago`;
  }

  if (diff < MS_PER_DAY) {
    const hours = Math.floor(diff / MS_PER_HOUR);
    return `${hours}h ago`;
  }

  if (diff < MS_PER_WEEK) {
    const days = Math.floor(diff / MS_PER_DAY);
    return `${days}d ago`;
  }

  if (diff < MS_PER_MONTH) {
    const weeks = Math.floor(diff / MS_PER_WEEK);
    return `${weeks}w ago`;
  }

  const months = Math.floor(diff / MS_PER_MONTH);
  return `${months}mo ago`;
}

/**
 * Parse an ISO datetime string and return a Date object.
 * Returns invalid date if parsing fails.
 * 
 * @param isoString - ISO datetime string to parse
 * @returns Date object
 */
export function parseIsoDateTime(isoString: string): Date {
  return new Date(isoString);
}

/**
 * Check if an ISO datetime string is in the future.
 * 
 * @param isoString - ISO datetime string to check
 * @param now - Current time (defaults to Date.now())
 * @returns true if datetime is in the future
 */
export function isFutureDateTime(isoString: string, now = Date.now()): boolean {
  const time = new Date(isoString).getTime();
  return time > now;
}

/**
 * Check if an ISO datetime string is in the past.
 * 
 * @param isoString - ISO datetime string to check
 * @param now - Current time (defaults to Date.now())
 * @returns true if datetime is in the past
 */
export function isPastDateTime(isoString: string, now = Date.now()): boolean {
  const time = new Date(isoString).getTime();
  return time < now;
}

/**
 * Get time between two ISO datetime strings.
 * 
 * @param from - Start datetime (ISO string)
 * @param to - End datetime (ISO string)
 * @returns Time difference in milliseconds
 */
export function getTimeBetween(from: string, to: string): number {
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  return Math.abs(toTime - fromTime);
}

/**
 * Calculate deadline for acting on an operation.
 * Returns warning message if deadline is approaching or passed.
 * 
 * @param expiresAt - ISO datetime string when operation expires
 * @param now - Current time (defaults to Date.now())
 * @param warningHoursBefore - Hours before expiry to start warning (default 24)
 * @returns null if plenty of time, otherwise warning message
 */
export function getDeadlineWarning(
  expiresAt: string,
  now = Date.now(),
  warningHoursBefore = 24
): string | null {
  const status = getExpiryStatus(expiresAt, now);

  if (status === "expired") {
    return "This operation has expired and cannot be acted upon.";
  }

  if (status === "expiring-soon") {
    const remaining = formatTimeRemaining(expiresAt, now);
    return `Urgent: ${remaining} to act on this operation.`;
  }

  // Check if within warning window
  const warningMs = warningHoursBefore * 60 * 60 * 1000;
  const expiryTime = new Date(expiresAt).getTime();
  const timeUntilExpiry = expiryTime - now;

  if (timeUntilExpiry < warningMs) {
    const remaining = formatTimeRemaining(expiresAt, now);
    return `Reminder: ${remaining} to act on this operation.`;
  }

  return null;
}
