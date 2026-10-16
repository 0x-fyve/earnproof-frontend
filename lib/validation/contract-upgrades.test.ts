import {
  isValidVersion,
  isValidContractAddress,
  isValidSha256Hash,
  validateReviewForApproval,
  getStatusBadgeInfo,
  getSeverityBadgeInfo,
  getCompatibilityStatusInfo,
  approveContractUpgradeSchema,
  rejectContractUpgradeSchema,
  contractUpgradeReviewSchema,
} from "@/lib/validation/contract-upgrades";
import {
  makeContractUpgradeReview,
  makeBlockedContractUpgradeReview,
  makeUnknownCompatibilityUpgradeReview,
  makeIncompatibleABIUpgradeReview,
  makeBoundaryMaxStringLengthUpgradeReview,
  makeBoundaryMinimumDataUpgradeReview,
} from "@/data/fixtures/contract-upgrades";

describe("Contract Upgrade Validation", () => {
  describe("isValidVersion", () => {
    it("accepts valid semantic versions", () => {
      expect(isValidVersion("1.0.0")).toBe(true);
      expect(isValidVersion("0.0.0")).toBe(true);
      expect(isValidVersion("999.999.999")).toBe(true);
    });

    it("rejects invalid versions", () => {
      expect(isValidVersion("1.0")).toBe(false);
      expect(isValidVersion("v1.0.0")).toBe(false);
      expect(isValidVersion("1.0.0-alpha")).toBe(false);
      expect(isValidVersion("")).toBe(false);
      expect(isValidVersion("1")).toBe(false);
    });
  });

  describe("isValidContractAddress", () => {
    it("accepts valid Stellar contract addresses", () => {
      expect(isValidContractAddress("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4")).toBe(
        true
      );
      expect(isValidContractAddress("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5")).toBe(
        true
      );
    });

    it("rejects invalid contract addresses", () => {
      expect(isValidContractAddress("GDJVFDZNLJ57QC5XPHQ4SRKSQIWKKDKV54Z3MCJSC6BOTOED4FY6MQB")).toBe(
        false
      );
      expect(isValidContractAddress("caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabsc4")).toBe(
        false
      );
      expect(isValidContractAddress("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC")).toBe(
        false
      );
      expect(isValidContractAddress("")).toBe(false);
    });
  });

  describe("isValidSha256Hash", () => {
    it("accepts valid SHA256 hashes", () => {
      expect(
        isValidSha256Hash("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
      ).toBe(true);
      expect(
        isValidSha256Hash("0000000000000000000000000000000000000000000000000000000000000000")
      ).toBe(true);
    });

    it("rejects invalid hashes", () => {
      expect(isValidSha256Hash("not-a-hash")).toBe(false);
      expect(isValidSha256Hash("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855")).toBe(
        false
      );
      expect(
        isValidSha256Hash("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85")
      ).toBe(false);
      expect(isValidSha256Hash("")).toBe(false);
    });
  });

  describe("validateReviewForApproval", () => {
    it("validates a valid review for approval", () => {
      const review = makeContractUpgradeReview();
      const result = validateReviewForApproval(review);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects review with blocking findings", () => {
      const review = makeBlockedContractUpgradeReview();
      const result = validateReviewForApproval(review);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("blocking finding"))).toBe(true);
    });

    it("rejects review with unknown compatibility", () => {
      const review = makeUnknownCompatibilityUpgradeReview();
      const result = validateReviewForApproval(review);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("unknown"))).toBe(true);
    });

    it("rejects review with incompatible checks", () => {
      const review = makeIncompatibleABIUpgradeReview();
      const result = validateReviewForApproval(review);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("incompatibility"))).toBe(true);
    });

    it("rejects review with no contract identity", () => {
      const review = makeContractUpgradeReview({
        metadata: {
          ...makeContractUpgradeReview().metadata,
          contractIdentity: "",
        },
      });
      const result = validateReviewForApproval(review);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("identity"))).toBe(true);
    });

    it("rejects review with no artifact hashes", () => {
      const review = makeContractUpgradeReview({
        artifactHashes: [],
      });
      const result = validateReviewForApproval(review);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("artifact hash"))).toBe(true);
    });
  });

  describe("Status badge info", () => {
    it("provides correct info for each status", () => {
      expect(getStatusBadgeInfo("approved")).toEqual({
        label: "Approved",
        color: expect.any(String),
      });
      expect(getStatusBadgeInfo("rejected")).toEqual({
        label: "Rejected",
        color: expect.any(String),
      });
      expect(getStatusBadgeInfo("blocked")).toEqual({
        label: "Blocked",
        color: expect.any(String),
      });
      expect(getStatusBadgeInfo("pending-review")).toEqual({
        label: "Pending Review",
        color: expect.any(String),
      });
    });

    it("provides correct severity badge info", () => {
      expect(getSeverityBadgeInfo("error")).toEqual({
        label: "Error",
        color: expect.any(String),
      });
      expect(getSeverityBadgeInfo("warning")).toEqual({
        label: "Warning",
        color: expect.any(String),
      });
      expect(getSeverityBadgeInfo("info")).toEqual({
        label: "Info",
        color: expect.any(String),
      });
    });

    it("provides correct compatibility status info", () => {
      expect(getCompatibilityStatusInfo("compatible")).toEqual({
        label: "Compatible",
        color: expect.any(String),
      });
      expect(getCompatibilityStatusInfo("incompatible")).toEqual({
        label: "Incompatible",
        color: expect.any(String),
      });
      expect(getCompatibilityStatusInfo("unknown")).toEqual({
        label: "Unknown",
        color: expect.any(String),
      });
      expect(getCompatibilityStatusInfo("pending")).toEqual({
        label: "Pending",
        color: expect.any(String),
      });
    });
  });

  describe("Zod schema validation", () => {
    describe("approveContractUpgradeSchema", () => {
      it("accepts valid approval request", () => {
        const result = approveContractUpgradeSchema.safeParse({
          notes: "Upgrade approved after testing",
        });
        expect(result.success).toBe(true);
      });

      it("accepts empty notes", () => {
        const result = approveContractUpgradeSchema.safeParse({
          notes: "",
        });
        expect(result.success).toBe(true);
      });

      it("accepts undefined notes", () => {
        const result = approveContractUpgradeSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it("rejects notes exceeding max length", () => {
        const result = approveContractUpgradeSchema.safeParse({
          notes: "A".repeat(5001),
        });
        expect(result.success).toBe(false);
      });
    });

    describe("rejectContractUpgradeSchema", () => {
      it("accepts valid rejection request", () => {
        const result = rejectContractUpgradeSchema.safeParse({
          reason: "ABI incompatible with current clients",
          details: "Breaking changes to payment verification function signature",
        });
        expect(result.success).toBe(true);
      });

      it("rejects missing reason", () => {
        const result = rejectContractUpgradeSchema.safeParse({
          details: "Details without reason",
        });
        expect(result.success).toBe(false);
      });

      it("rejects empty reason", () => {
        const result = rejectContractUpgradeSchema.safeParse({
          reason: "",
          details: "Details",
        });
        expect(result.success).toBe(false);
      });

      it("rejects reason exceeding max length", () => {
        const result = rejectContractUpgradeSchema.safeParse({
          reason: "A".repeat(501),
          details: "Details",
        });
        expect(result.success).toBe(false);
      });

      it("accepts undefined details", () => {
        const result = rejectContractUpgradeSchema.safeParse({
          reason: "Incompatible",
        });
        expect(result.success).toBe(true);
      });

      it("rejects details exceeding max length", () => {
        const result = rejectContractUpgradeSchema.safeParse({
          reason: "Incompatible",
          details: "A".repeat(2001),
        });
        expect(result.success).toBe(false);
      });
    });

    describe("contractUpgradeReviewSchema", () => {
      it("accepts valid complete review", () => {
        const review = makeContractUpgradeReview();
        const result = contractUpgradeReviewSchema.safeParse(review);
        expect(result.success).toBe(true);
      });

      it("accepts minimal review", () => {
        const review = makeBoundaryMinimumDataUpgradeReview();
        const result = contractUpgradeReviewSchema.safeParse(review);
        expect(result.success).toBe(true);
      });

      it("rejects review with invalid contract address", () => {
        const review = makeContractUpgradeReview({
          metadata: {
            ...makeContractUpgradeReview().metadata,
            contractAddress: "invalid",
          },
        });
        const result = contractUpgradeReviewSchema.safeParse(review);
        expect(result.success).toBe(false);
      });

      it("rejects review with invalid version format", () => {
        const review = makeContractUpgradeReview({
          metadata: {
            ...makeContractUpgradeReview().metadata,
            currentVersion: "1.0",
          },
        });
        const result = contractUpgradeReviewSchema.safeParse(review);
        expect(result.success).toBe(false);
      });

      it("rejects review with invalid activation window", () => {
        const now = new Date();
        const review = makeContractUpgradeReview({
          metadata: {
            ...makeContractUpgradeReview().metadata,
            activationWindow: {
              startsAt: now.toISOString(),
              endsAt: new Date(now.getTime() - 1000).toISOString(), // Ends before starts
            },
          },
        });
        const result = contractUpgradeReviewSchema.safeParse(review);
        expect(result.success).toBe(false);
      });

      it("rejects review with invalid artifact hash", () => {
        const review = makeContractUpgradeReview({
          artifactHashes: [
            {
              type: "contract-bytecode",
              hash: "not-a-valid-hash",
              algorithm: "sha256",
              signature: "sig",
              signedBy: "addr",
              signedAt: new Date().toISOString(),
            },
          ],
        });
        const result = contractUpgradeReviewSchema.safeParse(review);
        expect(result.success).toBe(false);
      });
    });
  });

  describe("Boundary cases", () => {
    it("handles maximum string lengths", () => {
      const review = makeBoundaryMaxStringLengthUpgradeReview();
      const result = validateReviewForApproval(review);
      expect(result.isValid).toBe(true);
    });

    it("handles minimum required data", () => {
      const review = makeBoundaryMinimumDataUpgradeReview();
      const result = validateReviewForApproval(review);
      // Should be valid since no blocking findings and all checks compatible
      expect(result.isValid).toBe(true);
    });
  });
});
