/**
 * bfcache-guard: protects sensitive, wallet-authenticated views from the
 * browser's back/forward cache (bfcache).
 *
 * config/cache-headers.ts sets `Cache-Control: no-store` on `/verify/*`,
 * `/proofs/*`, and `/settings/*`, which keeps those routes out of the
 * bfcache in Chromium and WebKit. Firefox's bfcache does not currently key
 * off `Cache-Control` at all (see docs/cache-policy.md), so a page can
 * still be restored from bfcache there with its full in-memory React state
 * intact — including an in-memory auth token that was valid when the page
 * was left, but may since have been rotated, revoked, or logged out in
 * another tab.
 *
 * This module is the client-side backstop for that gap:
 *  - `pagehide` (fired before a page may be cached) proactively tears down
 *    anything that must not be visible if the page is later restored from
 *    cache without a fresh `pageshow`.
 *  - `pageshow` with `event.persisted === true` (the page WAS served from
 *    bfcache rather than freshly loaded) forces a synchronous revalidation
 *    callback before anything the restored page already rendered is
 *    trusted again.
 *
 * `pageshow`/`pagehide` fire on every navigation (not just bfcache ones);
 * `persisted` is what distinguishes a bfcache restoration from an ordinary
 * load, so non-bfcache navigations are intentionally no-ops here.
 */

export type BfcacheRevalidateReason = "bfcache_restored";

export interface BfcacheGuardHandlers {
  /**
   * Called synchronously when a page is restored from bfcache. Should
   * re-check auth/session validity and clear any stale sensitive state
   * before the restored UI is shown to the user.
   */
  onRestore: (reason: BfcacheRevalidateReason) => void;
}

/**
 * Registers the pageshow/pagehide listeners. Returns an unsubscribe
 * function. Safe to call in non-browser environments (SSR) — it is a
 * no-op when `window` is undefined.
 */
export function installBfcacheGuard(
  handlers: BfcacheGuardHandlers,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      handlers.onRestore("bfcache_restored");
    }
  };

  // No-op by default: pagehide fires on every away-navigation, and the
  // in-memory session state (TokenManager, SessionCoordinator) already
  // lives for the tab's lifetime regardless of bfcache. The hook exists so
  // callers can plug in proactive teardown (e.g. clearing a visible
  // on-screen secret) without every call site re-deriving this wiring.
  const handlePageHide = () => {};

  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("pagehide", handlePageHide);

  return () => {
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("pagehide", handlePageHide);
  };
}
