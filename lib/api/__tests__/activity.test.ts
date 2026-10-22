/**
 * @jest-environment jsdom
 */

import { ApiError } from "@/lib/errors";
import { apiClient } from "@/lib/api/client";
import { RAW_WALLET, SYNTHETIC_TOKEN, wireEvents, wirePage } from "@/tests/fixtures/activity-fixtures";
import {
  ACTIVITY_DEFAULT_PAGE_SIZE,
  ACTIVITY_MAX_CURSOR_LENGTH,
  ACTIVITY_MAX_PAGE_SIZE,
  ActivityRequestError,
  buildActivityQuery,
  fetchActivityEvents,
  isKnownActivityEvent,
  isValidActivityCursor,
  parseActivityEvent,
  parseActivityPage,
  maskApiKeyId,
  maskIpAddress,
  maskSessionId,
  maskWalletAddress,
  redactActivityEvent,
  type ActivityEvent,
  type AuthActivityEvent,
} from "../activity";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  apiClient: jest.fn(),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

beforeEach(() => {
  mockedApiClient.mockReset();
});

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


describe("redaction is idempotent on server-masked values", () => {
  it("leaves already-masked identifiers unchanged", () => {
    expect(maskWalletAddress("GABC•••MNOP")).toBe("GABC•••MNOP");
    expect(maskIpAddress("203.0.113.0")).toBe("203.0.113.0");
    expect(maskIpAddress("2001:db8::")).toBe("2001:db8::");
  });
});

describe("buildActivityQuery", () => {
  it("defaults to the documented page size and sends no filter or cursor", () => {
    expect(buildActivityQuery({})).toBe(`?limit=${ACTIVITY_DEFAULT_PAGE_SIZE}`);
  });

  it("includes category, outcome and cursor", () => {
    const query = buildActivityQuery({ filter: { category: "key", outcome: "failure" }, cursor: "abc_DEF-1.2=3", limit: 5 });
    expect(new URLSearchParams(query).get("category")).toBe("key");
    expect(new URLSearchParams(query).get("outcome")).toBe("failure");
    expect(new URLSearchParams(query).get("cursor")).toBe("abc_DEF-1.2=3");
    expect(new URLSearchParams(query).get("limit")).toBe("5");
  });

  it.each([1, ACTIVITY_MAX_PAGE_SIZE])("accepts page size %s (inclusive boundary)", (limit) => {
    expect(buildActivityQuery({ limit })).toBe(`?limit=${limit}`);
  });

  it.each([0, -1, ACTIVITY_MAX_PAGE_SIZE + 1, 1.5, Number.NaN])("rejects page size %s", (limit) => {
    expect(() => buildActivityQuery({ limit })).toThrow(ActivityRequestError);
  });

  it("accepts a cursor of exactly the maximum length and rejects one character more", () => {
    expect(isValidActivityCursor("a".repeat(ACTIVITY_MAX_CURSOR_LENGTH))).toBe(true);
    expect(isValidActivityCursor("a".repeat(ACTIVITY_MAX_CURSOR_LENGTH + 1))).toBe(false);
  });

  it.each(["", "has space", "a/b", "a?b=c", "a&b", "ünï", "a\nb"])("rejects cursor %j", (cursor) => {
    expect(isValidActivityCursor(cursor)).toBe(false);
    expect(() => buildActivityQuery({ cursor })).toThrow(ActivityRequestError);
  });

  it("rejects filter values this build does not know", () => {
    expect(() => buildActivityQuery({ filter: { category: "mystery" as never } })).toThrow(ActivityRequestError);
    expect(() => buildActivityQuery({ filter: { outcome: "maybe" as never } })).toThrow(ActivityRequestError);
  });
});

describe("parseActivityEvent", () => {
  it.each(Object.entries(wireEvents))("keeps a valid %s event", (_name, event) => {
    expect(parseActivityEvent(event)).toMatchObject({ id: event.id, category: event.category });
    expect(isKnownActivityEvent(parseActivityEvent(event) as ActivityEvent)).toBe(true);
  });

  it("drops fields the contract does not allow, so extra server data never reaches the UI", () => {
    const parsed = parseActivityEvent({
      ...wireEvents.auth,
      ipAddress: "203.0.113.42",
      sessionToken: SYNTHETIC_TOKEN,
      walletAddress: RAW_WALLET,
    });
    const text = JSON.stringify(parsed);
    expect(text).not.toContain(SYNTHETIC_TOKEN);
    expect(text).not.toContain(RAW_WALLET);
    expect(text).not.toContain("203.0.113.42");
  });

  it("masks identifiers again if the server forgot to", () => {
    const parsed = parseActivityEvent({ ...wireEvents.auth, walletAddressMasked: RAW_WALLET, ipAddressMasked: "203.0.113.42" }) as AuthActivityEvent;
    expect(parsed.walletAddressMasked).toBe("GABC•••MNOP");
    expect(parsed.ipAddressMasked).toBe("203.0.113.0");
  });

  it("turns an unrecognized category into an id-and-time-only stub", () => {
    const parsed = parseActivityEvent({ id: "evt_future", category: "billing", occurredAt: "2026-01-02T03:04:05.000Z", secret: SYNTHETIC_TOKEN });
    expect(parsed).toEqual({ id: "evt_future", occurredAt: "2026-01-02T03:04:05.000Z" });
  });

  it.each([
    ["unknown action", { ...wireEvents.auth, action: "mfa-enabled" }],
    ["missing action", { ...wireEvents.auth, action: undefined }],
    ["missing masked wallet", { ...wireEvents.auth, walletAddressMasked: undefined }],
    ["invalid outcome", { ...wireEvents.key, outcome: "unknown" }],
    ["invalid timestamp", { ...wireEvents.key, occurredAt: "yesterday" }],
    ["missing timestamp", { ...wireEvents.session, occurredAt: undefined }],
    ["wrong field type", { ...wireEvents.admin, targetLabel: 42 }],
  ])("falls back to a stub for %s", (_name, event) => {
    const parsed = parseActivityEvent(event) as Record<string, unknown>;
    expect(parsed.id).toBe(event.id);
    expect(parsed.category).toBeUndefined();
    expect(Object.keys(parsed).every((key) => key === "id" || key === "occurredAt")).toBe(true);
  });

  it.each([null, undefined, "text", 5, [], {}, { id: "" }, { id: 7 }])("rejects %j (no usable id)", (value) => {
    expect(parseActivityEvent(value)).toBeNull();
  });
});

describe("parseActivityPage", () => {
  it("returns validated events with the request id", () => {
    const page = parseActivityPage(wirePage([wireEvents.auth, wireEvents.key], "next_1"), "req-1");
    expect(page.events.map((event) => event.id)).toEqual(["evt_auth", "evt_key"]);
    expect(page.nextCursor).toBe("next_1");
    expect(page.requestId).toBe("req-1");
    expect(page.droppedCount).toBe(0);
  });

  it("returns an empty page without inventing events", () => {
    expect(parseActivityPage(wirePage([]), "req")).toMatchObject({ events: [], nextCursor: null });
  });

  it.each([null, "x", 3, [], {}, { events: "nope" }, { events: {} }])("rejects malformed envelope %j", (raw) => {
    expect(() => parseActivityPage(raw, "req")).toThrow(expect.objectContaining({ kind: "invalid-response" }));
  });

  it.each([5, "bad cursor", "a".repeat(ACTIVITY_MAX_CURSOR_LENGTH + 1)])("rejects invalid next cursor %j", (nextCursor) => {
    expect(() => parseActivityPage({ events: [], nextCursor }, "req")).toThrow(expect.objectContaining({ kind: "invalid-response" }));
  });

  it("ends pagination when the server echoes the cursor it was given", () => {
    expect(parseActivityPage(wirePage([wireEvents.auth], "same"), "req", "same").nextCursor).toBeNull();
    expect(parseActivityPage(wirePage([wireEvents.auth], "other"), "req", "same").nextCursor).toBe("other");
  });

  it("keeps the first of duplicate ids and counts entries without ids as dropped", () => {
    const page = parseActivityPage(
      wirePage([wireEvents.auth, { ...wireEvents.auth, outcome: "failure" }, { nope: true }, null]),
      "req",
    );
    expect(page.events).toHaveLength(1);
    expect((page.events[0] as { outcome: string }).outcome).toBe("success");
    expect(page.droppedCount).toBe(2);
  });
});

describe("fetchActivityEvents", () => {
  const signal = () => new AbortController().signal;

  it("calls the versioned endpoint with bearer auth and a correlation id, and returns the same id", async () => {
    mockedApiClient.mockResolvedValue(wirePage([wireEvents.auth]));

    const page = await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() });

    expect(mockedApiClient).toHaveBeenCalledTimes(1);
    const call = mockedApiClient.mock.calls[0]![0];
    expect(call.path).toBe(`/activity?limit=${ACTIVITY_DEFAULT_PAGE_SIZE}`);
    expect(call.method).toBe("GET");
    const headers = call.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`);
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(page.requestId).toBe(headers["X-Request-Id"]);
    expect(page.events).toHaveLength(1);
  });

  it("uses a new correlation id for every request", async () => {
    mockedApiClient.mockResolvedValue(wirePage([]));
    const first = await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() });
    const second = await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() });
    expect(first.requestId).not.toBe(second.requestId);
  });

  it("sends the cursor, filters and limit to the server instead of filtering locally", async () => {
    mockedApiClient.mockResolvedValue(wirePage([]));
    await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal(), cursor: "cur_1", filter: { category: "admin", outcome: "failure" }, limit: 50 });

    const path = mockedApiClient.mock.calls[0]![0].path;
    const params = new URLSearchParams(path.split("?")[1]);
    expect(Object.fromEntries(params)).toEqual({ limit: "50", category: "admin", outcome: "failure", cursor: "cur_1" });
  });

  it("returns exactly what the server sent: no mock or fallback events", async () => {
    mockedApiClient.mockResolvedValue(wirePage([]));
    const page = await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() });
    expect(page.events).toEqual([]);
  });

  it("does not call the network without a token", async () => {
    await expect(fetchActivityEvents({ token: "", signal: signal() })).rejects.toMatchObject({ kind: "unauthorized" });
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it("does not call the network for an invalid request", async () => {
    await expect(fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal(), cursor: "bad cursor" })).rejects.toMatchObject({ kind: "invalid-request" });
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "unavailable"],
    [501, "unavailable"],
    [400, "invalid-request"],
    [422, "invalid-request"],
    [500, "failed"],
    [502, "failed"],
  ])("maps HTTP %s to %s", async (status, kind) => {
    mockedApiClient.mockRejectedValue(new ApiError({ status, message: "nope" }));
    await expect(fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() })).rejects.toMatchObject({ kind });
  });

  it("attaches the request id to failures", async () => {
    mockedApiClient.mockRejectedValue(new ApiError({ status: 500, message: "boom" }));
    const error = await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() }).catch((e) => e);
    expect(error).toBeInstanceOf(ActivityRequestError);
    expect(error.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(error.message).not.toContain("boom");
  });

  it("reports a malformed body as invalid-response", async () => {
    mockedApiClient.mockResolvedValue({ items: [] });
    await expect(fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() })).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("reports an unexpected error as a generic failure", async () => {
    mockedApiClient.mockRejectedValue(new Error("socket hang up"));
    await expect(fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: signal() })).rejects.toMatchObject({ kind: "failed" });
  });

  it("rethrows an abort untouched so callers can ignore it", async () => {
    const controller = new AbortController();
    mockedApiClient.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    const error = await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: controller.signal }).catch((e) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).not.toBeInstanceOf(ActivityRequestError);
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal to the client so navigation can cancel the request", async () => {
    mockedApiClient.mockResolvedValue(wirePage([]));
    const controller = new AbortController();
    await fetchActivityEvents({ token: SYNTHETIC_TOKEN, signal: controller.signal });
    expect(mockedApiClient.mock.calls[0]![0].signal).toBe(controller.signal);
  });
});
