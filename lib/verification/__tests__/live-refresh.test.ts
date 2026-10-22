import {
  EVIDENCE_CLOCK_SKEW_MS,
  MAX_RETRY_AFTER_MS,
  assessFreshness,
  buildSourceOptions,
  canRequestLiveRefresh,
  cooldownRemainingMs,
  firstSelectableSource,
  parseRetryAfter,
} from "../live-refresh";
import { BASE_TIME, FIVE_MINUTES_MS, isoAt } from "@/tests/fixtures/live-verification-fixtures";

const policy = { maxEvidenceAgeMs: FIVE_MINUTES_MS };

describe("assessFreshness: exact maxAge boundary", () => {
  it("boundary: fresh 1 ms before maxAge, STALE at exactly maxAge and after", () => {
    expect(assessFreshness(isoAt(BASE_TIME - FIVE_MINUTES_MS + 1), policy, BASE_TIME)).toEqual({
      status: "fresh",
      ageMs: FIVE_MINUTES_MS - 1,
      maxAgeMs: FIVE_MINUTES_MS,
    });
    expect(assessFreshness(isoAt(BASE_TIME - FIVE_MINUTES_MS), policy, BASE_TIME)).toEqual({
      status: "stale",
      ageMs: FIVE_MINUTES_MS,
      maxAgeMs: FIVE_MINUTES_MS,
    });
    expect(assessFreshness(isoAt(BASE_TIME - FIVE_MINUTES_MS - 1), policy, BASE_TIME).status).toBe("stale");
  });

  it("treats small future skew as age 0, and rejects evidence beyond the skew window", () => {
    expect(assessFreshness(isoAt(BASE_TIME + EVIDENCE_CLOCK_SKEW_MS), policy, BASE_TIME)).toMatchObject({
      status: "fresh",
      ageMs: 0,
    });
    expect(assessFreshness(isoAt(BASE_TIME + EVIDENCE_CLOCK_SKEW_MS + 1), policy, BASE_TIME)).toEqual({
      status: "invalid_timestamp",
    });
  });

  it.each([null, { maxEvidenceAgeMs: 0 }, { maxEvidenceAgeMs: -1 }, { maxEvidenceAgeMs: Number.NaN }])(
    "fails closed without a valid policy (%p)",
    (badPolicy) => {
      expect(assessFreshness(isoAt(BASE_TIME), badPolicy, BASE_TIME)).toEqual({ status: "no_policy", ageMs: 0 });
    },
  );

  it("rejects an unparseable timestamp", () => {
    expect(assessFreshness("not a date", policy, BASE_TIME)).toEqual({ status: "invalid_timestamp" });
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("120", BASE_TIME)).toBe(120_000);
    expect(parseRetryAfter(" 0 ", BASE_TIME)).toBe(0);
  });

  it("parses an HTTP-date relative to now and clamps the past to 0", () => {
    expect(parseRetryAfter(new Date(BASE_TIME + 45_000).toUTCString(), BASE_TIME)).toBe(45_000);
    expect(parseRetryAfter(new Date(BASE_TIME - 45_000).toUTCString(), BASE_TIME)).toBe(0);
  });

  it("clamps very long values", () => {
    expect(parseRetryAfter("999999", BASE_TIME)).toBe(MAX_RETRY_AFTER_MS);
  });

  it.each([null, undefined, "", "soon", "-5", "1.5"])("returns null for %p", (value) => {
    expect(parseRetryAfter(value, BASE_TIME)).toBeNull();
  });
});

describe("cooldownRemainingMs", () => {
  it("boundary: 1 ms before the end remains, exactly at the end it is 0", () => {
    expect(cooldownRemainingMs(BASE_TIME + 30_000, BASE_TIME + 29_999)).toBe(1);
    expect(cooldownRemainingMs(BASE_TIME + 30_000, BASE_TIME + 30_000)).toBe(0);
    expect(cooldownRemainingMs(null, BASE_TIME)).toBe(0);
  });
});

describe("canRequestLiveRefresh", () => {
  it.each([
    ["WORKER", true],
    ["ISSUER", true],
    ["ADMIN", true],
    ["DEVELOPER", true],
    ["SUPERUSER", false],
    ["", false],
    [null, false],
  ])("%p -> %p", (role, expected) => {
    expect(canRequestLiveRefresh(role)).toBe(expected);
  });
});

describe("source options", () => {
  it("lists every known source but only advertised ones are selectable", () => {
    const options = buildSourceOptions(["cached_indexer"]);
    expect(options.map((o) => [o.value, o.selectable])).toEqual([
      ["cached_indexer", true],
      ["live_contract", false],
    ]);
  });

  it("lists unknown advertised sources as unknown and never selectable", () => {
    const options = buildSourceOptions(["live_contract", "mempool"]);
    expect(options.find((o) => o.value === "mempool")).toMatchObject({ known: false, selectable: false });
  });

  it("picks the first known supported source, ignoring unknown ones", () => {
    expect(firstSelectableSource(["mempool", "live_contract"])).toBe("live_contract");
    expect(firstSelectableSource(["mempool"])).toBeNull();
    expect(firstSelectableSource([])).toBeNull();
  });
});
