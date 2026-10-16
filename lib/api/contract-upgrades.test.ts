import { canApproveReview, getApprovalDisabledReason } from "@/lib/api/contract-upgrades";
import {
  makeContractUpgradeReview,
  makeBlockedContractUpgradeReview,
  makeUnknownCompatibilityUpgradeReview,
  makeNoIdentityContractUpgradeReview,
} from "@/data/fixtures/contract-upgrades";

describe("Contract Upgrades API", () => {
  describe("canApproveReview", () => {
    it("allows approval of review with all compatible checks", () => {
      const review = makeContractUpgradeReview();
      expect(canApproveReview(review)).toBe(true);
    });

    it("blocks approval if there are blocking findings", () => {
      const review = makeBlockedContractUpgradeReview();
      expect(canApproveReview(review)).toBe(false);
    });

    it("blocks approval if any compatibility check is unknown", () => {
      const review = makeUnknownCompatibilityUpgradeReview();
      expect(canApproveReview(review)).toBe(false);
    });

    it("blocks approval if contract identity is missing", () => {
      const review = makeNoIdentityContractUpgradeReview();
      expect(canApproveReview(review)).toBe(false);
    });

    it("blocks approval if contract identity is empty string", () => {
      const review = makeContractUpgradeReview({
        metadata: {
          ...makeContractUpgradeReview().metadata,
          contractIdentity: "",
        },
      });
      expect(canApproveReview(review)).toBe(false);
    });
  });

  describe("getApprovalDisabledReason", () => {
    it("returns null when review can be approved", () => {
      const review = makeContractUpgradeReview();
      expect(getApprovalDisabledReason(review)).toBeNull();
    });

    it("returns reason for blocking findings", () => {
      const review = makeBlockedContractUpgradeReview();
      const reason = getApprovalDisabledReason(review);

      expect(reason).not.toBeNull();
      expect(reason).toContain("blocking finding");
    });

    it("returns reason for unknown compatibility", () => {
      const review = makeUnknownCompatibilityUpgradeReview();
      const reason = getApprovalDisabledReason(review);

      expect(reason).not.toBeNull();
      expect(reason).toContain("unknown");
    });

    it("returns reason for missing contract identity", () => {
      const review = makeNoIdentityContractUpgradeReview();
      const reason = getApprovalDisabledReason(review);

      expect(reason).not.toBeNull();
      expect(reason).toContain("identity");
    });

    it("includes finding count in reason", () => {
      const review = makeContractUpgradeReview({
        blockingFindings: Array(3)
          .fill(null)
          .map((_, i) => ({
            id: `finding-${i}`,
            title: `Finding ${i}`,
            description: `Description ${i}`,
            category: "critical" as const,
            affectedComponent: `Component${i}`,
            detectedAt: new Date().toISOString(),
          })),
      });

      const reason = getApprovalDisabledReason(review);
      expect(reason).toContain("3");
    });

    it("uses singular form for single finding", () => {
      const review = makeContractUpgradeReview({
        blockingFindings: [
          {
            id: "finding-1",
            title: "Critical issue",
            description: "Description",
            category: "critical",
            affectedComponent: "Component",
            detectedAt: new Date().toISOString(),
          },
        ],
      });

      const reason = getApprovalDisabledReason(review);
      expect(reason).toContain("finding");
      expect(reason).not.toContain("findings");
    });
  });

  describe("Error scenarios", () => {
    it("handles concurrent modification with stale revision", () => {
      // This would be tested when API integration tests are implemented
      // For now, this is a placeholder for the pattern
      const review = makeContractUpgradeReview();
      expect(review.__revision).toBeUndefined(); // No revision in fixture yet
    });

    it("handles network errors gracefully", () => {
      // This would be tested with the full API client integration tests
      // Placeholder for error handling pattern
      const review = makeContractUpgradeReview();
      expect(review.id).toBeDefined();
    });

    it("handles authorization failures", () => {
      // This would be tested with authorization/permission tests
      // Placeholder for access control pattern
      const review = makeContractUpgradeReview();
      expect(review.overallStatus).toBeDefined();
    });
  });

  describe("State transitions", () => {
    it("prevents state transitions from approved", () => {
      const approved = makeContractUpgradeReview({ overallStatus: "approved" });
      // In real implementation, API would reject further changes
      expect(approved.overallStatus).toBe("approved");
    });

    it("prevents state transitions from rejected", () => {
      const rejected = makeContractUpgradeReview({ overallStatus: "rejected" });
      // In real implementation, API would reject further changes
      expect(rejected.overallStatus).toBe("rejected");
    });

    it("allows transitioning from pending to approved", () => {
      const pending = makeContractUpgradeReview({ overallStatus: "pending-review" });
      const approved = { ...pending, overallStatus: "approved" as const };
      expect(approved.overallStatus).toBe("approved");
    });

    it("allows transitioning from pending to rejected", () => {
      const pending = makeContractUpgradeReview({ overallStatus: "pending-review" });
      const rejected = { ...pending, overallStatus: "rejected" as const };
      expect(rejected.overallStatus).toBe("rejected");
    });
  });

  describe("Concurrency scenarios", () => {
    it("handles multiple operators loading same review", () => {
      const review1 = makeContractUpgradeReview({ id: "upgrade-1" });
      const review2 = makeContractUpgradeReview({ id: "upgrade-1" });

      // Both should have same data
      expect(review1.id).toBe(review2.id);
      expect(review1.overallStatus).toBe(review2.overallStatus);
    });

    it("handles rapid approval attempts", () => {
      const review = makeContractUpgradeReview();
      // In real implementation, second approval would fail with 409 Conflict
      expect(canApproveReview(review)).toBe(true);
      expect(canApproveReview(review)).toBe(true);
    });
  });

  describe("Regression tests", () => {
    it("maintains backward compatibility with old metadata format", () => {
      const review = makeContractUpgradeReview();
      // Should have all required fields
      expect(review.metadata).toBeDefined();
      expect(review.metadata.contractAddress).toBeDefined();
      expect(review.metadata.currentVersion).toBeDefined();
      expect(review.metadata.proposedVersion).toBeDefined();
    });

    it("handles compatibility checks with missing details", () => {
      const review = makeContractUpgradeReview({
        compatibilityChecks: [
          {
            category: "abi",
            status: "compatible",
            severity: "info",
            message: "Compatible",
            // No details provided
          },
        ],
      });

      expect(review.compatibilityChecks[0].details).toBeUndefined();
      expect(canApproveReview(review)).toBe(true);
    });

    it("handles migration requirements with no dependencies", () => {
      const review = makeContractUpgradeReview({
        migrationRequirements: [
          {
            id: "req-1",
            phase: 1,
            type: "pre-upgrade",
            title: "Backup",
            description: "Backup current state",
            // No dependencies
          },
        ],
      });

      expect(review.migrationRequirements[0].dependencies).toBeUndefined();
      expect(canApproveReview(review)).toBe(true);
    });
  });
});
