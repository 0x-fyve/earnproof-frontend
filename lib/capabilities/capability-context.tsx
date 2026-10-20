"use client";

/**
 * React context/hook for capability-gated UI. See `lib/api/capabilities.ts`
 * for the full "UX layer only, not a security boundary" contract that
 * everything here inherits — nothing added in this file changes that.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  currentDeploymentIdentity,
  fetchMockCapabilityDocument,
  isCapabilityEnabled,
  type CapabilityDocument,
  type CapabilityKey,
} from "@/lib/api/capabilities";
import {
  isCapabilityCacheFresh,
  readCapabilityCache,
  writeCapabilityCache,
  clearCapabilityCache,
} from "@/lib/api/capability-cache";

export type CapabilityStatus = "loading" | "ready" | "error";

export type CapabilityContextValue = {
  status: CapabilityStatus;
  document: CapabilityDocument | null;
  /** Fail-closed: `false` whenever the key isn't explicitly enabled. */
  has: (key: CapabilityKey) => boolean;
  refresh: () => Promise<void>;
};

const CapabilityContext = createContext<CapabilityContextValue | null>(null);

export type CapabilityFetcher = () => Promise<CapabilityDocument>;

export function CapabilityProvider({
  children,
  fetcher = fetchMockCapabilityDocument,
}: {
  children: ReactNode;
  /**
   * Overridable so tests (and, later, a real backend integration) can
   * supply a different document source without touching this provider.
   * Defaults to the local mock/stub described in `lib/api/capabilities.ts`.
   */
  fetcher?: CapabilityFetcher;
}) {
  const [status, setStatus] = useState<CapabilityStatus>("loading");
  const [document, setDocument] = useState<CapabilityDocument | null>(null);
  // Fetch is async; guard against setting state after unmount (route change
  // mid-request) the same way `app/verify/[proofId]/page.tsx` does.
  const mountedRef = useRef(true);
  // `refresh()` needs to force a real refetch (bypassing the cache) even
  // when the mount-time fetch already resolved. Rather than exposing an
  // imperative "call this function to refetch" API that an effect would
  // need to reach into (flagged by react-hooks/set-state-in-effect), the
  // effect re-runs whenever this generation counter changes, and
  // `refresh()` is nothing but "bump the counter" — the canonical React
  // pattern for an on-demand refetch driven by a dependency array.
  const [refreshToken, setRefreshToken] = useState(0);
  // Whether the pending fetch (keyed by refreshToken) should bypass the
  // cache. Only `refreshToken > 0` (i.e. an explicit refresh(), never the
  // initial mount) skips the cache.
  const skipCacheRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const skipCache = skipCacheRef.current;

    // Effects synchronize with external systems; the actual setState
    // calls below happen inside this async closure, never synchronously
    // within the effect body itself.
    async function load() {
      setStatus("loading");
      const identity = currentDeploymentIdentity();

      if (!skipCache) {
        const cached = readCapabilityCache();
        if (cached && isCapabilityCacheFresh(cached, identity)) {
          if (mountedRef.current) {
            setDocument(cached.document);
            setStatus("ready");
          }
          return;
        }
        if (cached) {
          // Present but stale/invalidated (deployment identity changed,
          // or TTL expired) — drop it so a failed refetch below doesn't
          // leave a stale document readable via a future cache read.
          clearCapabilityCache();
        }
      }

      try {
        const nextDocument = await fetcher();
        if (!mountedRef.current) return;

        writeCapabilityCache({
          document: nextDocument,
          identity,
          cachedAt: Date.now(),
        });
        setDocument(nextDocument);
        setStatus("ready");
      } catch {
        if (!mountedRef.current) return;
        // Fail closed: no document means every `has()` check below
        // returns false, not "assume previous state" or "assume
        // enabled".
        setDocument(null);
        setStatus("error");
      }
    }

    load();

    return () => {
      mountedRef.current = false;
    };
  }, [fetcher, refreshToken]);

  const has = useCallback(
    (key: CapabilityKey) => isCapabilityEnabled(document, key),
    [document],
  );

  const refresh = useCallback(async () => {
    skipCacheRef.current = true;
    setRefreshToken((token) => token + 1);
  }, []);

  const value = useMemo<CapabilityContextValue>(
    () => ({ status, document, has, refresh }),
    [status, document, has, refresh],
  );

  return <CapabilityContext.Provider value={value}>{children}</CapabilityContext.Provider>;
}

/**
 * Reads capability state. Must be used under `<CapabilityProvider>`.
 * Deliberately throws outside a provider (a programmer error, not a
 * runtime condition) rather than silently fail-opening — that would
 * hide a missing provider bug rather than surface it in development.
 */
export function useCapabilities(): CapabilityContextValue {
  const context = useContext(CapabilityContext);
  if (!context) {
    throw new Error("useCapabilities must be used within a CapabilityProvider");
  }
  return context;
}

/**
 * Convenience hook for a single capability check. Fails closed via
 * `has()` — while `status` is `"loading"` or `"error"`, this returns
 * `false` because `document` is `null` in both of those states.
 */
export function useCapability(key: CapabilityKey): {
  enabled: boolean;
  status: CapabilityStatus;
} {
  const { has, status } = useCapabilities();
  return { enabled: has(key), status };
}
