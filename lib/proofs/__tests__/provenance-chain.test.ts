/**
 * Provenance chain utilities tests.
 *
 * Coverage areas:
 * - Source and checkpoint lookups
 * - Observation queries and filtering
 * - Summary generation
 * - Validation logic
 * - Edge cases: empty chains, missing links, failed observations
 * - Deterministic behavior
 */

import type { ProvenianceChain } from "@/lib/api/generated/v1";
import {
  hasProvenance,
  getCheckpointObservations,
  getSourceObservations,
  findCheckpoint,
  findSource,
  getObservationTypeLabel,
  getSourceTypeLabel,
  getMissingLinkReasonLabel,
  hasFailedObservation,
  getFailedObservations,
  getPassedObservations,
  getVerifiedSourceCount,
  getUnavailableSourceCount,
  getFailedSourceCount,
  allSourcesVerified,
  getSourcesWithMissingLinks,
  isRetryable,
  getProvenianceSummary,
  validateProvenianceChain,
  describeProvenianceChain,
} from "@/lib/proofs/provenance-chain";

// Fixture: Basic valid provenance chain
const validChain: ProvenianceChain = {
  sources: [
    {
      id: "issuer-1",
      type: "issuer",
      status: "verified",
      name: "Primary Issuer",
      description: "Main trusted issuer",
    },
    {
      id: "contract-1",
      type: "contract",
      status: "verified",
      name: "Smart Contract",
    },
  ],
  checkpoints: [
    { id: "cp-signature", name: "Signature Validation", order: 0, description: "Check cryptographic signature" },
    { id: "cp-issuer", name: "Issuer Verification", order: 1 },
  ],
  observations: [
    {
      checkpointId: "cp-signature",
      timestamp: "2026-08-16T14:00:00Z",
      sourceId: "contract-1",
      observationType: "signature_check",
      result: true,
      details: "Signature valid",
    },
    {
      checkpointId: "cp-issuer",
      timestamp: "2026-08-16T14:00:05Z",
      sourceId: "issuer-1",
      observationType: "issuer_check",
      result: true,
    },
  ],
  verificationPath: ["cp-signature", "cp-issuer"],
  missingLinks: [],
};

// Fixture: Chain with failed observations
const failedChain: ProvenianceChain = {
  ...validChain,
  observations: [
    {
      checkpointId: "cp-signature",
      timestamp: "2026-08-16T14:00:00Z",
      sourceId: "contract-1",
      observationType: "signature_check",
      result: false,
      details: "Signature invalid",
    },
  ],
  sources: [
    { ...validChain.sources[0], status: "failed" },
    validChain.sources[1],
  ],
};

// Fixture: Chain with unavailable sources
const unavailableChain: ProvenianceChain = {
  ...validChain,
  sources: [
    { ...validChain.sources[0], status: "unavailable" },
    validChain.sources[1],
  ],
  missingLinks: [
    {
      sourceId: "issuer-1",
      reason: "timeout",
      retryable: true,
    },
  ],
};

describe("provenance-chain utilities", () => {
  describe("hasProvenance", () => {
    it("returns true for valid response with provenance", () => {
      const response = { status: "valid" as const, result: "VALID" as const, provenance: validChain };
      expect(hasProvenance(response)).toBe(true);
    });

    it("returns false when provenance is undefined", () => {
      const response = { status: "valid" as const, result: "VALID" as const };
      expect(hasProvenance(response)).toBe(false);
    });
  });

  describe("getCheckpointObservations", () => {
    it("returns observations for a specific checkpoint", () => {
      const obs = getCheckpointObservations(validChain, "cp-signature");
      expect(obs).toHaveLength(1);
      expect(obs[0].observationType).toBe("signature_check");
    });

    it("returns empty array for non-existent checkpoint", () => {
      const obs = getCheckpointObservations(validChain, "cp-nonexistent");
      expect(obs).toEqual([]);
    });
  });

  describe("getSourceObservations", () => {
    it("returns observations from a specific source", () => {
      const obs = getSourceObservations(validChain, "contract-1");
      expect(obs).toHaveLength(1);
      expect(obs[0].sourceId).toBe("contract-1");
    });

    it("returns empty array for non-existent source", () => {
      const obs = getSourceObservations(validChain, "source-nonexistent");
      expect(obs).toEqual([]);
    });
  });

  describe("findCheckpoint", () => {
    it("finds checkpoint by ID", () => {
      const cp = findCheckpoint(validChain, "cp-signature");
      expect(cp).toBeDefined();
      expect(cp?.name).toBe("Signature Validation");
    });

    it("returns undefined for non-existent checkpoint", () => {
      const cp = findCheckpoint(validChain, "cp-nonexistent");
      expect(cp).toBeUndefined();
    });
  });

  describe("findSource", () => {
    it("finds source by ID", () => {
      const src = findSource(validChain, "issuer-1");
      expect(src).toBeDefined();
      expect(src?.name).toBe("Primary Issuer");
    });

    it("returns undefined for non-existent source", () => {
      const src = findSource(validChain, "source-nonexistent");
      expect(src).toBeUndefined();
    });
  });

  describe("label getters", () => {
    it("returns correct labels for observation types", () => {
      expect(getObservationTypeLabel("signature_check")).toBe("Signature Validation");
      expect(getObservationTypeLabel("issuer_check")).toBe("Issuer Verification");
      expect(getObservationTypeLabel("expiration_check")).toBe("Expiration Check");
    });

    it("returns correct labels for source types", () => {
      expect(getSourceTypeLabel("issuer")).toBe("Issuer Registry");
      expect(getSourceTypeLabel("contract")).toBe("Smart Contract");
      expect(getSourceTypeLabel("stellar_account")).toBe("Stellar Account");
      expect(getSourceTypeLabel("backend_registry")).toBe("Backend Registry");
    });

    it("returns correct labels for missing link reasons", () => {
      expect(getMissingLinkReasonLabel("timeout")).toBe("Request timed out");
      expect(getMissingLinkReasonLabel("network_error")).toBe("Network connectivity issue");
      expect(getMissingLinkReasonLabel("permission_denied")).toBe("Access denied");
    });
  });

  describe("observation filtering", () => {
    it("detects failed observations", () => {
      expect(hasFailedObservation(validChain)).toBe(false);
      expect(hasFailedObservation(failedChain)).toBe(true);
    });

    it("gets all failed observations", () => {
      const failed = getFailedObservations(failedChain);
      expect(failed).toHaveLength(1);
      expect(failed[0].result).toBe(false);
    });

    it("gets all passed observations", () => {
      const passed = getPassedObservations(validChain);
      expect(passed).toHaveLength(2);
      expect(passed.every((o) => o.result)).toBe(true);
    });

    it("returns empty arrays when no matching observations", () => {
      const failedInValid = getFailedObservations(validChain);
      const passedInFailed = getPassedObservations(failedChain);
      expect(failedInValid).toEqual([]);
      expect(passedInFailed).toEqual([]);
    });
  });

  describe("source status counts", () => {
    it("counts verified sources", () => {
      expect(getVerifiedSourceCount(validChain)).toBe(2);
      expect(getVerifiedSourceCount(failedChain)).toBe(1);
      expect(getVerifiedSourceCount(unavailableChain)).toBe(1);
    });

    it("counts unavailable sources", () => {
      expect(getUnavailableSourceCount(validChain)).toBe(0);
      expect(getUnavailableSourceCount(unavailableChain)).toBe(1);
    });

    it("counts failed sources", () => {
      expect(getFailedSourceCount(validChain)).toBe(0);
      expect(getFailedSourceCount(failedChain)).toBe(1);
    });
  });

  describe("allSourcesVerified", () => {
    it("returns true when all sources are verified", () => {
      expect(allSourcesVerified(validChain)).toBe(true);
    });

    it("returns false when any source is unavailable", () => {
      expect(allSourcesVerified(unavailableChain)).toBe(false);
    });

    it("returns false when any source failed", () => {
      expect(allSourcesVerified(failedChain)).toBe(false);
    });
  });

  describe("getSourcesWithMissingLinks", () => {
    it("returns empty array when no missing links", () => {
      const sources = getSourcesWithMissingLinks(validChain);
      expect(sources).toEqual([]);
    });

    it("returns sources with missing links", () => {
      const sources = getSourcesWithMissingLinks(unavailableChain);
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe("issuer-1");
    });
  });

  describe("isRetryable", () => {
    it("returns true when all missing links are retryable", () => {
      expect(isRetryable(unavailableChain)).toBe(true);
    });

    it("returns false when any missing link is non-retryable", () => {
      const nonRetryableChain: ProvenianceChain = {
        ...unavailableChain,
        missingLinks: [
          {
            sourceId: "issuer-1",
            reason: "permission_denied",
            retryable: false,
          },
        ],
      };
      expect(isRetryable(nonRetryableChain)).toBe(false);
    });

    it("returns true when no missing links", () => {
      expect(isRetryable(validChain)).toBe(true);
    });
  });

  describe("getProvenianceSummary", () => {
    it("provides accurate summary of valid chain", () => {
      const summary = getProvenianceSummary(validChain);
      expect(summary).toMatchObject({
        totalSources: 2,
        verifiedSources: 2,
        unavailableSources: 0,
        failedSources: 0,
        checkpointsExecuted: 2,
        totalObservations: 2,
        failedObservations: 0,
        isRetryable: true,
        allVerified: true,
      });
    });

    it("provides accurate summary of failed chain", () => {
      const summary = getProvenianceSummary(failedChain);
      expect(summary).toMatchObject({
        failedSources: 1,
        failedObservations: 1,
        allVerified: false,
      });
    });

    it("provides accurate summary of unavailable chain", () => {
      const summary = getProvenianceSummary(unavailableChain);
      expect(summary).toMatchObject({
        unavailableSources: 1,
        allVerified: false,
        isRetryable: true,
      });
    });
  });

  describe("validateProvenianceChain", () => {
    it("validates correct chain without errors", () => {
      const errors = validateProvenianceChain(validChain);
      expect(errors).toEqual([]);
    });

    it("detects duplicate checkpoint IDs", () => {
      const badChain: ProvenianceChain = {
        ...validChain,
        checkpoints: [
          { id: "cp-dup", name: "First", order: 0 },
          { id: "cp-dup", name: "Second", order: 1 },
        ],
      };
      const errors = validateProvenianceChain(badChain);
      expect(errors.some((e) => e.type === "duplicate_checkpoint_id")).toBe(true);
    });

    it("detects duplicate source IDs", () => {
      const badChain: ProvenianceChain = {
        ...validChain,
        sources: [
          { id: "src-dup", type: "issuer", status: "verified", name: "First" },
          { id: "src-dup", type: "contract", status: "verified", name: "Second" },
        ],
      };
      const errors = validateProvenianceChain(badChain);
      expect(errors.some((e) => e.type === "duplicate_source_id")).toBe(true);
    });

    it("detects invalid observation references", () => {
      const badChain: ProvenianceChain = {
        ...validChain,
        observations: [
          {
            checkpointId: "cp-nonexistent",
            timestamp: "2026-08-16T14:00:00Z",
            sourceId: "issuer-1",
            observationType: "signature_check",
            result: true,
          },
        ],
      };
      const errors = validateProvenianceChain(badChain);
      expect(errors.some((e) => e.type === "invalid_observation_checkpoint")).toBe(true);
    });

    it("detects duplicate checkpoints in verification path", () => {
      const badChain: ProvenianceChain = {
        ...validChain,
        verificationPath: ["cp-signature", "cp-signature"],
      };
      const errors = validateProvenianceChain(badChain);
      expect(errors.some((e) => e.type === "duplicate_checkpoint_in_path")).toBe(true);
    });

    it("detects invalid checkpoint references in verification path", () => {
      const badChain: ProvenianceChain = {
        ...validChain,
        verificationPath: ["cp-nonexistent"],
      };
      const errors = validateProvenianceChain(badChain);
      expect(errors.some((e) => e.type === "invalid_verification_path_checkpoint")).toBe(true);
    });

    it("detects duplicate checkpoint orders", () => {
      const badChain: ProvenianceChain = {
        ...validChain,
        checkpoints: [
          { id: "cp-1", name: "First", order: 0 },
          { id: "cp-2", name: "Second", order: 0 },
        ],
      };
      const errors = validateProvenianceChain(badChain);
      expect(errors.some((e) => e.type === "duplicate_checkpoint_order")).toBe(true);
    });
  });

  describe("describeProvenianceChain", () => {
    it("generates description for valid chain", () => {
      const desc = describeProvenianceChain(validChain);
      expect(desc).toContain("2 checkpoint(s)");
      expect(desc).toContain("2 observation(s)");
      expect(desc).toContain("2 verified");
    });

    it("includes failure information when present", () => {
      const desc = describeProvenianceChain(failedChain);
      expect(desc).toContain("⚠️");
    });

    it("includes missing link information", () => {
      const desc = describeProvenianceChain(unavailableChain);
      expect(desc).toContain("Missing");
    });

    it("indicates non-retryable failures", () => {
      const nonRetryableChain: ProvenianceChain = {
        ...failedChain,
        missingLinks: [
          {
            sourceId: "contract-1",
            reason: "permission_denied",
            retryable: false,
          },
        ],
      };
      const desc = describeProvenianceChain(nonRetryableChain);
      expect(desc).toContain("Non-retryable");
    });
  });

  describe("edge cases", () => {
    it("handles empty chain", () => {
      const emptyChain: ProvenianceChain = {
        sources: [],
        checkpoints: [],
        observations: [],
        verificationPath: [],
        missingLinks: [],
      };
      expect(validateProvenianceChain(emptyChain)).toEqual([]);
      const summary = getProvenianceSummary(emptyChain);
      expect(summary.totalSources).toBe(0);
      expect(summary.totalObservations).toBe(0);
    });

    it("handles chain with only unavailable sources", () => {
      const allUnavailableChain: ProvenianceChain = {
        sources: [
          { id: "src-1", type: "issuer", status: "unavailable", name: "Unavailable 1" },
          { id: "src-2", type: "contract", status: "unavailable", name: "Unavailable 2" },
        ],
        checkpoints: [],
        observations: [],
        verificationPath: [],
        missingLinks: [
          { sourceId: "src-1", reason: "timeout", retryable: true },
          { sourceId: "src-2", reason: "network_error", retryable: true },
        ],
      };
      const summary = getProvenianceSummary(allUnavailableChain);
      expect(summary.unavailableSources).toBe(2);
      expect(summary.verifiedSources).toBe(0);
      expect(summary.allVerified).toBe(false);
    });

    it("handles chain with mixed failures and successes", () => {
      const mixedChain: ProvenianceChain = {
        sources: [
          { id: "src-success", type: "issuer", status: "verified", name: "Success" },
          { id: "src-failed", type: "contract", status: "failed", name: "Failed" },
          { id: "src-unavailable", type: "stellar_account", status: "unavailable", name: "Unavailable" },
        ],
        checkpoints: [{ id: "cp-1", name: "Check", order: 0 }],
        observations: [
          {
            checkpointId: "cp-1",
            timestamp: "2026-08-16T14:00:00Z",
            sourceId: "src-success",
            observationType: "signature_check",
            result: true,
          },
          {
            checkpointId: "cp-1",
            timestamp: "2026-08-16T14:00:05Z",
            sourceId: "src-failed",
            observationType: "issuer_check",
            result: false,
          },
        ],
        verificationPath: ["cp-1"],
        missingLinks: [{ sourceId: "src-unavailable", reason: "timeout", retryable: true }],
      };
      const summary = getProvenianceSummary(mixedChain);
      expect(summary.verifiedSources).toBe(1);
      expect(summary.failedSources).toBe(1);
      expect(summary.unavailableSources).toBe(1);
      expect(summary.failedObservations).toBe(1);
    });
  });
});
