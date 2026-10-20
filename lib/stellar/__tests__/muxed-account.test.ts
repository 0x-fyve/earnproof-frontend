import { decodeMuxedAccount, isMuxedAccountAddress } from "../muxed-account";

// Verified round-trip test vector (version 0x60, 32-byte pubkey of 0x07
// repeated, muxed id = 42, correct CRC16/XModem checksum) — constructed
// and independently verified with a standalone encoder/decoder before
// being hardcoded here, so this test is checked against known-correct
// bytes, not just against this module's own encode step.
const VALID_MUXED_ADDRESS = "MADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAFKY6G";
const EXPECTED_UNDERLYING_ACCOUNT_PREFIX = "G";

describe("isMuxedAccountAddress", () => {
  it("recognizes an M-prefixed address", () => {
    expect(isMuxedAccountAddress(VALID_MUXED_ADDRESS)).toBe(true);
  });

  it("does not treat a G-prefixed address as muxed", () => {
    expect(isMuxedAccountAddress("GA7QYNF7SOWQ3GLR2BGMZEHXAVAVGVHWGD5CDGDRA7VYAGF5D5MFBXBW")).toBe(
      false,
    );
  });
});

describe("decodeMuxedAccount", () => {
  it("decodes a well-formed muxed account into its underlying account and mux ID", () => {
    const result = decodeMuxedAccount(VALID_MUXED_ADDRESS);
    expect(result).not.toBeNull();
    expect(result?.muxedId).toBe("42");
    expect(result?.underlyingAccount.startsWith(EXPECTED_UNDERLYING_ACCOUNT_PREFIX)).toBe(true);
    expect(result?.underlyingAccount).toHaveLength(56);
  });

  it("returns null for a plain ed25519 ('G...') address", () => {
    expect(
      decodeMuxedAccount("GA7QYNF7SOWQ3GLR2BGMZEHXAVAVGVHWGD5CDGDRA7VYAGF5D5MFBXBW"),
    ).toBeNull();
  });

  it("returns null for a wrong-length string", () => {
    expect(decodeMuxedAccount("MTOOSHORT")).toBeNull();
  });

  it("returns null for a corrupted checksum", () => {
    const corrupted = VALID_MUXED_ADDRESS.slice(0, -1) + (VALID_MUXED_ADDRESS.endsWith("A") ? "B" : "A");
    expect(decodeMuxedAccount(corrupted)).toBeNull();
  });

  it("returns null for invalid base32 characters", () => {
    const invalid = "M" + "1".repeat(68); // "1" and "0" are not in the base32 alphabet
    expect(decodeMuxedAccount(invalid)).toBeNull();
  });

  it("never throws on garbage input", () => {
    expect(() => decodeMuxedAccount("")).not.toThrow();
    expect(() => decodeMuxedAccount("not-a-strkey-at-all")).not.toThrow();
    expect(decodeMuxedAccount("")).toBeNull();
  });
});
