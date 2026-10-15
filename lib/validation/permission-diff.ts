/**
 * Permission change diff viewer types and utilities.
 *
 * Provides semantic diff calculation for permission changes across:
 * - API key scopes (granular permissions for integrations)
 * - Organization roles (hierarchical access levels for team members)
 *
 * The diff layer sits above the permission model to enable clear before/after
 * review UX. All unknown permissions fail closed (filtered out, not rendered).
 * Inherited access is not misrepresented; changes requiring confirmation are
 * deterministic.
 */

import type { ApiKeyScope } from "@/lib/api/keys";
import type { OrganizationRole } from "@/lib/api/organization-members";

/**
 * Describes the change status of a single permission in the diff.
 * - added: present in "after" permissions only
 * - removed: present in "before" permissions only
 * - unchanged: present in both "before" and "after" (identity preserved)
 * - inherited: present due to role/capability inheritance, not explicitly selected
 */
export type ChangeStatus = "added" | "removed" | "unchanged" | "inherited";

/**
 * A single permission within a permission diff, tagged with its change status
 * and optional metadata for risk assessment.
 */
export interface PermissionChange {
  /** The permission identifier (scope or role). */
  id: string;

  /** Human-readable title for display. */
  title: string;

  /** Human-readable description explaining the permission's effect. */
  description: string;

  /** Status of this permission in the diff. */
  status: ChangeStatus;

  /**
   * If true, this permission can mutate, create, or delete data beyond
   * the permission holder's own records. Flagged in review UI as "Broad".
   */
  isBroad?: boolean;

  /**
   * If true, this permission was removed and its absence could be destructive
   * or cause unexpected behavior. Flagged for confirmation.
   */
  isDestructiveRemoval?: boolean;

  /** Optional category for grouping (e.g., "proofs", "webhooks", "roles"). */
  category?: string;
}

/**
 * Risk assessment for a permission set diff.
 */
export interface DiffRiskSummary {
  /** True if any changes are "broad" permissions. */
  hasBroadPermissions: boolean;

  /** True if any permissions were removed. */
  hasRemovals: boolean;

  /** True if any permission removals are marked destructive. */
  hasDestructiveRemovals: boolean;

  /** Count of permissions added. */
  addedCount: number;

  /** Count of permissions removed. */
  removedCount: number;

  /** Count of permissions that remain unchanged. */
  unchangedCount: number;

  /** Count of permissions inherited rather than explicitly granted. */
  inheritedCount: number;
}

/**
 * A semantic diff of permission changes.
 *
 * Comparison behavior:
 * - Unknown permissions are filtered out (fail closed pattern)
 * - Scopes are compared by exact string match (identity preserved)
 * - Changes are deterministic and reproducible
 * - Authorization is assumed to be validated server-side before/after mutation
 */
export interface PermissionDiff {
  /** All permissions involved in the diff (all statuses). */
  all: PermissionChange[];

  /** Permissions added in this change. */
  added: PermissionChange[];

  /** Permissions removed in this change. */
  removed: PermissionChange[];

  /** Permissions that exist in both before and after (identity preserved). */
  unchanged: PermissionChange[];

  /** Permissions present only due to inheritance, not explicit grant. */
  inherited: PermissionChange[];

  /** Risk assessment derived from the diff contents. */
  riskSummary: DiffRiskSummary;

  /**
   * True if this diff requires explicit confirmation before mutation.
   * Typical cases: any removal, any broad permission, any destructive removal.
   */
  requiresConfirmation: boolean;

  /** Optional reason explaining why confirmation is required. */
  confirmationReason?: string;
}

/**
 * Options for calculating permission diffs.
 */
export interface PermissionDiffOptions {
  /**
   * Lookup function to resolve a permission ID to its metadata
   * (title, description, isBroad, category, etc.).
   * Returns null for unknown permissions (fail-closed).
   */
  resolvPermission: (id: string) => PermissionChange | null;

  /**
   * Optional set of permission IDs that should be flagged as
   * destructive removals (e.g., "webhooks:manage" removal could
   * stop critical integrations).
   */
  destructiveRemovalIds?: Set<string>;

  /**
   * Optional set of permission IDs that are inherited and should
   * not contribute to confirmation requirements even if they appear
   * as "added" in the diff. Used for role-based inheritance.
   */
  inheritedIds?: Set<string>;
}

/**
 * Calculates a semantic diff between two permission sets.
 *
 * @param before - Permissions before the change (e.g., current API key scopes)
 * @param after - Permissions after the change (e.g., new scopes to grant)
 * @param options - Resolution and classification options
 * @returns A PermissionDiff with all statuses and risk assessment
 *
 * @example
 * const diff = calculatePermissionDiff(
 *   ["proofs:read"], // before
 *   ["proofs:read", "proofs:create"], // after
 *   { resolvPermission: scopeCatalogEntry }
 * );
 * // diff.added = [{ id: "proofs:create", status: "added", ... }]
 * // diff.unchanged = [{ id: "proofs:read", status: "unchanged", ... }]
 */
export function calculatePermissionDiff(
  before: readonly string[],
  after: readonly string[],
  options: PermissionDiffOptions,
): PermissionDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const inheritedIds = options.inheritedIds ?? new Set();

  const added: PermissionChange[] = [];
  const removed: PermissionChange[] = [];
  const unchanged: PermissionChange[] = [];
  const inherited: PermissionChange[] = [];

  // Process "after" permissions: added or unchanged.
  for (const id of afterSet) {
    const metadata = options.resolvPermission(id);
    if (!metadata) continue; // Unknown permission, fail closed.

    const change: PermissionChange = {
      ...metadata,
      id,
      status: beforeSet.has(id) ? "unchanged" : "added",
    };

    if (inheritedIds.has(id) && change.status === "added") {
      change.status = "inherited";
      inherited.push(change);
    } else if (change.status === "added") {
      added.push(change);
    } else {
      unchanged.push(change);
    }
  }

  // Process "before" permissions: removed if not in "after".
  for (const id of beforeSet) {
    if (afterSet.has(id)) continue; // Already handled above.

    const metadata = options.resolvPermission(id);
    if (!metadata) continue; // Unknown permission, fail closed.

    const change: PermissionChange = {
      ...metadata,
      id,
      status: "removed",
      isDestructiveRemoval: options.destructiveRemovalIds?.has(id) ?? false,
    };

    removed.push(change);
  }

  // Calculate risk summary.
  const riskSummary: DiffRiskSummary = {
    hasBroadPermissions: [
      ...added,
      ...unchanged,
      ...inherited,
    ].some((p) => p.isBroad),
    hasRemovals: removed.length > 0,
    hasDestructiveRemovals: removed.some((p) => p.isDestructiveRemoval),
    addedCount: added.length,
    removedCount: removed.length,
    unchangedCount: unchanged.length,
    inheritedCount: inherited.length,
  };

  const requiresConfirmation =
    removed.length > 0 ||
    riskSummary.hasBroadPermissions ||
    riskSummary.hasDestructiveRemovals;

  let confirmationReason: string | undefined;
  if (removed.length > 0 && riskSummary.hasDestructiveRemovals) {
    confirmationReason =
      "Destructive permission removals require confirmation to prevent service interruption.";
  } else if (removed.length > 0) {
    confirmationReason =
      "Permissions are being removed. This action may cause integrations to fail.";
  } else if (riskSummary.hasBroadPermissions && added.length > 0) {
    confirmationReason =
      "This change adds broad permissions that can create, modify, or delete data.";
  }

  return {
    all: [...added, ...removed, ...unchanged, ...inherited],
    added,
    removed,
    unchanged,
    inherited,
    riskSummary,
    requiresConfirmation,
    confirmationReason,
  };
}

/**
 * Derives whether a permission diff requires confirmation based on its contents.
 *
 * Used for authorization checks: if a user lacks authority to make a
 * change requiring confirmation, the UI can hide/disable the button.
 *
 * @param diff - The permission diff to assess
 * @returns True if this diff requires explicit user confirmation
 */
export function diffRequiresConfirmation(diff: PermissionDiff): boolean {
  return diff.requiresConfirmation;
}

/**
 * Counts permissions by status across a diff.
 *
 * Useful for summaries like "3 scopes added, 1 removed".
 *
 * @param diff - The permission diff to count
 * @returns Object with counts by status
 */
export function countPermissionsByStatus(diff: PermissionDiff) {
  return {
    added: diff.added.length,
    removed: diff.removed.length,
    unchanged: diff.unchanged.length,
    inherited: diff.inherited.length,
    total: diff.all.length,
  };
}

/**
 * Filters a permission diff to only include scopes of a certain type
 * or category. Useful for grouping related changes in the UI.
 *
 * @param diff - The permission diff to filter
 * @param category - Category to include (e.g., "proofs", "webhooks")
 * @returns New diff with only permissions in the specified category
 */
export function filterPermissionDiffByCategory(
  diff: PermissionDiff,
  category: string,
): PermissionDiff {
  const filterByCategory = (perms: PermissionChange[]) =>
    perms.filter((p) => p.category === category);

  return {
    all: filterByCategory(diff.all),
    added: filterByCategory(diff.added),
    removed: filterByCategory(diff.removed),
    unchanged: filterByCategory(diff.unchanged),
    inherited: filterByCategory(diff.inherited),
    riskSummary: {
      hasBroadPermissions: filterByCategory(
        diff.all,
      ).some((p) => p.isBroad),
      hasRemovals: filterByCategory(diff.removed).length > 0,
      hasDestructiveRemovals: filterByCategory(
        diff.removed,
      ).some((p) => p.isDestructiveRemoval),
      addedCount: filterByCategory(diff.added).length,
      removedCount: filterByCategory(diff.removed).length,
      unchangedCount: filterByCategory(diff.unchanged).length,
      inheritedCount: filterByCategory(diff.inherited).length,
    },
    requiresConfirmation: diff.requiresConfirmation,
    confirmationReason: diff.confirmationReason,
  };
}
