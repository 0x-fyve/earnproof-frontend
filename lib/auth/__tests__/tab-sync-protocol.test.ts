/**
 * @jest-environment jsdom
 */

import {
  TAB_SYNC_EVENT_TYPES,
  TAB_SYNC_MAX_CLOCK_SKEW_MS,
  TAB_SYNC_MAX_MESSAGE_BYTES,
  TAB_SYNC_RESTRICTIVENESS,
  decideTabSyncMessage,
  decodeTabSyncPayload,
  encodeTabSyncMessage,
  utf8ByteLength,
  validateTabSyncMessage,
  type TabSyncAppliedMarker,
  type TabSyncEventType,
  type TabSyncMessage,
} from "../tab-sync-protocol";
import {
  FAKE_JWT_LIKE,
  FIXED_NOW,
  SYNTHETIC_TENANT_ID,
  TAB_A,
  TAB_B,
  TAB_C,
  makeTabSyncMessage,
} from "@/tests/fixtures/tab-sync-fixtures";

function reasonFor(value: unknown, now = FIXED_NOW) {
  const result = validateTabSyncMessage(value, now);
  return result.ok ? "ok" : result.reason;
}

describe("tab sync protocol: schema validation", () => {
  it.each(TAB_SYNC_EVENT_TYPES)("positive: accepts a well-formed %s message", (type) => {
    const result = validateTabSyncMessage(makeTabSyncMessage({ type }), FIXED_NOW);
    expect(result).toEqual({ ok: true, message: makeTabSyncMessage({ type }) });
  });

  it("positive: accepts tenantId on tenant_switched only", () => {
    const message = makeTabSyncMessage({ type: "tenant_switched", tenantId: SYNTHETIC_TENANT_ID });
    expect(validateTabSyncMessage(message, FIXED_NOW)).toEqual({ ok: true, message });
  });

  it.each([
    ["null", null],
    ["a string", "wallet_logout"],
    ["an array", [1, "wallet_logout"]],
    ["a number", 42],
  ])("negative: rejects %s as malformed", (_label, value) => {
    expect(reasonFor(value)).toBe("malformed");
  });

  it.each([
    ["missing", { ...makeTabSyncMessage(), v: undefined }],
    ["v: 2", makeTabSyncMessage({ v: 2 as unknown as 1 })],
    ["v: 0", makeTabSyncMessage({ v: 0 as unknown as 1 })],
    ["v: '1'", makeTabSyncMessage({ v: "1" as unknown as 1 })],
  ])("negative: rejects an unknown version (%s)", (_label, value) => {
    expect(reasonFor(value)).toBe("unsupported_version");
  });

  it("negative: rejects a future version even if its other fields differ", () => {
    expect(reasonFor({ v: 2, kind: "something-new" })).toBe("unsupported_version");
  });

  it.each(["login", "session_recovered", "role_granted", "token_rotated", "", "WALLET_LOGOUT"])(
    "negative: rejects unknown event type %p",
    (type) => {
      expect(reasonFor(makeTabSyncMessage({ type: type as TabSyncEventType }))).toBe("unknown_type");
    },
  );

  it.each([
    ["token", FAKE_JWT_LIKE],
    ["accessToken", FAKE_JWT_LIKE],
    ["sessionId", "session-synthetic-0001"],
    ["walletAddress", "GSYNTHETICWALLET000000000000000000000000000000000000000"],
    ["role", "ADMIN"],
    ["claims", { income: 1 }],
  ])("negative: rejects a message carrying %s instead of stripping it", (field, value) => {
    expect(reasonFor({ ...makeTabSyncMessage(), [field]: value })).toBe("unexpected_field");
  });

  it("negative: rejects tenantId on a non-tenant event", () => {
    expect(reasonFor(makeTabSyncMessage({ type: "wallet_logout", tenantId: SYNTHETIC_TENANT_ID }))).toBe(
      "unexpected_field",
    );
  });

  it.each([
    ["a JWT-like value", FAKE_JWT_LIKE],
    ["an empty string", ""],
    ["a 65-char id", "x".repeat(65)],
    ["a non-string", 7 as unknown as string],
  ])("negative: rejects tenantId that is %s", (_label, tenantId) => {
    expect(reasonFor(makeTabSyncMessage({ type: "tenant_switched", tenantId }))).toBe("invalid_tenant_id");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5" as unknown as number])(
    "negative: rejects epoch %p",
    (epoch) => {
      expect(reasonFor(makeTabSyncMessage({ epoch }))).toBe("invalid_epoch");
    },
  );

  it.each(["", "short", "A".repeat(32), "g".repeat(32), "a".repeat(65)])("negative: rejects tabId %p", (tabId) => {
    expect(reasonFor(makeTabSyncMessage({ tabId }))).toBe("invalid_tab_id");
  });

  it.each([0, -5, 1.5, "now" as unknown as number])("negative: rejects ts %p", (ts) => {
    expect(reasonFor(makeTabSyncMessage({ ts }))).toBe("invalid_timestamp");
  });
});

describe("tab sync protocol: exact boundaries", () => {
  it("boundary: accepts ts exactly TAB_SYNC_MAX_CLOCK_SKEW_MS old or ahead, rejects one ms beyond", () => {
    const old = FIXED_NOW - TAB_SYNC_MAX_CLOCK_SKEW_MS;
    const ahead = FIXED_NOW + TAB_SYNC_MAX_CLOCK_SKEW_MS;
    expect(reasonFor(makeTabSyncMessage({ ts: old, epoch: old }))).toBe("ok");
    expect(reasonFor(makeTabSyncMessage({ ts: ahead, epoch: ahead }))).toBe("ok");
    expect(reasonFor(makeTabSyncMessage({ ts: old - 1, epoch: old }))).toBe("stale_timestamp");
    expect(reasonFor(makeTabSyncMessage({ ts: ahead + 1, epoch: ahead }))).toBe("stale_timestamp");
  });

  it("boundary: accepts epoch exactly now + skew, rejects one beyond (a forged far-future epoch cannot freeze sync)", () => {
    const limit = FIXED_NOW + TAB_SYNC_MAX_CLOCK_SKEW_MS;
    expect(reasonFor(makeTabSyncMessage({ epoch: limit }))).toBe("ok");
    expect(reasonFor(makeTabSyncMessage({ epoch: limit + 1 }))).toBe("invalid_epoch");
    expect(reasonFor(makeTabSyncMessage({ epoch: Number.MAX_SAFE_INTEGER }))).toBe("invalid_epoch");
  });

  it("boundary: a payload of exactly TAB_SYNC_MAX_MESSAGE_BYTES is accepted, one byte more is oversized", () => {
    const base = JSON.stringify(makeTabSyncMessage());
    const padding = TAB_SYNC_MAX_MESSAGE_BYTES - utf8ByteLength(base);
    const exact = base + " ".repeat(padding);
    expect(utf8ByteLength(exact)).toBe(TAB_SYNC_MAX_MESSAGE_BYTES);
    expect(decodeTabSyncPayload(exact, FIXED_NOW).ok).toBe(true);
    expect(decodeTabSyncPayload(exact + " ", FIXED_NOW)).toEqual({ ok: false, reason: "oversized" });
  });

  it("boundary: the size cap counts UTF-8 bytes, not characters", () => {
    const multibyte = "é".repeat(TAB_SYNC_MAX_MESSAGE_BYTES / 2 + 1); // 2 bytes each
    expect(multibyte.length).toBeLessThan(TAB_SYNC_MAX_MESSAGE_BYTES);
    expect(decodeTabSyncPayload(JSON.stringify(multibyte), FIXED_NOW)).toEqual({ ok: false, reason: "oversized" });
  });
});

describe("tab sync protocol: decoding", () => {
  it("negative: rejects invalid JSON and non-string payloads as malformed", () => {
    expect(decodeTabSyncPayload("{not json", FIXED_NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(decodeTabSyncPayload(makeTabSyncMessage(), FIXED_NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(decodeTabSyncPayload(undefined, FIXED_NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("negative: an oversized payload is rejected before parsing (even if it is not JSON)", () => {
    const parse = jest.spyOn(JSON, "parse");
    expect(decodeTabSyncPayload("x".repeat(TAB_SYNC_MAX_MESSAGE_BYTES + 1), FIXED_NOW)).toEqual({
      ok: false,
      reason: "oversized",
    });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("positive: encode/decode round-trips and contains only whitelisted fields", () => {
    const message = makeTabSyncMessage({ type: "tenant_switched", tenantId: SYNTHETIC_TENANT_ID });
    const encoded = encodeTabSyncMessage(message);
    expect(encoded).not.toBeNull();
    expect(Object.keys(JSON.parse(encoded as string)).sort()).toEqual(["epoch", "tabId", "tenantId", "ts", "type", "v"]);
    expect(decodeTabSyncPayload(encoded, FIXED_NOW)).toEqual({ ok: true, message });
  });
});

describe("tab sync protocol: authorization", () => {
  it("defines no event type that could authenticate a tab or grant a role", () => {
    for (const type of TAB_SYNC_EVENT_TYPES) {
      expect(type).not.toMatch(/login|recover|grant|elevat|authenticat|refresh/i);
    }
  });

  it("rejects a crafted login/elevation message in every shape tried", () => {
    const crafted: unknown[] = [
      { v: 1, type: "login", epoch: FIXED_NOW, tabId: TAB_B, ts: FIXED_NOW },
      { ...makeTabSyncMessage({ type: "tenant_switched" }), role: "ADMIN" },
      { ...makeTabSyncMessage({ type: "tenant_switched" }), authenticated: true },
      { ...makeTabSyncMessage(), token: FAKE_JWT_LIKE },
    ];
    for (const value of crafted) {
      expect(validateTabSyncMessage(value, FIXED_NOW).ok).toBe(false);
    }
  });
});

describe("tab sync protocol: conflict resolution", () => {
  const marker = (epoch: number, tabId: string, type: TabSyncEventType): TabSyncAppliedMarker => ({
    epoch,
    tabId,
    type,
  });

  it("never applies this tab's own messages", () => {
    expect(decideTabSyncMessage(null, makeTabSyncMessage({ tabId: TAB_A }), TAB_A)).toEqual({
      apply: false,
      reason: "own_message",
    });
  });

  it("applies the first message and any higher epoch", () => {
    expect(decideTabSyncMessage(null, makeTabSyncMessage(), TAB_A)).toEqual({ apply: true });
    expect(
      decideTabSyncMessage(marker(10, TAB_C, "session_revoked"), makeTabSyncMessage({ epoch: 11, type: "tenant_switched" }), TAB_A),
    ).toEqual({ apply: true });
  });

  it("replay: ignores a lower epoch, and an equal epoch from the same tab", () => {
    expect(decideTabSyncMessage(marker(10, TAB_B, "tenant_switched"), makeTabSyncMessage({ epoch: 9, type: "session_revoked" }), TAB_A)).toEqual({
      apply: false,
      reason: "replay",
    });
    expect(decideTabSyncMessage(marker(10, TAB_B, "wallet_logout"), makeTabSyncMessage({ epoch: 10 }), TAB_A)).toEqual({
      apply: false,
      reason: "replay",
    });
  });

  it("boundary (equal epochs, different tabs): most restrictive wins, then the greater tabId", () => {
    const order: TabSyncEventType[] = ["session_revoked", "wallet_logout", "recent_auth_expired", "tenant_switched"];
    for (let i = 0; i < order.length; i += 1) {
      for (let j = 0; j < order.length; j += 1) {
        const decision = decideTabSyncMessage(
          marker(10, TAB_C, order[j]),
          makeTabSyncMessage({ epoch: 10, tabId: TAB_B, type: order[i] }),
          TAB_A,
        );
        const expected = i < j ? true : i > j ? false : TAB_B > TAB_C;
        expect(decision.apply).toBe(expected);
      }
    }
  });

  it("concurrency: two concurrent events resolve to the same winner in either arrival order", () => {
    const resolve = (messages: TabSyncMessage[]) => {
      let last: TabSyncAppliedMarker | null = null;
      for (const message of messages) {
        if (decideTabSyncMessage(last, message, TAB_A).apply) {
          last = { epoch: message.epoch, tabId: message.tabId, type: message.type };
        }
      }
      return last;
    };

    for (const first of TAB_SYNC_EVENT_TYPES) {
      for (const second of TAB_SYNC_EVENT_TYPES) {
        const fromB = makeTabSyncMessage({ epoch: 50, tabId: TAB_B, type: first });
        const fromC = makeTabSyncMessage({ epoch: 50, tabId: TAB_C, type: second });
        const winner = resolve([fromB, fromC]);
        expect(resolve([fromC, fromB])).toEqual(winner);
        expect(TAB_SYNC_RESTRICTIVENESS[winner!.type]).toBe(
          Math.max(TAB_SYNC_RESTRICTIVENESS[first], TAB_SYNC_RESTRICTIVENESS[second]),
        );
      }
    }
  });
});
