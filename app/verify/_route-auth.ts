/**
 * Default route authorization for /verify/* (#332).
 *
 * Verification pages are public (anyone with a proof ID can check it —
 * that's the point of the feature), but each response is scoped to a
 * specific, caller-supplied proof/credential identifier, so it must never
 * be cached by a shared/CDN cache (one verifier's result must never be
 * served to another). Overrides the app-root default's cache setting
 * while keeping the public access level.
 */
export const routeAuth = {
  access: "public",
  role: null,
  capability: null,
  cache: "no-store",
};
