export type CacheHeaderRule = {
  /** Next.js `headers()` route matcher (same syntax as next.config.ts). */
  source: string;
  headers: Array<{ key: string; value: string }>;
  /** Short label for the policy this rule implements — surfaced in docs/cache-policy.md and tests. */
  policy: "public-static" | "health" | "verification" | "authenticated";
};

const NO_STORE = "no-store, private";

/**
 * Cache-Control policy by route, applied on top of the security headers in
 * config/security-headers.ts. See docs/cache-policy.md for the full
 * rationale per route group.
 *
 * Next.js applies every matching rule and, when two rules set the same
 * header key for the same path, the *last* matching rule wins (see
 * node_modules/next/dist/docs/.../headers.md#header-overriding-behavior).
 * So this list is ordered least-specific first: the broad public-static
 * default comes first, then the health/verification/authenticated
 * overrides that must never be cached come after it, in that order, so
 * their `no-store` value always wins on the routes they target.
 */
export function cacheHeaderRules(): CacheHeaderRule[] {
  return [
    {
      policy: "public-static",
      source: "/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=0, must-revalidate",
        },
      ],
    },
    {
      // The frontend has no /health route of its own (that lives on
      // earnproof-backend); /status is this app's health/monitoring
      // surface and must always reflect a live check, never a cached page.
      policy: "health",
      source: "/status",
      headers: [{ key: "Cache-Control", value: NO_STORE }],
    },
    {
      // Public verification results are non-authenticated but privacy- and
      // time-sensitive (VALID/EXPIRED/REVOKED must never be served stale
      // from a shared cache or browser back/forward cache).
      policy: "verification",
      source: "/verify/:path*",
      headers: [{ key: "Cache-Control", value: NO_STORE }],
    },
    {
      // Wallet-authenticated payment/proof-creation flows, plus the
      // account/organization settings surface (API keys, payment methods,
      // sessions, audit log, trusted sources, etc. — see app/settings/*).
      // Never eligible for shared caching, and `no-store` additionally
      // keeps these pages out of the browser's back/forward cache in every
      // engine that treats `no-store` as bfcache-ineligible (Chromium,
      // WebKit). Firefox's bfcache does not currently key off
      // Cache-Control at all, so this is a defense-in-depth measure, not a
      // complete guarantee — see docs/cache-policy.md for the full caveat,
      // and lib/auth/bfcache-guard.ts for the client-side backstop.
      policy: "authenticated",
      source: "/proofs/:path*",
      headers: [{ key: "Cache-Control", value: NO_STORE }],
    },
    {
      policy: "authenticated",
      source: "/settings/:path*",
      headers: [{ key: "Cache-Control", value: NO_STORE }],
    },
  ];
}
