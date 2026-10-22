/**
 * @jest-environment jsdom
 */

import {
  ISSUER_POLICY_COMMITMENTS_SCHEMA_VERSION,
  MAX_RELATED_PROOF_REFERENCES,
  parseIssuerPolicyCommitments,
} from "../issuer-policy-commitments";
import {
  HASH_V1,
  HASH_V3_UPPER,
  OTHER_SYNTHETIC_ISSUER_ID,
  SYNTHETIC_ISSUER_ID,
  makeCommitment,
  makeHistory,
} from "@/tests/fixtures/issuer-policy-commitment-fixtures";

const parse = (raw: unknown) => parseIssuerPolicyCommitments(raw, SYNTHETIC_ISSUER_ID);
const reason = (raw: unknown) => {
  const result = parse(raw);
  return result.ok ? "ok" : result.reason;
};

describe("parseIssuerPolicyCommitments (#267 proposed contract v1)", () => {
  it("positive: accepts a valid v1 history, including upper-case hex", () => {
    const history = makeHistory({ onChainCurrentHash: HASH_V3_UPPER });
    expect(parse(history)).toEqual({ ok: true, history });
  });

  it("boundary: accepts an empty and a single-version history", () => {
    expect(reason(makeHistory({ commitments: [] }))).toBe("ok");
    expect(reason(makeHistory({ commitments: [makeCommitment()] }))).toBe("ok");
  });

  it("positive: accepts a not-yet-indexed history", () => {
    expect(reason(makeHistory({ indexedLedger: null, indexedAt: null, commitments: [] }))).toBe("ok");
  });

  it.each([2, 0, "1", null])("negative: fails closed on schemaVersion %p", (schemaVersion) => {
    expect(reason({ ...makeHistory(), schemaVersion })).toBe("unsupported_version");
  });

  it("negative: a response without schemaVersion is invalid", () => {
    const { schemaVersion: _omit, ...rest } = makeHistory();
    void _omit;
    expect(reason(rest)).toBe("invalid_response");
    expect(ISSUER_POLICY_COMMITMENTS_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    ["63 hex chars", HASH_V1.slice(1)],
    ["65 hex chars", HASH_V1 + "1"],
    ["a 0x prefix", "0x" + HASH_V1.slice(2)],
    ["non-hex characters", "zz".repeat(32)],
    ["surrounding whitespace", " " + HASH_V1.slice(1)],
  ])("negative: rejects a commitment hash with %s", (_label, commitmentHash) => {
    expect(reason(makeHistory({ commitments: [makeCommitment({ commitmentHash })] }))).toBe("invalid_response");
  });

  it("negative: rejects decoded policy content smuggled in as an extra field", () => {
    expect(reason(makeHistory({ commitments: [{ ...makeCommitment(), policy: { minIncome: 1 } } as never] }))).toBe(
      "invalid_response",
    );
    expect(reason({ ...makeHistory(), policyDocument: "synthetic" })).toBe("invalid_response");
  });

  it("negative: rejects duplicate versions and non-increasing effective ledgers (ambiguous effective commitment)", () => {
    expect(
      reason(makeHistory({ commitments: [makeCommitment({ version: 1 }), makeCommitment({ version: 1, effectiveLedger: 2_000 })] })),
    ).toBe("invalid_response");
    expect(
      reason(
        makeHistory({
          commitments: [makeCommitment({ version: 1, effectiveLedger: 2_000 }), makeCommitment({ version: 2, effectiveLedger: 2_000 })],
        }),
      ),
    ).toBe("invalid_response");
  });

  it("negative: rejects an index ahead of the chain and commitments beyond the indexed ledger", () => {
    expect(reason(makeHistory({ indexedLedger: 3_501 }))).toBe("invalid_response");
    expect(reason(makeHistory({ indexedLedger: 2_999, latestLedger: 3_500 }))).toBe("invalid_response");
  });

  it("negative: rejects more proof references than the count, or more than the reference cap", () => {
    expect(
      reason(makeHistory({ commitments: [makeCommitment({ relatedProofCount: 1, relatedProofIds: ["p-1", "p-2"] })] })),
    ).toBe("invalid_response");
    const ids = Array.from({ length: MAX_RELATED_PROOF_REFERENCES + 1 }, (_, i) => "p-" + i);
    expect(reason(makeHistory({ commitments: [makeCommitment({ relatedProofCount: 100, relatedProofIds: ids })] }))).toBe(
      "invalid_response",
    );
  });

  it("negative: rejects proof references that are not opaque ids", () => {
    expect(
      reason(makeHistory({ commitments: [makeCommitment({ relatedProofCount: 1, relatedProofIds: ["<script>"] })] })),
    ).toBe("invalid_response");
  });

  it("negative: rejects non-positive or fractional ledgers", () => {
    expect(reason(makeHistory({ latestLedger: 0 }))).toBe("invalid_response");
    expect(reason(makeHistory({ commitments: [makeCommitment({ effectiveLedger: 1.5 })] }))).toBe("invalid_response");
  });

  it("replay: a response for a different issuer is rejected", () => {
    expect(reason(makeHistory({ issuerId: OTHER_SYNTHETIC_ISSUER_ID }))).toBe("issuer_mismatch");
  });

  it.each([null, undefined, "history", [], 42])("negative: rejects %p", (raw) => {
    expect(reason(raw)).toBe("invalid_response");
  });
});
