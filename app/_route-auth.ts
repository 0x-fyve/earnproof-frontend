/**
 * Root-level default route authorization (#332).
 *
 * Applies to every page under app/ that doesn't export its own routeAuth
 * and isn't covered by a more specific _route-auth.ts closer to it. This
 * is the marketing/static-content default: public, indexable, safe to
 * cache. Sections that hold authenticated or sensitive data (settings,
 * proofs, payments, developer API keys, invitations) declare their own,
 * stricter _route-auth.ts that overrides this one.
 */
export const routeAuth = {
  access: "public",
  role: null,
  capability: null,
  cache: "public",
};
