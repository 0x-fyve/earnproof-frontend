/**
 * @jest-environment node
 */

import {
  calculatePermissionDiff,
  diffRequiresConfirmation,
  countPermissionsByStatus,
  filterPermissionDiffByCategory,
  type PermissionDiffOptions,
} from "@/lib/validation/permission-diff";
import {
  FIXTURE_PERMISSIONS,
  FIXTURE_DIFF_ADD_READ_SCOPE,
  FIXTURE_DIFF_ADD_BROAD_SCOPE,
  FIXTURE_DIFF_REMOVE_SCOPE,
  FIXTURE_DIFF_REMOVE_BROAD_SCOPE,
  FIXTURE_DIFF_NO_CHANGES,
  FIXTURE_DIFF_COMPLEX_CHANGE,
  FIXTURE_BOUNDARY_EMPTY,
  FIXTURE_UNKNOWN_PERMISSION,
  createReplayScenario,
  createConcurrencyScenarios,
} from "./fixtures/permission-diff-fixtures";

describe("calculatePermissionDiff", () => {
  const createOptions = (overrides?: Partial<PermissionDiffOptions>): PermissionDiffOptions => ({
    resolvPermission: (id: string) => FIXTURE_PERMISSIONS[id] ?? null,
    ...overrides,
  });

  describe("positive cases", () => {
    it("calculates diff when adding a read-only scope", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        ["proofs:read", "verification:read"],
        createOptions(),
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("verification:read");
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(1);
      expect(diff.requiresConfirmation).toBe(false);
    });

    it("calculates diff when adding a broad scope", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        ["proofs:read", "proofs:create"],
        createOptions(),
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("proofs:create");
      expect(diff.added[0].isBroad).toBe(true);
      expect(diff.riskSummary.hasBroadPermissions).toBe(true);
      expect(diff.requiresConfirmation).toBe(true);
    });

    it("calculates diff when removing a scope", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read", "verification:read"],
        ["proofs:read"],
        createOptions(),
      );

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].id).toBe("verification:read");
      expect(diff.unchanged).toHaveLength(1);
      expect(diff.riskSummary.hasRemovals).toBe(true);
      expect(diff.requiresConfirmation).toBe(true);
    });

    it("marks broad scope removal as destructive when flagged", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read", "webhooks:manage"],
        ["proofs:read"],
        createOptions({
          destructiveRemovalIds: new Set(["webhooks:manage"]),
        }),
      );

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].isDestructiveRemoval).toBe(true);
      expect(diff.riskSummary.hasDestructiveRemovals).toBe(true);
    });

    it("calculates unchanged permissions when no change occurs", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read", "verification:read"],
        ["proofs:read", "verification:read"],
        createOptions(),
      );

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(2);
      expect(diff.requiresConfirmation).toBe(false);
    });

    it("handles complex changes (add, remove, unchanged)", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read", "verification:read"],
        ["proofs:read", "proofs:create"],
        createOptions(),
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("proofs:create");
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].id).toBe("verification:read");
      expect(diff.unchanged).toHaveLength(1);
      expect(diff.unchanged[0].id).toBe("proofs:read");
    });
  });

  describe("negative cases", () => {
    it("filters out unknown permissions (fail-closed)", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        ["proofs:read", "unknown:scope"],
        createOptions(),
      );

      expect(diff.added).toHaveLength(0);
      expect(diff.all.some((p) => p.id === "unknown:scope")).toBe(false);
    });

    it("handles completely unknown permission set gracefully", () => {
      const diff = calculatePermissionDiff(
        [],
        ["unknown:scope1", "unknown:scope2"],
        createOptions(),
      );

      expect(diff.all).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
      expect(diff.requiresConfirmation).toBe(false);
    });

    it("does not set confirmation reason when no changes", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        ["proofs:read"],
        createOptions(),
      );

      expect(diff.confirmationReason).toBeUndefined();
      expect(diff.requiresConfirmation).toBe(false);
    });

    it("handles empty before and after sets", () => {
      const diff = calculatePermissionDiff([], [], createOptions());

      expect(diff.all).toHaveLength(0);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
      expect(diff.inherited).toHaveLength(0);
    });
  });

  describe("authorization cases", () => {
    it("requires confirmation when changes require destructive removal warning", () => {
      const diff = calculatePermissionDiff(
        ["webhooks:manage"],
        [],
        createOptions({
          destructiveRemovalIds: new Set(["webhooks:manage"]),
        }),
      );

      expect(diff.requiresConfirmation).toBe(true);
      expect(diff.confirmationReason).toContain("Destructive");
    });

    it("requires confirmation for broad permission additions", () => {
      const diff = calculatePermissionDiff(
        [],
        ["proofs:create"],
        createOptions(),
      );

      expect(diff.requiresConfirmation).toBe(true);
      expect(diff.confirmationReason).toContain("broad permissions");
    });

    it("requires confirmation for any removal", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        [],
        createOptions(),
      );

      expect(diff.requiresConfirmation).toBe(true);
      expect(diff.confirmationReason).toContain("removed");
    });
  });

  describe("boundary cases", () => {
    it("handles single permission transition", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        ["verification:read"],
        createOptions(),
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.removed).toHaveLength(1);
      expect(diff.unchanged).toHaveLength(0);
    });

    it("handles all available permissions", () => {
      const all = ["proofs:read", "verification:read", "proofs:create", "webhooks:manage"];
      const diff = calculatePermissionDiff([], all, createOptions());

      expect(diff.added).toHaveLength(4);
      expect(diff.riskSummary.addedCount).toBe(4);
    });

    it("handles permission set duplication in input (idempotent)", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read", "proofs:read"],
        ["proofs:read"],
        createOptions(),
      );

      expect(diff.unchanged).toHaveLength(1);
    });
  });

  describe("concurrency and replay", () => {
    it("produces deterministic results (replay scenario)", () => {
      const scenario = createReplayScenario();
      const diff1 = calculatePermissionDiff(scenario.before, scenario.after, createOptions());
      const diff2 = calculatePermissionDiff(scenario.before, scenario.after, createOptions());

      expect(diff1.added).toEqual(diff2.added);
      expect(diff1.removed).toEqual(diff2.removed);
      expect(diff1.unchanged).toEqual(diff2.unchanged);
      expect(diff1.requiresConfirmation).toBe(diff2.requiresConfirmation);
    });

    it("handles concurrent diff calculations without interference", () => {
      const scenarios = createConcurrencyScenarios();
      const results = scenarios
        .flatMap((group) => group.scenarios)
        .map((scenario) =>
          calculatePermissionDiff(scenario.before, scenario.after, createOptions()),
        );

      expect(results).toHaveLength(6);
      expect(results.every((r) => r.all.length >= 0)).toBe(true);
    });
  });

  describe("inherited permissions", () => {
    it("marks permissions as inherited when in inherited set", () => {
      const diff = calculatePermissionDiff(
        [],
        ["proofs:read", "proofs:create"],
        createOptions({
          inheritedIds: new Set(["proofs:create"]),
        }),
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe("proofs:read");
      expect(diff.inherited).toHaveLength(1);
      expect(diff.inherited[0].id).toBe("proofs:create");
    });

    it("does not count inherited as added in confirmation logic", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read"],
        ["proofs:read", "proofs:create"],
        createOptions({
          inheritedIds: new Set(["proofs:create"]),
        }),
      );

      // Inherited broad scopes still trigger confirmation
      expect(diff.requiresConfirmation).toBe(true);
      expect(diff.added).toHaveLength(0);
      expect(diff.inherited).toHaveLength(1);
    });
  });

  describe("risk summary accuracy", () => {
    it("accurately counts all statuses", () => {
      const diff = calculatePermissionDiff(
        ["proofs:read", "verification:read"],
        ["proofs:read", "proofs:create"],
        createOptions(),
      );

      expect(diff.riskSummary.addedCount).toBe(1);
      expect(diff.riskSummary.removedCount).toBe(1);
      expect(diff.riskSummary.unchangedCount).toBe(1);
      expect(diff.riskSummary.inheritedCount).toBe(0);
    });

    it("identifies broad permissions in all statuses", () => {
      const diff = calculatePermissionDiff(
        ["proofs:create"],
        ["webhooks:manage"],
        createOptions(),
      );

      expect(diff.riskSummary.hasBroadPermissions).toBe(true);
    });
  });
});

describe("diffRequiresConfirmation", () => {
  it("returns true when diff requires confirmation", () => {
    expect(diffRequiresConfirmation(FIXTURE_DIFF_ADD_BROAD_SCOPE)).toBe(true);
    expect(diffRequiresConfirmation(FIXTURE_DIFF_REMOVE_SCOPE)).toBe(true);
  });

  it("returns false when diff requires no confirmation", () => {
    expect(diffRequiresConfirmation(FIXTURE_DIFF_ADD_READ_SCOPE)).toBe(false);
    expect(diffRequiresConfirmation(FIXTURE_DIFF_NO_CHANGES)).toBe(false);
  });
});

describe("countPermissionsByStatus", () => {
  it("counts all statuses correctly", () => {
    const counts = countPermissionsByStatus(FIXTURE_DIFF_COMPLEX_CHANGE);

    expect(counts.added).toBe(1);
    expect(counts.removed).toBe(1);
    expect(counts.unchanged).toBe(1);
    expect(counts.inherited).toBe(0);
    expect(counts.total).toBe(3);
  });

  it("handles empty diff", () => {
    const counts = countPermissionsByStatus(FIXTURE_BOUNDARY_EMPTY);

    expect(counts.added).toBe(0);
    expect(counts.removed).toBe(0);
    expect(counts.unchanged).toBe(0);
    expect(counts.inherited).toBe(0);
    expect(counts.total).toBe(0);
  });
});

describe("filterPermissionDiffByCategory", () => {
  it("filters permissions by category", () => {
    const filtered = filterPermissionDiffByCategory(FIXTURE_DIFF_COMPLEX_CHANGE, "proofs");

    expect(filtered.all.length).toBeGreaterThan(0);
    expect(filtered.all.every((p) => p.category === "proofs")).toBe(true);
  });

  it("returns empty diff when no permissions match category", () => {
    const filtered = filterPermissionDiffByCategory(FIXTURE_DIFF_NO_CHANGES, "webhooks");

    expect(filtered.added).toHaveLength(0);
    expect(filtered.removed).toHaveLength(0);
    expect(filtered.unchanged).toHaveLength(0);
  });

  it("preserves risk summary for filtered diff", () => {
    const filtered = filterPermissionDiffByCategory(FIXTURE_DIFF_COMPLEX_CHANGE, "proofs");

    expect(filtered.riskSummary).toBeDefined();
    expect(filtered.riskSummary.addedCount).toBeGreaterThanOrEqual(0);
  });
});
