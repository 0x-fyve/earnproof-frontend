/**
 * Default route authorization for everything under /settings (#332).
 *
 * Account/organization settings are always behind authentication and must
 * never be cached by a shared/CDN cache (wallet-authenticated, org-scoped
 * data). Overrides the app-root default.
 */
export const routeAuth = {
  access: "protected",
  role: null,
  capability: null,
  cache: "no-store",
};
