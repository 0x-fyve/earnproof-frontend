/**
 * Unit tests for lib/validation/account-rotation.ts (#281).
 *
 * Covers:
 * - Valid public keys (positive)
 * - Invalid format, wrong length, wrong prefix (negative)
 * - Secret-key detection: S-addresses rejected with a clear message
 * - Same-account rejection (rotationReviewSchema)
 * - Challenge submit schema: secret rejected in signature field
 * - Boundary schema: off-by-one rejected, exact match accepted
 */

import {
  stellarPublicKeySchema,
  rotationReviewSchema,
  ownershipChallengeSubmitSchema,
  checkpointBoundarySchema,
  looksLikeStellarSecret,
} from "../account-rotation";

// ─── Synthetic fixtures ───────────────────────────────────────────────────────

// 56-char synthetic G-address (base32 alphabet: A-Z, 2-7).
const VALID_PUB = "GABC1234567890DEFGHIJKLMNOPQRSTUVWXYZ234567890ABCD234";
// Same length, starts with G, all valid base32 chars — a second distinct address.
const VALID_PUB_2 = "GNEW1234567890DEFGHIJKLMNOPQRSTUVWXYZ234567890ABCD234";
// 56-char S-address (secret seed).
const SECRET_KEY = "SABC1234567890DEFGHIJKLMNOPQRSTUVWXYZ234567890ABCD234";
// Too short.
const TOO_SHORT = "GABC1234";
// Right length, but starts with wrong char.
const WRONG_PREFIX = "XABC1234567890DEFGHIJKLMNOPQRSTUVWXYZ234567890ABCD234";
// 57 chars.
const TOO_LONG = "GABC1234567890DEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE2345";

// ─── looksLikeStellarSecret ───────────────────────────────────────────────────

describe("looksLikeStellarSecret", () => {
  it("returns true for a 56-char S-address", () => {
    expect(looksLikeStellarSecret(SECRET_KEY)).toBe(true);
  });

  it("returns false for a valid G-address", () => {
    expect(looksLikeStellarSecret(VALID_PUB)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(looksLikeStellarSecret("")).toBe(false);
  });

  it("strips leading/trailing whitespace before checking", () => {
    expect(looksLikeStellarSecret(`  ${SECRET_KEY}  `)).toBe(true);
  });
});

// ─── stellarPublicKeySchema ───────────────────────────────────────────────────

describe("stellarPublicKeySchema", () => {
  it("accepts a valid 56-char G-address", () => {
    expect(() => stellarPublicKeySchema.parse(VALID_PUB)).not.toThrow();
  });

  it("rejects an empty string", () => {
    const result = stellarPublicKeySchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects an S-address with the secret-seed message", () => {
    const result = stellarPublicKeySchema.safeParse(SECRET_KEY);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/secret seed/i);
    }
  });

  it("rejects a too-short address", () => {
    const result = stellarPublicKeySchema.safeParse(TOO_SHORT);
    expect(result.success).toBe(false);
  });

  it("rejects a too-long address", () => {
    const result = stellarPublicKeySchema.safeParse(TOO_LONG);
    expect(result.success).toBe(false);
  });

  it("rejects an address with wrong first character", () => {
    const result = stellarPublicKeySchema.safeParse(WRONG_PREFIX);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/public key/i);
    }
  });

  it("rejects an address with lowercase characters", () => {
    const lower = VALID_PUB.toLowerCase();
    const result = stellarPublicKeySchema.safeParse(lower);
    expect(result.success).toBe(false);
  });
});

// ─── rotationReviewSchema ─────────────────────────────────────────────────────

describe("rotationReviewSchema", () => {
  it("accepts valid old + new addresses when they differ", () => {
    expect(() =>
      rotationReviewSchema.parse({
        currentAccountAddress: VALID_PUB,
        newAccountAddress: VALID_PUB_2,
      }),
    ).not.toThrow();
  });

  it("rejects when new address equals current address", () => {
    const result = rotationReviewSchema.safeParse({
      currentAccountAddress: VALID_PUB,
      newAccountAddress: VALID_PUB,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/different|same account/i);
    }
  });

  it("rejects when new address is a secret key", () => {
    const result = rotationReviewSchema.safeParse({
      currentAccountAddress: VALID_PUB,
      newAccountAddress: SECRET_KEY,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/secret seed/i);
    }
  });

  it("rejects an invalid public key format for new address", () => {
    const result = rotationReviewSchema.safeParse({
      currentAccountAddress: VALID_PUB,
      newAccountAddress: "not-a-key",
    });
    expect(result.success).toBe(false);
  });
});

// ─── ownershipChallengeSubmitSchema ──────────────────────────────────────────

describe("ownershipChallengeSubmitSchema", () => {
  const VALID_SIG = "base64encodedSignatureOutputHere==";

  it("accepts a valid challenge submission", () => {
    expect(() =>
      ownershipChallengeSubmitSchema.parse({
        challengeId: "chal-001",
        walletAddress: VALID_PUB,
        signedChallenge: VALID_SIG,
      }),
    ).not.toThrow();
  });

  it("rejects an empty signedChallenge", () => {
    const result = ownershipChallengeSubmitSchema.safeParse({
      challengeId: "chal-001",
      walletAddress: VALID_PUB,
      signedChallenge: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a signedChallenge that looks like a secret seed", () => {
    const result = ownershipChallengeSubmitSchema.safeParse({
      challengeId: "chal-001",
      walletAddress: VALID_PUB,
      signedChallenge: SECRET_KEY,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/private key/i);
    }
  });

  it("rejects a secret key in the walletAddress field", () => {
    const result = ownershipChallengeSubmitSchema.safeParse({
      challengeId: "chal-001",
      walletAddress: SECRET_KEY,
      signedChallenge: VALID_SIG,
    });
    expect(result.success).toBe(false);
  });
});

// ─── checkpointBoundarySchema ─────────────────────────────────────────────────

describe("checkpointBoundarySchema", () => {
  it("accepts confirmedLedger that exactly matches proposedLedger", () => {
    expect(() =>
      checkpointBoundarySchema.parse({ confirmedLedger: 50_000_000, proposedLedger: 50_000_000 }),
    ).not.toThrow();
  });

  it("rejects confirmedLedger that is one less than proposed (off-by-one)", () => {
    const result = checkpointBoundarySchema.safeParse({
      confirmedLedger: 49_999_999,
      proposedLedger: 50_000_000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/exact/i);
    }
  });

  it("rejects confirmedLedger that is one more than proposed", () => {
    const result = checkpointBoundarySchema.safeParse({
      confirmedLedger: 50_000_001,
      proposedLedger: 50_000_000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero ledger", () => {
    const result = checkpointBoundarySchema.safeParse({
      confirmedLedger: 0,
      proposedLedger: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative ledger", () => {
    const result = checkpointBoundarySchema.safeParse({
      confirmedLedger: -1,
      proposedLedger: -1,
    });
    expect(result.success).toBe(false);
  });
});
