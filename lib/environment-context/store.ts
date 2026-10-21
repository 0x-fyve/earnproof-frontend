import { DEFAULT_ENVIRONMENT, isEnvironment, type Environment } from "./types";

/**
 * Environment is stored per-organization (distinct localStorage keys),
 * not as one global value, so switching organizations never carries a
 * stale "I was in production" choice into an organization the user has
 * never confirmed production access for. Mirrors the per-key, id-scoped
 * pattern lib/organization-context/store.ts uses for the organization id
 * itself (one key per concern, validated on every read rather than
 * trusted as-is).
 */
function storageKey(organizationId: string): string {
  return `earnproof.environment.${organizationId}`;
}

export function readStoredEnvironment(organizationId: string): Environment {
  if (typeof window === "undefined" || !organizationId) {
    return DEFAULT_ENVIRONMENT;
  }

  const raw = window.localStorage.getItem(storageKey(organizationId));
  return isEnvironment(raw) ? raw : DEFAULT_ENVIRONMENT;
}

export function storeEnvironment(organizationId: string, environment: Environment): void {
  if (typeof window === "undefined" || !organizationId) {
    return;
  }
  window.localStorage.setItem(storageKey(organizationId), environment);
}

export function clearStoredEnvironment(organizationId: string): void {
  if (typeof window === "undefined" || !organizationId) {
    return;
  }
  window.localStorage.removeItem(storageKey(organizationId));
}
