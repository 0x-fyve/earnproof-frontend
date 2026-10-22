"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildSafeReloadUrl,
  hasAlreadyAttemptedReload,
  isOffline,
  markReloadAttempted,
} from "@/lib/diagnostics/stale-deployment";

/**
 * Recovery UI shown by `app/error.tsx` when the caught error is a
 * recognized stale-chunk/stale-deployment failure (#227). Renders a
 * different, narrower message than the generic error fallback and
 * offers exactly one automatic-feeling reload — guarded so it can never
 * loop. Falls back to the caller's generic error boundary (via
 * `onFallbackToGenericError`) when:
 *   - a reload was already attempted this session (loop prevention), or
 *   - the browser is currently offline (reloading won't fix connectivity).
 */
export function StaleDeploymentRecovery({
  onFallbackToGenericError,
  reset,
}: {
  onFallbackToGenericError: () => void;
  reset: () => void;
}) {
  const [blocked] = useState<"loop" | "offline" | null>(() => {
    if (hasAlreadyAttemptedReload()) return "loop";
    if (isOffline()) return "offline";
    return null;
  });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (blocked) {
      onFallbackToGenericError();
    }
  }, [blocked, onFallbackToGenericError]);

  if (blocked) {
    // Render nothing of our own; the parent's generic error boundary
    // takes over via onFallbackToGenericError above.
    return null;
  }

  function handleReload() {
    markReloadAttempted();
    const safeUrl = buildSafeReloadUrl(window.location.pathname);
    window.location.assign(safeUrl);
  }

  return (
    <div
      aria-live="assertive"
      className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 p-5 sm:p-6"
      role="alert"
    >
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-cyan-100 focus-visible:outline-none"
      >
        A new version is available
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        This tab is running an older version of the app from before the latest update.
        Reloading will bring you to the current version of this page. Nothing you entered
        here was lost — your session stays signed in.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleReload}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-cyan-300/50 bg-cyan-300 px-6 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          Reload page
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
