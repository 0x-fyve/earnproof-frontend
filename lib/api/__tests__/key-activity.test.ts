import {
  fetchMockKeyActivity,
  isStaleLastUsed,
  keyActivityStateLabel,
  totalOutcomeCount,
} from "../key-activity";

describe("key-activity: active key", () => {
  it("reports an active state with a recent lastUsedAt and category breakdown", async () => {
    const detail = await fetchMockKeyActivity("key-active");
    expect(detail.state).toBe("active");
    expect(detail.lastUsedAt).not.toBeNull();
    expect(detail.categories.length).toBeGreaterThan(0);
    expect(totalOutcomeCount(detail.outcomes)).toBeGreaterThan(0);
  });
});

describe("key-activity: inactive/never-used key", () => {
  it("reports never-used with no categories and a null lastUsedAt", async () => {
    const detail = await fetchMockKeyActivity("key-never-used");
    expect(detail.state).toBe("never-used");
    expect(detail.lastUsedAt).toBeNull();
    expect(detail.categories).toEqual([]);
    expect(totalOutcomeCount(detail.outcomes)).toBe(0);
  });
});

describe("key-activity: revoked key", () => {
  it("reports revoked while still surfacing historical usage", async () => {
    const detail = await fetchMockKeyActivity("key-revoked");
    expect(detail.state).toBe("revoked");
    expect(detail.lastUsedAt).not.toBeNull();
  });
});

describe("key-activity: stale key", () => {
  it("reports stale for a key unused beyond the staleness threshold", async () => {
    const detail = await fetchMockKeyActivity("key-stale");
    expect(detail.state).toBe("stale");
    expect(isStaleLastUsed(detail.lastUsedAt)).toBe(true);
  });

  it("does not consider a recent timestamp stale", () => {
    expect(isStaleLastUsed(new Date().toISOString())).toBe(false);
  });

  it("does not consider a null timestamp stale", () => {
    expect(isStaleLastUsed(null)).toBe(false);
  });
});

describe("key-activity: forbidden/unavailable", () => {
  it("reports unavailable without exposing any usage data", async () => {
    const detail = await fetchMockKeyActivity("key-forbidden");
    expect(detail.state).toBe("unavailable");
    expect(detail.categories).toEqual([]);
    expect(detail.lastUsedAt).toBeNull();
  });
});

describe("key-activity: labels", () => {
  it("has a label for every state", () => {
    expect(keyActivityStateLabel("active")).toBe("Active");
    expect(keyActivityStateLabel("stale")).toBe("Stale");
    expect(keyActivityStateLabel("never-used")).toBe("Never used");
    expect(keyActivityStateLabel("revoked")).toBe("Revoked");
    expect(keyActivityStateLabel("unavailable")).toBe("Unavailable");
  });
});

describe("key-activity: abort handling", () => {
  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchMockKeyActivity("key-active", { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
