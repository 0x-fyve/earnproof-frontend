/**
 * @jest-environment node
 */

import {
  calculateApiKeyScopeDiff,
  apiKeyScopeChangeRequiresConfirmation,
} from "@/lib/validation/api-key-scope-diff";
import { AVAILABLE_SCOPES } from "@/lib/api/keys";

describe("calculateApiKeyScopeDiff", () => {
  describe("positive cases", () => {
    it("calculates diff for adding a single read-only scope", () => {
      const diff = calculateApiKeyScopeDiff([], ["verification:read"]);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("verification:read");
      expect(diff.added[0].isBroad).toBe(false);
      expect(diff.requiresConfirmation).toBe(false);
    });

    it("calculates diff for adding a broad scope", () => {
      const diff = calculateApiKeyScopeDiff([], ["proofs:create"]);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("proofs:create");
      expect(diff.added[0].isBroad).toBe(true);
      expect(diff.riskSummary.hasBroadPermissions).toBe(true);
      expect(diff.requiresConfirmation).toBe(true);
    });

    it("calculates diff for removing a scope", () => {
      const diff = calculateApiKeyScopeDiff(["proofs:read"], []);

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].id).toBe("proofs:read");
      expect(diff.requiresConfirmation).toBe(true);
    });

    it("flags removal of broad scope as destructive", () => {
      const diff = calculateApiKeyScopeDiff(["webhooks:manage"], []);

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].isDestructiveRemoval).toBe(true);
      expect(diff.riskSummary.hasDestructiveRemovals).toBe(true);
    });

    it("calculates diff for multiple scope additions", () => {
      const diff = calculateApiKeyScopeDiff(
        ["proofs:read"],
        ["proofs:read", "verification:read", "proofs:create"],
      );

      expect(diff.added).toHaveLength(2);
      expect(diff.unchanged).toHaveLength(1);
      expect(diff.riskSummary.addedCount).toBe(2);
    });

    it("calculates diff for complex changes", () => {
      const diff = calculateApiKeyScopeDiff(
        ["proofs:read", "verification:read", "webhooks:manage"],
        ["proofs:read", "proofs:create", "verification:read"],
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("proofs:create");
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].id).toBe("webhooks:manage");
      expect(diff.unchanged).toHaveLength(2);
    });
  });

  describe("negative cases", () => {
    it("handles unknown scope gracefully (fail-closed)", () => {
      const diff = calculateApiKeyScopeDiff(["proofs:read"], ["proofs:read", "unknown:scope"]);

      expect(diff.added).toHaveLength(0);
      expect(diff.all.every((p) => p.id !== "unknown:scope")).toBe(true);
    });

    it("handles empty before and after", () => {
      const diff = calculateApiKeyScopeDiff([], []);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
      expect(diff.requiresConfirmation).toBe(false);
    });

    it("handles all available scopes", () => {
      const diff = calculateApiKeyScopeDiff([], AVAILABLE_SCOPES as string[]);

      expect(diff.added).toHaveLength(AVAILABLE_SCOPES.length);
      expect(diff.riskSummary.hasBroadPermissions).toBe(true);
      expect(diff.requiresConfirmation).toBe(true);
    });
  });

  describe("broad scope flagging", () => {
    it("identifies proofs:create as broad", () => {
      const diff = calculateApiKeyScopeDiff([], ["proofs:create"]);

      expect(diff.added[0].isBroad).toBe(true);
    });

    it("identifies webhooks:manage as broad", () => {
      const diff = calculateApiKeyScopeDiff([], ["webhooks:manage"]);

      expect(diff.added[0].isBroad).toBe(true);
    });

    it("does not flag proofs:read as broad", () => {
      const diff = calculateApiKeyScopeDiff([], ["proofs:read"]);

      expect(diff.added[0].isBroad).toBe(false);
    });

    it("does not flag verification:read as broad", () => {
      const diff = calculateApiKeyScopeDiff([], ["verification:read"]);

      expect(diff.added[0].isBroad).toBe(false);
    });

    it("sets hasBroadPermissions when any broad scope is present", () => {
      const diff = calculateApiKeyScopeDiff(
        ["proofs:read"],
        ["proofs:read", "webhooks:manage"],
      );

      expect(diff.riskSummary.hasBroadPermissions).toBe(true);
    });
  });

  describe("confirmation requirements", () => {
    it("requires confirmation for broad scope addition", () => {
      expect(calculateApiKeyScopeDiff([], ["proofs:create"]).requiresConfirmation).toBe(true);
      expect(calculateApiKeyScopeDiff([], ["webhooks:manage"]).requiresConfirmation).toBe(true);
    });

    it("requires confirmation for any removal", () => {
      expect(calculateApiKeyScopeDiff(["proofs:read"], []).requiresConfirmation).toBe(true);
    });

    it("does not require confirmation for read-only addition", () => {
      expect(
        calculateApiKeyScopeDiff([], ["verification:read", "proofs:read"]).requiresConfirmation,
      ).toBe(false);
    });

    it("requires confirmation for broad scope removal", () => {
      const diff = calculateApiKeyScopeDiff(["webhooks:manage"], []);

      expect(diff.requiresConfirmation).toBe(true);
      expect(diff.riskSummary.hasDestructiveRemovals).toBe(true);
    });

    it("sets appropriate confirmation reason for broad additions", () => {
      const diff = calculateApiKeyScopeDiff([], ["proofs:create"]);

      expect(diff.confirmationReason).toContain("broad permissions");
    });

    it("sets appropriate confirmation reason for removals", () => {
      const diff = calculateApiKeyScopeDiff(["proofs:read"], []);

      expect(diff.confirmationReason).toContain("removed");
    });

    it("sets appropriate confirmation reason for destructive removals", () => {
      const diff = calculateApiKeyScopeDiff(["webhooks:manage"], []);

      expect(diff.confirmationReason).toContain("Destructive");
    });
  });

  describe("scope metadata", () => {
    it("includes human-readable title and description", () => {
      const diff = calculateApiKeyScopeDiff([], ["proofs:read"]);

      expect(diff.added[0].title).toBeDefined();
      expect(diff.added[0].title).not.toBe("proofs:read");
      expect(diff.added[0].description).toBeDefined();
      expect(diff.added[0].description.length).toBeGreaterThan(0);
    });

    it("includes category for all scopes", () => {
      const diff = calculateApiKeyScopeDiff(
        [],
        ["verification:read", "proofs:read", "proofs:create", "webhooks:manage"],
      );

      expect(diff.all.every((p) => p.category)).toBe(true);
      expect(new Set(diff.all.map((p) => p.category))).toContainEqual(
        expect.stringMatching(/verification|proofs|webhooks/),
      );
    });
  });

  describe("deterministic behavior", () => {
    it("produces identical results on repeated calls", () => {
      const before = ["proofs:read"];
      const after = ["proofs:read", "proofs:create"];

      const diff1 = calculateApiKeyScopeDiff(before, after);
      const diff2 = calculateApiKeyScopeDiff(before, after);

      expect(diff1.added).toEqual(diff2.added);
      expect(diff1.removed).toEqual(diff2.removed);
      expect(diff1.unchanged).toEqual(diff2.unchanged);
      expect(diff1.requiresConfirmation).toBe(diff2.requiresConfirmation);
    });

    it("handles order independence (set semantics)", () => {
      const diff1 = calculateApiKeyScopeDiff(
        ["proofs:read", "verification:read"],
        ["proofs:create", "proofs:read"],
      );
      const diff2 = calculateApiKeyScopeDiff(
        ["verification:read", "proofs:read"],
        ["proofs:read", "proofs:create"],
      );

      expect(diff1.added.map((p) => p.id)).toEqual(expect.arrayContaining(["proofs:create"]));
      expect(diff2.added.map((p) => p.id)).toEqual(expect.arrayContaining(["proofs:create"]));
    });
  });
});

describe("apiKeyScopeChangeRequiresConfirmation", () => {
  it("returns true for broad scope additions", () => {
    expect(apiKeyScopeChangeRequiresConfirmation([], ["proofs:create"])).toBe(true);
    expect(apiKeyScopeChangeRequiresConfirmation([], ["webhooks:manage"])).toBe(true);
  });

  it("returns true for any scope removal", () => {
    expect(apiKeyScopeChangeRequiresConfirmation(["proofs:read"], [])).toBe(true);
  });

  it("returns false for read-only scope additions", () => {
    expect(apiKeyScopeChangeRequiresConfirmation([], ["verification:read"])).toBe(false);
    expect(apiKeyScopeChangeRequiresConfirmation([], ["proofs:read"])).toBe(false);
  });

  it("returns false when no changes", () => {
    expect(apiKeyScopeChangeRequiresConfirmation(["proofs:read"], ["proofs:read"])).toBe(false);
  });

  it("returns true for complex changes with broad scopes or removals", () => {
    expect(
      apiKeyScopeChangeRequiresConfirmation(
        ["verification:read"],
        ["verification:read", "proofs:create"],
      ),
    ).toBe(true);
    expect(
      apiKeyScopeChangeRequiresConfirmation(
        ["proofs:read", "verification:read"],
        ["proofs:read"],
      ),
    ).toBe(true);
  });
});
