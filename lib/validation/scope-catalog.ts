/**
 * Grouped scope metadata for the API key creation form (#181).
 *
 * There is no scope-grouping or risk metadata in the API contract itself
 * (lib/api/openapi/earnproof-api.v1.json's ApiKey.scopes is a plain
 * `string[]`); AVAILABLE_SCOPES/SCOPE_DESCRIPTIONS in lib/api/keys.ts and
 * lib/validation/api-keys.ts are the only hand-authored source of truth for
 * what a scope is. This catalog is an additional, purely client-side layer
 * on top of that: it groups the same AVAILABLE_SCOPES by the resource they
 * govern and flags which ones are broad (can mutate/delete things outside
 * this API key's own data), so the review UI can warn on them. It derives
 * from AVAILABLE_SCOPES (never re-lists it by hand) so an unrecognized
 * scope fails closed rather than silently rendering as selectable - see
 * `scopeGroupFor`/`isKnownScope` below.
 */

import { AVAILABLE_SCOPES, type ApiKeyScope } from "@/lib/api/keys";
import { SCOPE_DESCRIPTIONS } from "./api-keys";

export type ScopeCategory = "verification" | "proofs" | "webhooks";

export interface ScopeCatalogEntry {
  scope: ApiKeyScope;
  title: string;
  description: string;
  category: ScopeCategory;
  /**
   * A broad scope can create, modify, or delete resources beyond simply
   * reading the caller's own data (e.g. registering/removing webhook
   * endpoints that receive live event data), so selecting it is flagged in
   * the permission review rather than treated the same as a read-only
   * scope.
   */
  isBroad: boolean;
}

const CATEGORY_BY_SCOPE: Record<ApiKeyScope, ScopeCategory> = {
  "verification:read": "verification",
  "proofs:create": "proofs",
  "proofs:read": "proofs",
  "webhooks:manage": "webhooks",
};

export const BROAD_SCOPES: ReadonlySet<ApiKeyScope> = new Set(["proofs:create", "webhooks:manage"]);

export const CATEGORY_LABELS: Record<ScopeCategory, string> = {
  verification: "Verification",
  proofs: "Proofs",
  webhooks: "Webhooks",
};

/** AVAILABLE_SCOPES enriched with grouping/risk metadata, in its original order. */
export const SCOPE_CATALOG: readonly ScopeCatalogEntry[] = AVAILABLE_SCOPES.map((scope) => ({
  scope,
  title: SCOPE_DESCRIPTIONS[scope]?.title ?? scope,
  description: SCOPE_DESCRIPTIONS[scope]?.description ?? "",
  category: CATEGORY_BY_SCOPE[scope],
  isBroad: BROAD_SCOPES.has(scope),
}));

/** The catalog grouped by category, in CATEGORY_LABELS' declaration order. */
export function scopeCatalogByCategory(): Array<{
  category: ScopeCategory;
  label: string;
  scopes: ScopeCatalogEntry[];
}> {
  const categories = Object.keys(CATEGORY_LABELS) as ScopeCategory[];
  return categories
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      scopes: SCOPE_CATALOG.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.scopes.length > 0);
}

/**
 * Looks up a scope's catalog entry, or null for anything not in
 * AVAILABLE_SCOPES. Callers must treat null as "reject this scope", not as
 * "render it with a generic label" - an unknown scope must fail closed
 * rather than become selectable (#181's acceptance criteria).
 */
export function scopeCatalogEntry(scope: string): ScopeCatalogEntry | null {
  return SCOPE_CATALOG.find((entry) => entry.scope === scope) ?? null;
}

export function isKnownScope(scope: string): scope is ApiKeyScope {
  return scopeCatalogEntry(scope) !== null;
}

/** True if any of the given scopes is flagged broad in the catalog. */
export function hasBroadScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scopeCatalogEntry(scope)?.isBroad ?? false);
}

/**
 * Pairs of scopes that make no sense selected together (e.g. a narrower
 * scope already implied by a broader one, or two scopes that contradict
 * each other's intent). None of the 4 scopes in AVAILABLE_SCOPES today are
 * documented as implying or conflicting with one another - `proofs:create`
 * and `proofs:read` are two independent, additive permissions, not a
 * narrow/broad pair - so this table is intentionally empty rather than
 * invented. It exists so `incompatibleScopePairs` has a real place to grow
 * into once the API contract documents an actual conflict (e.g. a future
 * `proofs:admin` scope that supersedes `proofs:read`/`proofs:create`),
 * without a UI/logic rewrite at that point.
 */
const INCOMPATIBLE_SCOPE_PAIRS: ReadonlyArray<readonly [ApiKeyScope, ApiKeyScope]> = [];

/** Any pairs of selected scopes that are flagged incompatible with each other. */
export function incompatibleScopePairs(
  scopes: readonly string[],
): Array<readonly [ApiKeyScope, ApiKeyScope]> {
  const selected = new Set(scopes);
  return INCOMPATIBLE_SCOPE_PAIRS.filter(([a, b]) => selected.has(a) && selected.has(b));
}
