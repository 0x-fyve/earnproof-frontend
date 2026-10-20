import {
  computeIdentifierDisplay,
  describeIdentifierKind,
  isMalformedIdentifier,
  MIN_LENGTH_TO_TRUNCATE,
} from "../identifier-display";

const STELLAR_ADDRESS_1 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVAVGVHWGD5CDGDRA7VYAGF5D5MFBXBW";
const STELLAR_ADDRESS_2_SIMILAR_PREFIX = "GA7QYNF7XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1";

describe("computeIdentifierDisplay", () => {
  it("truncates a long identifier, preserving the full value unchanged", () => {
    const result = computeIdentifierDisplay(STELLAR_ADDRESS_1);
    expect(result.isTruncatable).toBe(true);
    expect(result.fullValue).toBe(STELLAR_ADDRESS_1);
    expect(result.compactLabel).not.toBe(STELLAR_ADDRESS_1);
  });

  it("does not truncate a short value", () => {
    const result = computeIdentifierDisplay("short-id");
    expect(result.isTruncatable).toBe(false);
    expect(result.compactLabel).toBe("short-id");
    expect(result.fullValue).toBe("short-id");
  });

  it("the boundary at MIN_LENGTH_TO_TRUNCATE is exclusive (exactly at the boundary is not truncated)", () => {
    const exact = "a".repeat(MIN_LENGTH_TO_TRUNCATE);
    const result = computeIdentifierDisplay(exact);
    expect(result.isTruncatable).toBe(false);
  });

  it("one character past the boundary is truncated", () => {
    const overBoundary = "a".repeat(MIN_LENGTH_TO_TRUNCATE + 1);
    const result = computeIdentifierDisplay(overBoundary);
    expect(result.isTruncatable).toBe(true);
  });

  it("two identifiers sharing a prefix produce distinguishable compact labels (trailing characters differ)", () => {
    const a = computeIdentifierDisplay(STELLAR_ADDRESS_1);
    const b = computeIdentifierDisplay(STELLAR_ADDRESS_2_SIMILAR_PREFIX);
    expect(a.compactLabel).not.toBe(b.compactLabel);
  });

  it("the compact label never equals the full value for a truncatable identifier (never silently 'truncates' to the same string)", () => {
    const result = computeIdentifierDisplay(STELLAR_ADDRESS_1);
    expect(result.compactLabel.length).toBeLessThan(result.fullValue.length);
  });

  it("handles an empty string without throwing", () => {
    expect(() => computeIdentifierDisplay("")).not.toThrow();
    const result = computeIdentifierDisplay("");
    expect(result.isTruncatable).toBe(false);
    expect(result.fullValue).toBe("");
  });
});

describe("describeIdentifierKind", () => {
  it("returns a distinct human-readable label for every kind", () => {
    const labels = [
      describeIdentifierKind("wallet-address"),
      describeIdentifierKind("transaction-hash"),
      describeIdentifierKind("proof-id"),
      describeIdentifierKind("credential-hash"),
      describeIdentifierKind("key-id"),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("isMalformedIdentifier", () => {
  it("flags an empty string as malformed", () => {
    expect(isMalformedIdentifier("")).toBe(true);
  });

  it("flags a whitespace-only string as malformed", () => {
    expect(isMalformedIdentifier("   ")).toBe(true);
  });

  it("flags non-string values as malformed", () => {
    expect(isMalformedIdentifier(null)).toBe(true);
    expect(isMalformedIdentifier(undefined)).toBe(true);
    expect(isMalformedIdentifier(12345)).toBe(true);
  });

  it("does not flag a well-formed non-empty string", () => {
    expect(isMalformedIdentifier(STELLAR_ADDRESS_1)).toBe(false);
  });
});
