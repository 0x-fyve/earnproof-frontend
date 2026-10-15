/**
 * API key scope-specific diff adapter.
 *
 * Wraps permission-diff.ts utilities with scope catalog integration
 * to provide ready-to-use diff calculation for API key scope changes.
 */

import type { ApiKeyScope } from "@/lib/api/keys";
import {
  calculatePermissionDiff,
  type PermissionChange,
  type PermissionDiff,
  type PermissionDiffOptions,
} from "./permission-diff";
import { scopeCatalogEntry, BROAD_SCOPES } from "./scope-catalog";

/**
 * Converts a scope catalog entry to a PermissionChange.
 * Returns null for unknown scopes (fail-closed).
 */
function scopeToPermissionChange(scope: string): PermissionChange | null {
  const entry = scopeCatalogEntry(scope);
  if (!entry) return null;

  return {
    id: scope,
    title: entry.title,
    description: entry.description,
    isBroad: entry.isBroad,
    category: entry.category,
    status: "unchanged", // Will be overwritten by calculatePermissionDiff
  };
}

/**
 * Calculates a semantic diff between two sets of API key scopes.
 *
 * Features:
 * - Unknown scopes are filtered out (fail-closed)
 * - Broad scopes (can mutate/delete data) are flagged for review
 * - Scope removal automatically triggers confirmation requirement
 * - All scopes in BROAD_SCOPES are flagged as requiring caution
 *
 * @param beforeScopes - Current scopes on the API key
 * @param afterScopes - Proposed scopes after the change
 * @returns A PermissionDiff ready for display or mutation confirmation
 *
 * @example
 * const diff = calculateApiKeyScopeDiff(
 *   ["proofs:read"],
 *   ["proofs:read", "proofs:create"]
 * );
 * // diff.added = [{ id: "proofs:create", isBroad: true, ... }]
 * // diff.riskSummary.hasBroadPermissions = true
 * // diff.requiresConfirmation = true
 */
export function calculateApiKeyScopeDiff(
  beforeScopes: readonly string[],
  afterScopes: readonly string[],
): PermissionDiff {
  // Broad scopes require destructive removal flagging
  const destructiveRemovalIds = new Set(
    beforeScopes.filter((scope) => BROAD_SCOPES.has(scope as ApiKeyScope)),
  );

  const options: PermissionDiffOptions = {
    resolvPermission: scopeToPermissionChange,
    destructiveRemovalIds,
  };

  return calculatePermissionDiff(beforeScopes, afterScopes, options);
}

/**
 * Determines if an API key scope change requires explicit user confirmation
 * before mutation.
 *
 * Confirmation is required when:
 * - Any scopes are being removed
 * - Any new scopes are "broad" (can mutate/delete)
 * - Any removed scopes are "broad" (could disrupt integrations)
 *
 * @param beforeScopes - Current scopes
 * @param afterScopes - Proposed scopes
 * @returns True if user confirmation is needed before applying the change
 */
export function apiKeyScopeChangeRequiresConfirmation(
  beforeScopes: readonly string[],
  afterScopes: readonly string[],
): boolean {
  const diff = calculateApiKeyScopeDiff(beforeScopes, afterScopes);
  return diff.requiresConfirmation;
}
