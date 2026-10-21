/**
 * Default route authorization for /proofs/* (#332).
 *
 * Creating, viewing, or managing a user's own proofs requires
 * authentication and must never be cached by a shared/CDN cache (the
 * response is scoped to the authenticated wallet/user). Overrides the
 * app-root default.
 */
export const routeAuth = {
  access: "protected",
  role: null,
  capability: null,
  cache: "no-store",
};
