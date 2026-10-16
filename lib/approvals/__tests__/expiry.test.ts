/**
 * Unit tests for expiry utility functions
 * 
 * Tests cover:
 * - Expiry status classification (expired, expiring-soon, valid)
 * - Time formatting (remaining, age, relative)
 * - Warning levels and highlighting
 * - Boundary conditions and edge cases
 */

import {
  getExpiryStatus,
  formatTimeRemaining,
  getAgeInHours,
  getAgeInDays,
  formatAge,
  getExpiryWarningLevel,
  shouldHighlightForExpiry,
  getSecondsUntilExpiry,
  formatRelativeTime,
  isFutureDateTime,
  isPastDateTime,
  getDeadlineWarning,
} from "@/lib/approvals/expiry";

// Fixed reference time: 2024-01-15T12:00:00Z
const NOW = new Date("2024-01-15T12:00:00.000Z").getTime();

describe("Expiry Utilities", () => {
  describe("getExpiryStatus", () => {
    it("returns 'expired' for past expiry time", () => {
      const expiresAt = "2024-01-15T11:00:00.000Z"; // 1 hour ago
      expect(getExpiryStatus(expiresAt, NOW)).toBe("expired");
    });

    it("returns 'expiring-soon' for expiry within 24 hours", () => {
      const expiresAt = "2024-01-16T11:00:00.000Z"; // 23 hours from now
      expect(getExpiryStatus(expiresAt, NOW)).toBe("expiring-soon");
    });

    it("returns 'valid' for expiry more than 24 hours away", () => {
      const expiresAt = "2024-01-17T12:00:00.000Z"; // exactly 48 hours from now
      expect(getExpiryStatus(expiresAt, NOW)).toBe("valid");
    });

    it("handles boundary case: exactly 24 hours remaining", () => {
      const expiresAt = "2024-01-16T12:00:00.000Z"; // exactly 24 hours
      expect(getExpiryStatus(expiresAt, NOW)).toBe("valid");
    });

    it("handles boundary case: just under 24 hours remaining", () => {
      const expiresAt = "2024-01-16T11:59:59.999Z"; // 23:59:59 hours
      expect(getExpiryStatus(expiresAt, NOW)).toBe("expiring-soon");
    });
  });

  describe("formatTimeRemaining", () => {
    it("returns 'Expired' for past time", () => {
      const expiresAt = "2024-01-15T11:00:00.000Z";
      expect(formatTimeRemaining(expiresAt, NOW)).toBe("Expired");
    });

    it("formats days remaining", () => {
      const expiresAt = "2024-01-18T12:00:00.000Z"; // 3 days away
      expect(formatTimeRemaining(expiresAt, NOW)).toBe("3d remaining");
    });

    it("formats hours remaining (skips days if < 1 day)", () => {
      const expiresAt = "2024-01-15T18:00:00.000Z"; // 6 hours away
      expect(formatTimeRemaining(expiresAt, NOW)).toBe("6h remaining");
    });

    it("formats minutes remaining (no hours)", () => {
      const expiresAt = "2024-01-15T12:30:00.000Z"; // 30 minutes away
      expect(formatTimeRemaining(expiresAt, NOW)).toBe("30m remaining");
    });

    it("handles zero minutes remaining", () => {
      const expiresAt = "2024-01-15T12:00:15.000Z"; // 15 seconds away
      expect(formatTimeRemaining(expiresAt, NOW)).toBe("0m remaining");
    });
  });

  describe("getAgeInHours", () => {
    it("returns 0 for just-created operations", () => {
      const createdAt = "2024-01-15T12:00:00.000Z";
      expect(getAgeInHours(createdAt, NOW)).toBe(0);
    });

    it("returns correct age in hours", () => {
      const createdAt = "2024-01-15T09:00:00.000Z"; // 3 hours ago
      expect(getAgeInHours(createdAt, NOW)).toBe(3);
    });

    it("returns age including fractional hours", () => {
      const createdAt = "2024-01-15T11:00:00.000Z"; // 1 hour ago
      const age = getAgeInHours(createdAt, NOW);
      expect(age).toBe(1);
    });

    it("returns positive age even for future-created operations (edge case)", () => {
      const createdAt = "2024-01-16T12:00:00.000Z"; // 1 day in future
      expect(getAgeInHours(createdAt, NOW)).toBe(0); // Max 0 due to Math.max
    });
  });

  describe("getAgeInDays", () => {
    it("returns age in days", () => {
      const createdAt = "2024-01-13T12:00:00.000Z"; // 2 days ago
      expect(getAgeInDays(createdAt, NOW)).toBe(2);
    });

    it("returns fractional days", () => {
      const createdAt = "2024-01-15T06:00:00.000Z"; // 6 hours ago
      expect(getAgeInDays(createdAt, NOW)).toBe(0.25);
    });
  });

  describe("formatAge", () => {
    it("formats just-now for very recent operations", () => {
      const createdAt = new Date(NOW - 30 * 1000).toISOString(); // 30 seconds ago
      expect(formatAge(createdAt, NOW)).toBe("just now");
    });

    it("formats minutes", () => {
      const createdAt = new Date(NOW - 15 * 60 * 1000).toISOString(); // 15 minutes ago
      expect(formatAge(createdAt, NOW)).toBe("15m old");
    });

    it("formats hours (under 24)", () => {
      const createdAt = new Date(NOW - 5 * 60 * 60 * 1000).toISOString(); // 5 hours ago
      expect(formatAge(createdAt, NOW)).toBe("5h old");
    });

    it("formats days (24+ hours)", () => {
      const createdAt = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
      expect(formatAge(createdAt, NOW)).toBe("3d old");
    });
  });

  describe("getExpiryWarningLevel", () => {
    it("returns 'critical' for expired operations", () => {
      const expiresAt = "2024-01-15T11:00:00.000Z";
      expect(getExpiryWarningLevel(expiresAt, NOW)).toBe("critical");
    });

    it("returns 'warning' for expiring-soon operations", () => {
      const expiresAt = "2024-01-16T11:00:00.000Z"; // 23 hours away
      expect(getExpiryWarningLevel(expiresAt, NOW)).toBe("warning");
    });

    it("returns 'none' for operations with plenty of time", () => {
      const expiresAt = "2024-01-18T12:00:00.000Z"; // 3 days away
      expect(getExpiryWarningLevel(expiresAt, NOW)).toBe("none");
    });
  });

  describe("shouldHighlightForExpiry", () => {
    it("returns true for expired operations", () => {
      const expiresAt = "2024-01-15T11:00:00.000Z";
      expect(shouldHighlightForExpiry(expiresAt, NOW)).toBe(true);
    });

    it("returns true for expiring-soon operations", () => {
      const expiresAt = "2024-01-16T11:00:00.000Z";
      expect(shouldHighlightForExpiry(expiresAt, NOW)).toBe(true);
    });

    it("returns false for valid operations", () => {
      const expiresAt = "2024-01-18T12:00:00.000Z";
      expect(shouldHighlightForExpiry(expiresAt, NOW)).toBe(false);
    });
  });

  describe("getSecondsUntilExpiry", () => {
    it("returns positive seconds for future expiry", () => {
      const expiresAt = "2024-01-15T12:01:00.000Z"; // 60 seconds away
      expect(getSecondsUntilExpiry(expiresAt, NOW)).toBe(60);
    });

    it("returns negative seconds for past expiry", () => {
      const expiresAt = "2024-01-15T11:59:00.000Z"; // 60 seconds ago
      expect(getSecondsUntilExpiry(expiresAt, NOW)).toBe(-60);
    });

    it("returns 0 for exactly-now expiry", () => {
      const expiresAt = "2024-01-15T12:00:00.000Z";
      expect(getSecondsUntilExpiry(expiresAt, NOW)).toBe(0);
    });
  });

  describe("formatRelativeTime", () => {
    it("formats just-now for very recent timestamps", () => {
      const timestamp = new Date(NOW - 30 * 1000).toISOString();
      expect(formatRelativeTime(timestamp, NOW)).toBe("just now");
    });

    it("formats minutes ago", () => {
      const timestamp = new Date(NOW - 15 * 60 * 1000).toISOString();
      expect(formatRelativeTime(timestamp, NOW)).toBe("15m ago");
    });

    it("formats hours ago", () => {
      const timestamp = new Date(NOW - 5 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(timestamp, NOW)).toBe("5h ago");
    });

    it("formats days ago", () => {
      const timestamp = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(timestamp, NOW)).toBe("3d ago");
    });

    it("formats weeks ago", () => {
      const timestamp = new Date(NOW - 2 * 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(timestamp, NOW)).toBe("2w ago");
    });

    it("formats months ago", () => {
      const timestamp = new Date(NOW - 2 * 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(timestamp, NOW)).toBe("2mo ago");
    });
  });

  describe("isFutureDateTime", () => {
    it("returns true for future timestamps", () => {
      const future = "2024-01-20T12:00:00.000Z";
      expect(isFutureDateTime(future, NOW)).toBe(true);
    });

    it("returns false for past timestamps", () => {
      const past = "2024-01-10T12:00:00.000Z";
      expect(isFutureDateTime(past, NOW)).toBe(false);
    });

    it("returns false for now", () => {
      const now = "2024-01-15T12:00:00.000Z";
      expect(isFutureDateTime(now, NOW)).toBe(false);
    });
  });

  describe("isPastDateTime", () => {
    it("returns true for past timestamps", () => {
      const past = "2024-01-10T12:00:00.000Z";
      expect(isPastDateTime(past, NOW)).toBe(true);
    });

    it("returns false for future timestamps", () => {
      const future = "2024-01-20T12:00:00.000Z";
      expect(isPastDateTime(future, NOW)).toBe(false);
    });

    it("returns false for now", () => {
      const now = "2024-01-15T12:00:00.000Z";
      expect(isPastDateTime(now, NOW)).toBe(false);
    });
  });

  describe("getDeadlineWarning", () => {
    it("returns error message for expired operations", () => {
      const expiresAt = "2024-01-15T11:00:00.000Z";
      const warning = getDeadlineWarning(expiresAt, NOW);
      expect(warning).toContain("expired");
      expect(warning).toContain("cannot be acted upon");
    });

    it("returns urgent message for expiring-soon operations", () => {
      const expiresAt = "2024-01-16T11:00:00.000Z"; // 23 hours away
      const warning = getDeadlineWarning(expiresAt, NOW);
      expect(warning).toContain("Urgent");
      expect(warning).toContain("remaining");
    });

    it("returns reminder for operations approaching deadline", () => {
      const expiresAt = "2024-01-16T00:00:00.000Z"; // 12 hours away
      const warning = getDeadlineWarning(expiresAt, NOW, 24); // warn 24 hours before
      expect(warning).toContain("Reminder");
    });

    it("returns null for operations with plenty of time", () => {
      const expiresAt = "2024-01-18T12:00:00.000Z"; // 3 days away
      const warning = getDeadlineWarning(expiresAt, NOW, 24);
      expect(warning).toBeNull();
    });

    it("supports custom warning window", () => {
      const expiresAt = "2024-01-15T14:00:00.000Z"; // 2 hours away
      const warning = getDeadlineWarning(expiresAt, NOW, 1); // warn 1 hour before
      expect(warning).toContain("Reminder");
    });
  });
});
