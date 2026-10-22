import {
  LiveRefreshHttpError,
  parseLiveVerificationRefresh,
} from "../live-verification-refresh";
import { ApiError } from "@/lib/errors";
import {
  OTHER_SYNTHETIC_PROOF_ID,
  SYNTHETIC_PROOF_ID,
  makeRefreshResponse,
} from "@/tests/fixtures/live-verification-fixtures";

const requested = { proofId: SYNTHETIC_PROOF_ID, source: "live_contract" as const };
const reason = (raw: unknown) => {
  const result = parseLiveVerificationRefresh(raw, requested);
  return result.ok ? "ok" : result.reason;
};

describe("parseLiveVerificationRefresh (#268 proposed contract v1)", () => {
  it("positive: accepts a valid response for the requested proof and source", () => {
    const raw = makeRefreshResponse();
    expect(parseLiveVerificationRefresh(raw, requested)).toEqual({
      ok: true,
      evidence: { proofId: SYNTHETIC_PROOF_ID, source: "live_contract", observedAt: raw.observedAt, result: "VALID" },
    });
  });

  it.each([2, 0, "1", null])("negative: schemaVersion %p is unsupported", (schemaVersion) => {
    expect(reason({ ...makeRefreshResponse(), schemaVersion })).toBe("unsupported_version");
  });

  it("negative: a response without schemaVersion is invalid", () => {
    const { schemaVersion: _omit, ...rest } = makeRefreshResponse();
    void _omit;
    expect(reason(rest)).toBe("invalid_response");
  });

  it.each([
    ["an unknown source", { source: "mempool" }],
    ["an invalid timestamp", { observedAt: "yesterday" }],
    ["an unknown result", { result: "PROBABLY_VALID" }],
    ["an empty proof id", { proofId: "" }],
  ])("negative: rejects %s", (_label, overrides) => {
    expect(reason({ ...makeRefreshResponse(), ...overrides })).toBe("invalid_response");
  });

  it("negative: rejects extra fields such as raw proof or claim data", () => {
    expect(reason({ ...makeRefreshResponse(), claims: { income: 1 } })).toBe("invalid_response");
  });

  it.each([null, "ok", [], 1])("negative: rejects %p", (raw) => {
    expect(reason(raw)).toBe("invalid_response");
  });

  it("replay: rejects a response for another proof", () => {
    expect(reason(makeRefreshResponse({ proofId: OTHER_SYNTHETIC_PROOF_ID }))).toBe("proof_mismatch");
  });

  it("replay: rejects a response from a different source than requested", () => {
    expect(reason(makeRefreshResponse({ source: "cached_indexer" }))).toBe("source_mismatch");
  });

  it("LiveRefreshHttpError is an ApiError carrying the raw Retry-After", () => {
    const error = new LiveRefreshHttpError(429, "synthetic", "30");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("30");
    expect(new LiveRefreshHttpError(503, "synthetic").retryAfter).toBeNull();
  });
});
