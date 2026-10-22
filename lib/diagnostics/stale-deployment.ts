/**
 * Stale-deployment / chunk-load failure recovery (#227).
 *
 * After a new deployment, a long-lived tab's already-loaded JS still
 * references chunk URLs (content-hashed) that the CDN/server no longer
 * serves. The browser's dynamic `import()` for that chunk then rejects
 * with a recognizable error, surfaced to React either as a thrown error
 * during render (caught by `app/error.tsx`) or as an unhandled promise
 * rejection (never reaches `error.tsx` at all - different problem,
 * addressed in `installChunkLoadRejectionListener` below).
 *
 * This module only *detects* the condition and decides whether a reload
 * is safe to attempt; `app/error.tsx` and `components/common/
 * stale-deployment-recovery.tsx` own the actual UI and reload.
 */

const RELOAD_GUARD_KEY = "earnproof.stale-deployment-reload-attempted";

/**
 * Matches the error names/messages real bundlers (webpack, Next's
 * Turbopack/webpack chunk loader, Vite) actually throw for a missing
 * chunk, plus the generic browser-level "Loading chunk X failed" and
 * `ChunkLoadError` names. Deliberately narrow: an error that merely
 * mentions "chunk" in an unrelated context (e.g. a user-facing string
 * about "a chunk of data") should NOT match, so this checks error
 * *name* first, and only falls back to a message check for the small
 * set of well-known phrasings real tooling uses.
 */
const KNOWN_CHUNK_ERROR_NAMES = new Set(["ChunkLoadError"]);

const KNOWN_CHUNK_ERROR_MESSAGE_PATTERNS = [
  /Loading chunk \d+ failed/i,
  /Loading CSS chunk \d+ failed/i,
  /failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
];

export function isStaleChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (KNOWN_CHUNK_ERROR_NAMES.has(error.name)) return true;
  return KNOWN_CHUNK_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(error.message));
}

/**
 * True if the browser is currently offline. A chunk fetch failing while
 * offline is a connectivity problem, not a stale-deployment problem - a
 * reload won't fix it and would just strand the user on a blank page
 * mid-reload, so recovery should not treat this as the stale-deployment
 * case (still falls through to the standard error boundary).
 */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * One reload attempt per browser session (tab), not per error: if the
 * reload itself lands back on the same stale assets (e.g. a CDN that
 * hasn't finished propagating yet) and throws the same error again,
 * this guard prevents an infinite reload loop - the second occurrence
 * falls back to the standard error boundary instead of reloading again.
 */
export function hasAlreadyAttemptedReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(RELOAD_GUARD_KEY) === "true";
  } catch {
    // sessionStorage can throw in some privacy modes; treat as "not yet attempted"
    // rather than silently never offering recovery.
    return false;
  }
}

export function markReloadAttempted(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
  } catch {
    // Best-effort; if this throws, the loop guard simply can't persist,
    // which is a safe failure mode (worst case: one extra reload attempt).
  }
}

export function clearReloadGuard(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    // Same best-effort reasoning as markReloadAttempted.
  }
}

/**
 * Builds the URL to reload to: the current pathname only, with no query
 * string, no hash, and no state carried over. This is the "preserves
 * only safe route context" / "auth tokens and form data are not copied
 * into refresh URLs" requirement - query strings are how this app passes
 * proof IDs and other potentially sensitive identifiers (see
 * lib/diagnostics/sanitize.ts's own reasoning for the same rule), and
 * session/auth state lives in localStorage, never in the URL, so a
 * pathname-only reload cannot carry a token forward either way.
 */
export function buildSafeReloadUrl(currentPathname: string): string {
  return currentPathname || "/";
}

/**
 * Registers a window-level listener for the "unhandledrejection" case:
 * a dynamic `import()` rejecting outside of React's render (e.g. a
 * route prefetch) never reaches a React error boundary at all. This
 * listener's only job is calling `onStaleChunkDetected` so the caller
 * (the app shell) can route it through the same recovery UI/guard as
 * the render-time case - it does not reload anything itself. Returns an
 * unsubscribe function.
 */
export function installChunkLoadRejectionListener(
  onStaleChunkDetected: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: PromiseRejectionEvent) => {
    if (isStaleChunkLoadError(event.reason)) {
      onStaleChunkDetected();
    }
  };

  window.addEventListener("unhandledrejection", handler);
  return () => window.removeEventListener("unhandledrejection", handler);
}
