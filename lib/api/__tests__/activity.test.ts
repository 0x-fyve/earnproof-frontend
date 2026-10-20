/**
 * @jest-environment jsdom
 */

import {
  fetchActivityEvents,
  isKnownActivityEvent,
  maskApiKeyId,
  maskIpAddress,
  maskSessionId,
  maskWalletAddress,
  redactActivityEvent,
  type ActivityEvent,
  type AuthActivityEvent,
} from "../activity";

describe("redaction", () => {
  it("masks an IPv4 address by zeroing the last octet", () => {
    expect(maskIpAddress("203.0.113.42")).toBe("203.0.113.0");
  });

  it("masks an IPv6 address to its first two hextets", () => {
    expect(maskIpAddress("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8::");
  });

  it("masks a wallet address, keeping only short prefix/suffix", () => {
    const masked = maskWalletAddress("GABCD1234567890EFGH1234567890IJKL1234567890MNOP");
    expect(masked).toBe("GABC•••MNOP");
    expect(masked).not.toContain("1234567890EFGH1234567890IJKL1234567890");
  });

  it("masks an API key id", () => {
    const masked = maskApiKeyId("key_9f8e7d6c5b4a3210");
    expect(masked).toBe("key_•••3210");
  });

  it("masks a session id", () => {
    const masked = maskSessionId("sess_1a2b3c4d5e6f7089");
    expect(masked).toBe("sess•••7089");
  });

  it("fully redacts values too short to safely show a prefix/suffix", () => {
    expect(maskWalletAddress("short")).toBe("•••");
  });

  it("redacts every sensitive field on a known event by category", () => {
    const rawAuthEvent: AuthActivityEvent = {
      id: "evt_test",
      category: "auth",
      action: "wallet-signature-verified",
      outcome: "success",
      occurredAt: new Date().toISOString(),
      walletAddressMasked: "GABCD1234567890EFGH1234567890IJKL1234567890MNOP",
      ipAddressMasked: "203.0.113.42",
    };

    const redacted = redactActivityEvent(rawAuthEvent);
    expect(redacted.walletAddressMasked).toBe("GABC•••MNOP");
    expect(redacted.ipAddressMasked).toBe("203.0.113.0");
    // Original raw values never appear in the redacted output.
    expect(JSON.stringify(redacted)).not.toContain("EFGH1234567890IJKL1234567890");
  });

  it("passes unknown-shaped events through without attempting to redact unfamiliar fields", () => {
    const unknown: ActivityEvent = { id: "evt_x", category: "future-category" } as ActivityEvent;
    expect(redactActivityEvent(unknown)).toEqual(unknown);
  });
});

describe("isKnownActivityEvent", () => {
  it("is true for each known category", () => {
    for (const category of ["auth", "key", "session", "admin"]) {
      expect(isKnownActivityEvent({ id: "x", category } as ActivityEvent)).toBe(true);
    }
  });

  it("is false for an unrecognized category", () => {
    expect(isKnownActivityEvent({ id: "x", category: "mystery" } as ActivityEvent)).toBe(false);
  });

  it("is false when category is missing entirely", () => {
    expect(isKnownActivityEvent({ id: "x" } as ActivityEvent)).toBe(false);
  });
});

describe("fetchActivityEvents — pagination", () => {
  it("returns a first page with a cursor pointing past it when more events remain", async () => {
    const page = await fetchActivityEvents();
    expect(page.events.length).toBeGreaterThan(0);
    expect(page.events.length).toBeLessThanOrEqual(10);
    expect(page.nextCursor).not.toBeNull();
  });

  it("returns the next page using the previous page's cursor, with no overlap", async () => {
    const first = await fetchActivityEvents();
    const second = await fetchActivityEvents({ cursor: first.nextCursor });

    const firstIds = new Set(first.events.map((event) => event.id));
    for (const event of second.events) {
      expect(firstIds.has(event.id)).toBe(false);
    }
  });

  it("eventually terminates with nextCursor null", async () => {
    let cursor: string | null | undefined = undefined;
    let iterations = 0;
    let sawEnd = false;

    while (iterations < 10) {
      const page: { events: unknown[]; nextCursor: string | null } = await fetchActivityEvents({
        cursor,
      });
      cursor = page.nextCursor;
      iterations += 1;
      if (page.nextCursor === null) {
        sawEnd = true;
        break;
      }
    }

    expect(sawEnd).toBe(true);
  });

  it("returns an empty page (not a restart from the top) for an unrecognized cursor", async () => {
    const page = await fetchActivityEvents({ cursor: "evt_does_not_exist" });
    expect(page.events).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("fetchActivityEvents — filtering", () => {
  it("filters by category", async () => {
    const page = await fetchActivityEvents({ filter: { category: "key" } });
    expect(page.events.length).toBeGreaterThan(0);
    for (const event of page.events) {
      expect((event as { category?: string }).category).toBe("key");
    }
  });

  it("filters by outcome", async () => {
    const page = await fetchActivityEvents({ filter: { outcome: "failure" } });
    expect(page.events.length).toBeGreaterThan(0);
    for (const event of page.events) {
      expect((event as { outcome?: string }).outcome).toBe("failure");
    }
  });

  it("filters by category and outcome together", async () => {
    const page = await fetchActivityEvents({
      filter: { category: "auth", outcome: "failure" },
    });
    for (const event of page.events) {
      expect((event as { category?: string }).category).toBe("auth");
      expect((event as { outcome?: string }).outcome).toBe("failure");
    }
  });

  it("returns an empty page for a filter combination with no matches", async () => {
    const page = await fetchActivityEvents({
      filter: { category: "admin", outcome: "pending" },
    });
    expect(page.events).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns events already redacted", async () => {
    const page = await fetchActivityEvents({ filter: { category: "auth" } });
    const event = page.events.find((event) => isKnownActivityEvent(event)) as
      | AuthActivityEvent
      | undefined;
    expect(event).toBeDefined();
    expect(event!.walletAddressMasked).toContain("•••");
  });
});
