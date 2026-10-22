/**
 * @jest-environment jsdom
 */

import { ApiError } from "@/lib/errors";
import { apiClient } from "@/lib/api/client";
import {
  CSP_DEFAULT_PAGE_SIZE,
  CSP_MAX_CURSOR_LENGTH,
  CSP_MAX_PAGE_SIZE,
  CSP_MAX_RELEASES,
  CSP_STALE_AFTER_MS,
  CspRequestError,
  buildCspViolationQuery,
  canViewCspDiagnostics,
  fetchCspViolations,
  getCspRemediation,
  isRegression,
  isReportStale,
  isSafeReleaseId,
  parseCspViolationGroup,
  parseCspViolationReport,
  summarizeCspViolations,
  CSP_DIRECTIVES,
  CSP_ROUTE_CATEGORIES,
} from "../csp-violations";
import { CSP_TOKEN, FORBIDDEN_FIELDS, wireGroup, wireReport } from "@/tests/fixtures/csp-fixtures";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  apiClient: jest.fn(),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;
beforeEach(() => mockedApiClient.mockReset());

describe("release ids", () => {
  it.each(["2026.03.1", "1.2.3", "v1.2.3-rc.1", "a1b2c3d", "a".repeat(40), "build_42".replace("_", "-"), "A".repeat(64)])(
    "accepts %s",
    (value) => expect(isSafeReleaseId(value)).toBe(true),
  );

  it.each([
    "",
    "a".repeat(65),
    "https://example.invalid/x",
    "a/b",
    "has space",
    ".leading-dot",
    "eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "sk_live_abc",
    "token-abc",
    "bearer.abc",
    "x?y=1",
    42,
    null,
  ])("rejects %j", (value) => expect(isSafeReleaseId(value)).toBe(false));
});

describe("parseCspViolationGroup", () => {
  it("keeps a valid group", () => {
    expect(parseCspViolationGroup(wireGroup())).toEqual({ status: "ok", group: wireGroup() });
  });

  it("drops fields outside the contract without exposing them", () => {
    const result = parseCspViolationGroup({ ...wireGroup(), internalNote: "ops only" });
    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("ops only");
  });

  it.each(Object.entries(FORBIDDEN_FIELDS))("withholds a group carrying %s", (key, value) => {
    const result = parseCspViolationGroup({ ...wireGroup(), [key]: value });
    expect(result).toEqual({ status: "withheld" });
    expect(JSON.stringify(result)).not.toContain(String(value));
  });

  it("withholds regardless of key casing and separators", () => {
    for (const key of ["Blocked_URI", "BLOCKED-URI", "blockedURI", "Source-File"]) {
      expect(parseCspViolationGroup({ ...wireGroup(), [key]: "x" })).toEqual({ status: "withheld" });
    }
  });

  it.each([
    ["non-object", "text"],
    ["null", null],
    ["array", []],
    ["unknown directive", wireGroup({ directive: "made-up-src" })],
    ["unknown route category", wireGroup({ routeCategory: "/proofs/abc123" })],
    ["unknown blocked kind", wireGroup({ blockedKind: "https://x.invalid" })],
    ["url as release", wireGroup({ release: "https://x.invalid/1" })],
    ["url as first seen release", wireGroup({ firstSeenRelease: "a/b" })],
    ["unsafe id", wireGroup({ id: "has space" })],
    ["empty id", wireGroup({ id: "" })],
    ["missing count", wireGroup({ count: undefined })],
    ["string count", wireGroup({ count: "42" })],
    ["zero count", wireGroup({ count: 0 })],
    ["negative count", wireGroup({ count: -1 })],
    ["fractional count", wireGroup({ count: 1.5 })],
    ["NaN count", wireGroup({ count: Number.NaN })],
    ["unsafe integer count", wireGroup({ count: Number.MAX_SAFE_INTEGER + 1 })],
    ["bad first seen", wireGroup({ firstSeenAt: "soon" })],
    ["first seen after last seen", wireGroup({ firstSeenAt: "2026-03-10T12:00:00.000Z", lastSeenAt: "2026-03-10T11:00:00.000Z" })],
  ])("marks %s invalid", (_name, raw) => {
    expect(parseCspViolationGroup(raw)).toEqual({ status: "invalid" });
  });

  it("accepts the smallest and largest valid counts and equal first/last seen", () => {
    expect(parseCspViolationGroup(wireGroup({ count: 1 })).status).toBe("ok");
    expect(parseCspViolationGroup(wireGroup({ count: Number.MAX_SAFE_INTEGER })).status).toBe("ok");
    const same = "2026-03-10T11:00:00.000Z";
    expect(parseCspViolationGroup(wireGroup({ firstSeenAt: same, lastSeenAt: same })).status).toBe("ok");
  });

  it("accepts every known directive and route category", () => {
    for (const directive of CSP_DIRECTIVES) expect(parseCspViolationGroup(wireGroup({ directive })).status).toBe("ok");
    for (const routeCategory of CSP_ROUTE_CATEGORIES) expect(parseCspViolationGroup(wireGroup({ routeCategory })).status).toBe("ok");
  });
});

describe("parseCspViolationReport", () => {
  it("returns validated groups with metadata", () => {
    const report = parseCspViolationReport(wireReport([wireGroup(), wireGroup({ id: "grp_2", directive: "img-src" })]), "req-1");
    expect(report.groups.map((g) => g.id)).toEqual(["grp_script_embed", "grp_2"]);
    expect(report.currentRelease).toBe("2026.03.1");
    expect(report.releases).toEqual(["2026.03.1", "2026.02.4"]);
    expect(report.requestId).toBe("req-1");
    expect(report.withheldCount).toBe(0);
    expect(report.invalidCount).toBe(0);
  });

  it("returns an empty report without inventing groups", () => {
    expect(parseCspViolationReport(wireReport([]), "r").groups).toEqual([]);
  });

  it("withholds and counts forbidden groups while keeping the clean ones", () => {
    const report = parseCspViolationReport(
      wireReport([wireGroup(), wireGroup({ id: "grp_bad", blockedUri: "https://x.invalid/a.js" }), wireGroup({ id: "grp_broken", count: -3 })]),
      "r",
    );
    expect(report.groups.map((g) => g.id)).toEqual(["grp_script_embed"]);
    expect(report.withheldCount).toBe(1);
    expect(report.invalidCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain("x.invalid");
  });

  it("keeps the first of duplicate ids", () => {
    const report = parseCspViolationReport(wireReport([wireGroup({ count: 5 }), wireGroup({ count: 99 })]), "r");
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.count).toBe(5);
  });

  it.each([
    ["null", null],
    ["no groups", { ...wireReport(), groups: undefined }],
    ["bad generatedAt", wireReport([], { generatedAt: "now" })],
    ["bad window", wireReport([], { windowStart: "x" })],
    ["window reversed", wireReport([], { windowStart: "2026-03-11T00:00:00.000Z", windowEnd: "2026-03-10T00:00:00.000Z" })],
    ["unsafe current release", wireReport([], { currentRelease: "https://x.invalid" })],
    ["releases not an array", wireReport([], { releases: "2026.03.1" })],
    ["unsafe release in list", wireReport([], { releases: ["ok", "a/b"] })],
    ["invalid cursor", wireReport([], { nextCursor: "has space" })],
    ["numeric cursor", wireReport([], { nextCursor: 5 })],
  ])("rejects a report with %s", (_name, raw) => {
    expect(() => parseCspViolationReport(raw, "r")).toThrow(expect.objectContaining({ kind: "invalid-response" }));
  });

  it("accepts a window where start equals end", () => {
    const t = "2026-03-10T11:55:00.000Z";
    expect(() => parseCspViolationReport(wireReport([], { windowStart: t, windowEnd: t }), "r")).not.toThrow();
  });

  it("allows exactly the maximum number of releases and rejects one more", () => {
    const releases = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
    expect(() => parseCspViolationReport(wireReport([], { releases: releases(CSP_MAX_RELEASES) }), "r")).not.toThrow();
    expect(() => parseCspViolationReport(wireReport([], { releases: releases(CSP_MAX_RELEASES + 1) }), "r")).toThrow();
  });

  it("de-duplicates releases", () => {
    expect(parseCspViolationReport(wireReport([], { releases: ["a", "a", "b"] }), "r").releases).toEqual(["a", "b"]);
  });

  it("ends pagination when the server echoes the request cursor, and keeps a new one", () => {
    expect(parseCspViolationReport(wireReport([], { nextCursor: "same" }), "r", "same").nextCursor).toBeNull();
    expect(parseCspViolationReport(wireReport([], { nextCursor: "next" }), "r", "same").nextCursor).toBe("next");
  });

  it("accepts a cursor of exactly the maximum length and rejects one more", () => {
    expect(() => parseCspViolationReport(wireReport([], { nextCursor: "a".repeat(CSP_MAX_CURSOR_LENGTH) }), "r")).not.toThrow();
    expect(() => parseCspViolationReport(wireReport([], { nextCursor: "a".repeat(CSP_MAX_CURSOR_LENGTH + 1) }), "r")).toThrow();
  });
});

describe("derived state", () => {
  it("flags a regression only when seen first, and only, in the current release", () => {
    const group = wireGroup() as never;
    expect(isRegression(group, "2026.03.1")).toBe(true);
    expect(isRegression(wireGroup({ firstSeenRelease: "2026.02.4" }) as never, "2026.03.1")).toBe(false);
    expect(isRegression(wireGroup({ release: "2026.02.4", firstSeenRelease: "2026.02.4" }) as never, "2026.03.1")).toBe(false);
  });

  it("treats a report as stale only when strictly older than 15 minutes", () => {
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    expect(isReportStale(new Date(now - CSP_STALE_AFTER_MS).toISOString(), now)).toBe(false);
    expect(isReportStale(new Date(now - CSP_STALE_AFTER_MS - 1).toISOString(), now)).toBe(true);
    expect(isReportStale(new Date(now + 60_000).toISOString(), now)).toBe(false);
  });

  it("sums counts and regressions", () => {
    const groups = [wireGroup({ count: 3 }), wireGroup({ id: "b", count: 4, firstSeenRelease: "old" })] as never[];
    expect(summarizeCspViolations(groups, "2026.03.1")).toEqual({ totalCount: 7, groupCount: 2, regressionCount: 1 });
    expect(summarizeCspViolations([], "x")).toEqual({ totalCount: 0, groupCount: 0, regressionCount: 0 });
  });

  it.each([["ADMIN", true], ["ISSUER", true], ["WORKER", false], ["DEVELOPER", false], ["admin", false], ["", false], [null, false], [undefined, false]])(
    "role %j may view: %s",
    (role, expected) => expect(canViewCspDiagnostics(role as string | null)).toBe(expected),
  );
});

describe("remediation", () => {
  it("is built by the client from a fixed table and never contains response data", () => {
    const remediation = getCspRemediation({ directive: "script-src-elem", blockedKind: "third-party", routeCategory: "embed" });
    expect(remediation.title).toContain("script-src-elem");
    expect(remediation.steps.length).toBeGreaterThanOrEqual(3);
    const hrefs = remediation.links.map((l) => l.href);
    expect(hrefs).toContain("/security");
    expect(hrefs).toContain("/status");
    expect(hrefs.some((h) => h.endsWith("/csp/script-src-elem"))).toBe(true);
    expect(remediation.links.filter((l) => l.external)).toHaveLength(1);
    expect(remediation.links.filter((l) => !l.external).every((l) => l.href.startsWith("/"))).toBe(true);
  });

  it("never suggests widening default-src or adding unsafe-eval", () => {
    const text = getCspRemediation({ directive: "script-src", blockedKind: "eval", routeCategory: "public" }).steps.join(" ");
    expect(text).toMatch(/Do not add unsafe-eval/);
    expect(text).toMatch(/never default-src/);
  });
});

describe("buildCspViolationQuery", () => {
  it("defaults to a 24h window and the default page size", () => {
    const params = new URLSearchParams(buildCspViolationQuery({}));
    expect(Object.fromEntries(params)).toEqual({ window: "24h", limit: String(CSP_DEFAULT_PAGE_SIZE) });
  });

  it("includes filters and cursor", () => {
    const params = new URLSearchParams(
      buildCspViolationQuery({ window: "7d", filter: { directive: "img-src", routeCategory: "proofs", release: "2026.03.1" }, cursor: "c_1", limit: 10 }),
    );
    expect(Object.fromEntries(params)).toEqual({ window: "7d", limit: "10", directive: "img-src", routeCategory: "proofs", release: "2026.03.1", cursor: "c_1" });
  });

  it.each([1, CSP_MAX_PAGE_SIZE])("accepts page size %s", (limit) => expect(() => buildCspViolationQuery({ limit })).not.toThrow());
  it.each([0, -1, CSP_MAX_PAGE_SIZE + 1, 2.5, Number.NaN])("rejects page size %s", (limit) =>
    expect(() => buildCspViolationQuery({ limit })).toThrow(CspRequestError),
  );

  it.each([
    [{ window: "30d" as never }],
    [{ filter: { directive: "nope" as never } }],
    [{ filter: { routeCategory: "/x" as never } }],
    [{ filter: { release: "a/b" } }],
    [{ cursor: "bad cursor" }],
    [{ cursor: "" }],
  ])("rejects %j before any request", (options) => {
    expect(() => buildCspViolationQuery(options)).toThrow(expect.objectContaining({ kind: "invalid-request" }));
  });
});

describe("fetchCspViolations", () => {
  const signal = () => new AbortController().signal;

  it("calls the versioned endpoint with bearer auth and a correlation id", async () => {
    mockedApiClient.mockResolvedValue(wireReport());
    const report = await fetchCspViolations({ token: CSP_TOKEN, signal: signal() });

    const call = mockedApiClient.mock.calls[0]![0];
    expect(call.path).toBe(`/csp-violations?window=24h&limit=${CSP_DEFAULT_PAGE_SIZE}`);
    expect(call.method).toBe("GET");
    const headers = call.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CSP_TOKEN}`);
    expect(headers["X-Request-Id"]).toBe(report.requestId);
    expect(report.requestId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not call the network without a token or with an invalid request", async () => {
    await expect(fetchCspViolations({ token: "", signal: signal() })).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(fetchCspViolations({ token: CSP_TOKEN, signal: signal(), cursor: "bad cursor" })).rejects.toMatchObject({ kind: "invalid-request" });
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
  ])("maps HTTP %s to %s", async (status, kind) => {
    mockedApiClient.mockRejectedValue(new ApiError({ status, message: "server detail" }));
    const error = await fetchCspViolations({ token: CSP_TOKEN, signal: signal() }).catch((e) => e);
    expect(error).toMatchObject({ kind });
    expect(error.message).not.toContain("server detail");
    expect(error.requestId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reports malformed bodies and unexpected errors", async () => {
    mockedApiClient.mockResolvedValueOnce({ items: [] });
    await expect(fetchCspViolations({ token: CSP_TOKEN, signal: signal() })).rejects.toMatchObject({ kind: "invalid-response" });
    mockedApiClient.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(fetchCspViolations({ token: CSP_TOKEN, signal: signal() })).rejects.toMatchObject({ kind: "failed" });
  });

  it("rethrows an abort so callers can ignore it", async () => {
    const controller = new AbortController();
    mockedApiClient.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const error = await fetchCspViolations({ token: CSP_TOKEN, signal: controller.signal }).catch((e) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
  });

  it("returns nothing it was not given: withheld data never reaches the caller", async () => {
    mockedApiClient.mockResolvedValue(wireReport([wireGroup({ blockedUri: "https://leak.invalid/x" })]));
    const report = await fetchCspViolations({ token: CSP_TOKEN, signal: signal() });
    expect(report.groups).toEqual([]);
    expect(report.withheldCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain("leak.invalid");
  });
});
