import {
  canViewPolicyCommitmentHistory,
  commitmentEffectiveAt,
  compareCommitmentHashes,
  latestIndexedCommitment,
  normalizeCommitmentHash,
  reconcileCommitmentHistory,
} from "../policy-commitment-history";
import {
  HASH_V1,
  HASH_V2,
  HASH_V3,
  HASH_V3_UPPER,
  makeCommitment,
  makeHistory,
} from "@/tests/fixtures/issuer-policy-commitment-fixtures";

describe("compareCommitmentHashes: opaque, exact, case-normalized, full length", () => {
  it("identical when equal ignoring case", () => {
    expect(compareCommitmentHashes(HASH_V3, HASH_V3_UPPER)).toBe("identical");
  });

  it("different for any other full-length hash, including one differing only in the last character", () => {
    expect(compareCommitmentHashes(HASH_V1, HASH_V2)).toBe("different");
    expect(compareCommitmentHashes(HASH_V1, HASH_V1.slice(0, 63) + "2")).toBe("different");
  });

  it("never treats a prefix, truncation, 0x form or padded value as a match", () => {
    expect(compareCommitmentHashes(HASH_V1, HASH_V1.slice(0, 16))).toBe("invalid");
    expect(compareCommitmentHashes(HASH_V1, "0x" + HASH_V1)).toBe("invalid");
    expect(compareCommitmentHashes(HASH_V1, HASH_V1 + " ")).toBe("invalid");
    expect(compareCommitmentHashes("", "")).toBe("invalid");
  });

  it("normalizes only case", () => {
    expect(normalizeCommitmentHash(HASH_V3_UPPER)).toBe(HASH_V3);
    expect(normalizeCommitmentHash(" " + HASH_V3)).toBeNull();
  });
});

describe("commitmentEffectiveAt: exact effective-ledger boundary", () => {
  const history = makeHistory();

  it("boundary: at effective_ledger == L the new version is already effective", () => {
    expect(commitmentEffectiveAt(history, 2_000)).toMatchObject({ status: "effective", commitment: { version: 2 } });
    expect(commitmentEffectiveAt(history, 3_000)).toMatchObject({ status: "effective", commitment: { version: 3 } });
  });

  it("boundary: one ledger earlier the previous version still applies", () => {
    expect(commitmentEffectiveAt(history, 1_999)).toMatchObject({ status: "effective", commitment: { version: 1 } });
    expect(commitmentEffectiveAt(history, 2_999)).toMatchObject({ status: "effective", commitment: { version: 2 } });
  });

  it("boundary: before the first commitment nothing is effective", () => {
    expect(commitmentEffectiveAt(history, 999)).toEqual({ status: "before_first", firstEffectiveLedger: 1_000 });
    expect(commitmentEffectiveAt(history, 1_000)).toMatchObject({ status: "effective", commitment: { version: 1 } });
  });

  it("boundary: answers at exactly the indexed ledger and refuses one beyond it", () => {
    const stale = makeHistory({ indexedLedger: 3_200, latestLedger: 4_000 });
    expect(commitmentEffectiveAt(stale, 3_200)).toMatchObject({ status: "effective", commitment: { version: 3 } });
    expect(commitmentEffectiveAt(stale, 3_201)).toEqual({ status: "beyond_index", indexedLedger: 3_200 });
  });

  it("boundary: single-version and empty histories", () => {
    const single = makeHistory({ commitments: [makeCommitment({ version: 1, effectiveLedger: 1_000, commitmentHash: HASH_V1 })] });
    expect(commitmentEffectiveAt(single, 1_000)).toMatchObject({ status: "effective", commitment: { version: 1 } });
    expect(commitmentEffectiveAt(single, 3_500)).toMatchObject({ status: "effective", commitment: { version: 1 } });
    expect(commitmentEffectiveAt(makeHistory({ commitments: [] }), 2_000)).toEqual({ status: "empty" });
  });

  it("does not depend on the order versions arrive in", () => {
    const shuffled = makeHistory({ commitments: [...makeHistory().commitments].reverse() });
    expect(commitmentEffectiveAt(shuffled, 2_500)).toMatchObject({ status: "effective", commitment: { version: 2 } });
  });

  it("negative: rejects invalid ledgers and an unindexed history", () => {
    expect(commitmentEffectiveAt(history, 0)).toEqual({ status: "invalid_ledger" });
    expect(commitmentEffectiveAt(history, 1.5)).toEqual({ status: "invalid_ledger" });
    expect(commitmentEffectiveAt(history, Number.NaN)).toEqual({ status: "invalid_ledger" });
    expect(commitmentEffectiveAt(makeHistory({ indexedLedger: null, commitments: [] }), 10)).toEqual({
      status: "beyond_index",
      indexedLedger: null,
    });
  });

  it("latestIndexedCommitment is the version effective at the indexed ledger", () => {
    expect(latestIndexedCommitment(history)?.version).toBe(3);
    expect(latestIndexedCommitment(makeHistory({ indexedLedger: null, commitments: [] }))).toBeNull();
  });
});

describe("reconcileCommitmentHistory: distinct states", () => {
  it("in_sync when caught up and hashes are identical (case-insensitive)", () => {
    expect(reconcileCommitmentHistory(makeHistory({ onChainCurrentHash: HASH_V3_UPPER }))).toEqual({
      kind: "in_sync",
      ledger: 3_500,
    });
  });

  it("stale_projection when the index is behind the chain, even if the hashes match (never shown as current)", () => {
    expect(reconcileCommitmentHistory(makeHistory({ indexedLedger: 3_200, latestLedger: 4_000 }))).toEqual({
      kind: "stale_projection",
      indexedLedger: 3_200,
      latestLedger: 4_000,
      indexedAt: "2026-01-03T00:00:00.000Z",
      hashDiffers: false,
    });
  });

  it("stale_projection reports whether the last indexed hash already differs", () => {
    const state = reconcileCommitmentHistory(
      makeHistory({ indexedLedger: 3_200, latestLedger: 4_000, onChainCurrentHash: "ff".repeat(32) }),
    );
    expect(state).toMatchObject({ kind: "stale_projection", hashDiffers: true });
    expect(
      reconcileCommitmentHistory(makeHistory({ indexedLedger: 3_200, latestLedger: 4_000, onChainCurrentHash: null })),
    ).toMatchObject({ kind: "stale_projection", hashDiffers: null });
  });

  it("boundary: indexed exactly at the latest ledger is caught up; one behind is stale", () => {
    expect(reconcileCommitmentHistory(makeHistory({ indexedLedger: 3_500, latestLedger: 3_500 })).kind).toBe("in_sync");
    expect(reconcileCommitmentHistory(makeHistory({ indexedLedger: 3_499, latestLedger: 3_500 })).kind).toBe(
      "stale_projection",
    );
  });

  it("mismatch when caught up and the backend hash differs from the chain", () => {
    expect(reconcileCommitmentHistory(makeHistory({ onChainCurrentHash: HASH_V2 }))).toEqual({
      kind: "mismatch",
      ledger: 3_500,
      backendHash: HASH_V3,
      onChainHash: HASH_V2,
    });
  });

  it("mismatch when the chain has a commitment the backend has not recorded", () => {
    expect(reconcileCommitmentHistory(makeHistory({ commitments: [] }))).toMatchObject({
      kind: "mismatch",
      backendHash: null,
    });
  });

  it("pending when nothing is indexed yet", () => {
    expect(reconcileCommitmentHistory(makeHistory({ indexedLedger: null, indexedAt: null, commitments: [] }))).toEqual({
      kind: "pending",
    });
  });

  it("unknown (fails closed, never in_sync) when the on-chain hash was not read", () => {
    expect(reconcileCommitmentHistory(makeHistory({ onChainCurrentHash: null }))).toEqual({
      kind: "unknown",
      reason: "on_chain_not_read",
    });
  });
});

describe("canViewPolicyCommitmentHistory", () => {
  it.each([
    ["ADMIN", true],
    ["ISSUER", true],
    ["WORKER", false],
    ["DEVELOPER", false],
    ["admin", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("role %p -> %p", (role, expected) => {
    expect(canViewPolicyCommitmentHistory(role)).toBe(expected);
  });
});
