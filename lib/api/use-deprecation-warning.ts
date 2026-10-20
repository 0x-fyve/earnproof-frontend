/**
 * Shared, hook-accessible deprecation warning state (#231), following
 * the same global-state-plus-listeners pattern as
 * lib/network/use-network-status.ts (both exist so the API client layer
 * can push state without needing a hook dependency, and components can
 * subscribe without prop-drilling the latest response through every
 * layer that calls apiClient).
 */

"use client";

import { useEffect, useState } from "react";
import type { ParsedDeprecationWarning } from "./deprecation-warnings";

const listeners = new Set<(warning: ParsedDeprecationWarning | null) => void>();
let globalWarning: ParsedDeprecationWarning | null = null;

/** Tracks which (sunsetAt, apiVersion) pairs have already been shown, so re-fetching the same deprecated endpoint doesn't re-surface an already-dismissed notice. */
const suppressedKeys = new Set<string>();

function dedupeKey(warning: ParsedDeprecationWarning): string {
  return `${warning.apiVersion ?? "unknown"}::${warning.sunsetAt?.toISOString() ?? "no-sunset"}`;
}

/**
 * Called by the API client (lib/api/client.ts) whenever a response
 * carries deprecation headers. If this exact (version, deadline) pair
 * was already dismissed via `dismissDeprecationWarning`, it is not
 * re-surfaced — "suppress repeated notices only for the same API
 * version and deadline" means a DIFFERENT deadline (e.g. the backend
 * pushed the sunset date back, or a different endpoint has its own
 * schedule) must still show through.
 */
export function recordDeprecationWarning(warning: ParsedDeprecationWarning): void {
  const key = dedupeKey(warning);
  if (suppressedKeys.has(key)) {
    return;
  }
  globalWarning = warning;
  listeners.forEach((listener) => listener(globalWarning));
}

/** Dismisses the current warning and suppresses it from reappearing for the same (version, deadline) pair. */
export function dismissDeprecationWarning(): void {
  if (globalWarning) {
    suppressedKeys.add(dedupeKey(globalWarning));
  }
  globalWarning = null;
  listeners.forEach((listener) => listener(null));
}

/** Test-only reset; production code never needs to clear suppression history. */
export function __resetDeprecationWarningStateForTests(): void {
  globalWarning = null;
  suppressedKeys.clear();
}

export function useDeprecationWarning(): ParsedDeprecationWarning | null {
  const [warning, setWarning] = useState<ParsedDeprecationWarning | null>(globalWarning);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWarning(globalWarning);
    const handler = (next: ParsedDeprecationWarning | null) => setWarning(next);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return warning;
}
