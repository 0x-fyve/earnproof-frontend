/**
 * Default route authorization for /payments/* (#332).
 *
 * Payment detail and backfill-administration pages require authentication
 * and must never be cached by a shared/CDN cache. Overrides the app-root
 * default.
 */
export const routeAuth = {
  access: "protected",
  role: null,
  capability: null,
  cache: "no-store",
};
